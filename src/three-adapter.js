/**
 * click-test-harness / three-adapter
 *
 * Implements the harness's "host contract" using Three.js. This is the
 * piece specific to your app — swap it out for a Babylon/native-canvas
 * adapter and the core harness (src/harness.js) doesn't change at all.
 *
 * Usage:
 *   const host = createThreeHostAdapter({ THREE, scene, camera, renderer, raycastables });
 *   const harness = createClickTestHarness({ container: renderer.domElement, host, tests });
 *
 * `raycastables` is an array of THREE.Object3D that have `.name` set to
 * the objectId strings used in your test specs' target/accept objectId fields.
 *
 * For a `target.kind === 'face' | 'edge'`, the harness expects `target.normal`
 * to be a LOCAL-space unit vector (so rotated meshes still resolve correctly —
 * the local normal for "the left face" doesn't change when the object rotates).
 */

import { REGIONS } from './grade.js';

function defaultRegionOf(obj) {
  const d = obj && obj.userData;
  if (!d) return null;
  return d.cthRegion ?? d.region ?? null;
}

function normaliseRegion(value) {
  // Anything the host does not recognise becomes null rather than being passed
  // through, so a typo cannot satisfy an accept.region by accident.
  return REGIONS.includes(value) ? value : null;
}

export function createThreeHostAdapter({
  THREE, scene, camera, raycastables,
  markerColor = 0xe8a33d,
  markerLift = 0.08,
  // How an object reports which part of the piece it is. The locked host
  // contract requires `region` on every hit: 'hull' | 'pocket' | null.
  // Default reads userData, so a host tags meshes rather than passing a fn.
  regionOf = defaultRegionOf,
}) {
  const raycaster = new THREE.Raycaster();
  const markerGeo = new THREE.SphereGeometry(0.07, 16, 16);
  const markerMat = new THREE.MeshBasicMaterial({ color: markerColor });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.visible = false;
  scene.add(marker);

  function findObject(objectId) {
    return raycastables.find((o) => o.name === objectId);
  }

  function faceWorldPoint(mesh, localNormalArr) {
    const he = mesh.userData.halfExtents || estimateHalfExtents(mesh);
    const local = new THREE.Vector3(
      localNormalArr[0] * he.x,
      localNormalArr[1] * he.y,
      localNormalArr[2] * he.z
    );
    return mesh.localToWorld(local.clone());
  }

  function estimateHalfExtents(mesh) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    return new THREE.Vector3(
      (bb.max.x - bb.min.x) / 2,
      (bb.max.y - bb.min.y) / 2,
      (bb.max.z - bb.min.z) / 2
    );
  }

  function placeMarker(target) {
    const obj = findObject(target.objectId);
    if (!obj) { marker.visible = false; return; }

    if (target.kind === 'occlusion' && target.worldPoint) {
      marker.position.set(...target.worldPoint);
      marker.visible = true;
      return;
    }
    if (target.kind === 'placement') {
      if (target.worldPoint) marker.position.set(...target.worldPoint);
      marker.visible = !!target.worldPoint;
      return;
    }
    if (target.normal) {
      const p = faceWorldPoint(obj, target.normal);
      const worldNormal = new THREE.Vector3(...target.normal).transformDirection(obj.matrixWorld).normalize();
      p.addScaledVector(worldNormal, markerLift);
      marker.position.copy(p);
      marker.visible = true;
    }
  }

  function clearMarker() { marker.visible = false; }

  function raycastAtScreenPoint(point) {
    const ndc = new THREE.Vector2(point.xNDC, point.yNDC);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(raycastables, false);
    if (!hits.length) return { hit: false };
    const h = hits[0];
    return {
      hit: true,
      objectId: h.object.name,
      region: normaliseRegion(regionOf(h.object)),
      point: { x: +h.point.x.toFixed(4), y: +h.point.y.toFixed(4), z: +h.point.z.toFixed(4) },
      normal: h.face ? { x: +h.face.normal.x.toFixed(3), y: +h.face.normal.y.toFixed(3), z: +h.face.normal.z.toFixed(3) } : null,
      distance: +h.distance.toFixed(4),
    };
  }

  function projectToScreen(worldPos) {
    camera.updateMatrixWorld(true);
    const v = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z).project(camera);
    return { xNDC: +v.x.toFixed(4), yNDC: +v.y.toFixed(4) };
  }

  function getMarkerPosition() {
    return marker.visible ? { x: marker.position.x, y: marker.position.y, z: marker.position.z } : null;
  }

  // `aspect` and `fov` are part of the state on purpose: the same NDC
  // coordinate maps to a different ray under a different projection, so a
  // replay in a differently-sized headless viewport would silently raycast
  // somewhere else unless the projection is restored too.
  function getCameraState() {
    return {
      position: { x: +camera.position.x.toFixed(3), y: +camera.position.y.toFixed(3), z: +camera.position.z.toFixed(3) },
      quaternion: { x: +camera.quaternion.x.toFixed(4), y: +camera.quaternion.y.toFixed(4), z: +camera.quaternion.z.toFixed(4), w: +camera.quaternion.w.toFixed(4) },
      fov: camera.fov,
      aspect: camera.aspect,
      zoom: camera.zoom,
    };
  }

  function setCameraState(state) {
    if (!state) return;
    if (state.position) camera.position.set(state.position.x, state.position.y, state.position.z);
    if (state.quaternion) {
      camera.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
    }
    if (typeof state.fov === 'number') camera.fov = state.fov;
    if (typeof state.aspect === 'number') camera.aspect = state.aspect;
    if (typeof state.zoom === 'number') camera.zoom = state.zoom;
    camera.updateProjectionMatrix();
    // Raycaster.setFromCamera unprojects through camera.matrixWorld. Three only
    // refreshes that during a render, so without this an immediate raycast
    // (exactly what headless replay does) would use the PREVIOUS camera pose.
    camera.updateMatrixWorld(true);
  }

  // Exposed on window so a headless replay script (Playwright) can drive
  // this exact adapter from outside the page. This is the "listener" that
  // ties live app <-> external test runner together.
  // projectToScreen/getMarkerPosition aren't needed for replay itself —
  // they're what lets a recorder script find and click a marker with no
  // human involved (see replay/record.js).
  if (typeof window !== 'undefined') {
    window.__CTH_HOST__ = { getCameraState, setCameraState, raycastAtScreenPoint, projectToScreen, getMarkerPosition };
  }

  return { placeMarker, clearMarker, raycastAtScreenPoint, getCameraState, setCameraState, projectToScreen, getMarkerPosition, marker };
}
