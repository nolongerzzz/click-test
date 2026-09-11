/**
 * click-test-harness / overlay
 *
 * The pass/fail panel an owner watches during a live batch against a real app.
 * Pure DOM — no Three.js, no build step, no CSS file. It renders into a shadow
 * root so the host page's stylesheets cannot reach in and the overlay's own
 * styles cannot leak out.
 *
 * It deliberately occupies a corner rather than covering the viewport: the
 * tester still needs to orbit and aim at the real model underneath it.
 */

const STATUS_COLOURS = {
  pending: '#8a8f96',
  pass: '#5fa779',
  fail: '#d2694f',
  miss: '#c99a3d',
  drag: '#7f8ea3',
};

/**
 * True when the page URL carries the activation flag, e.g. `?cth=1`.
 * Any of 1/true/yes/on counts as on.
 */
export function shouldMount({ flag = 'cth', search } = {}) {
  const query = search ?? (typeof location !== 'undefined' ? location.search : '');
  const value = new URLSearchParams(query).get(flag);
  if (value === null) return false;
  return value === '' || ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function createCthOverlay({ tests, onArm, title = 'Click Test Harness', mount } = {}) {
  const parent = mount || (typeof document !== 'undefined' ? document.body : null);
  if (!parent) throw new Error('createCthOverlay: nowhere to mount');

  const hostEl = document.createElement('div');
  hostEl.setAttribute('data-cth-overlay', '');
  // Sit above typical app chrome but stay out of the way of the canvas.
  hostEl.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483000;';
  const shadow = hostEl.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }
      .panel {
        width: 310px; max-height: 100vh; overflow-y: auto;
        margin: 10px; padding: 10px 12px 12px;
        background: rgba(20,23,27,0.94); color: #e7e5e1;
        border: 1px solid #2a3037; border-radius: 8px;
        font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        box-shadow: 0 6px 22px rgba(0,0,0,0.45);
      }
      h1 { font-size: 12px; margin: 0 0 2px; letter-spacing: .02em; }
      .sub { color: #9aa1a8; font-size: 11px; margin-bottom: 8px; }
      .aim { border-top: 1px solid #2a3037; padding: 7px 0 6px; }
      .aim.current { background: rgba(232,163,61,0.08); margin: 0 -12px; padding-left: 12px; padding-right: 12px; }
      .row { display: flex; gap: 8px; justify-content: space-between; align-items: baseline; }
      .name { color: #e7e5e1; }
      .aim.current .name { color: #e8a33d; font-weight: 600; }
      .chip { font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
      .how { color: #9aa1a8; font-size: 11px; margin-top: 2px; }
      .detail { color: #b9bfc6; font-size: 11px; margin-top: 3px; word-break: break-word; }
      .detail b { color: #e7e5e1; font-weight: 600; }
      .controls { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
      button {
        flex: 1; background: #e8a33d; color: #161616; border: 0; border-radius: 5px;
        padding: 8px 10px; font: 600 12px/1 inherit; cursor: pointer;
      }
      button.idle { background: #262c33; color: #e7e5e1; border: 1px solid #39414a; }
      button:disabled { opacity: .4; cursor: default; }
      .note { margin-top: 8px; font-size: 11px; color: #9aa1a8; min-height: 1.4em; }
      .note.warn { color: #d2694f; }
      .tally { margin-top: 8px; font-size: 11px; color: #9aa1a8; }
    </style>
    <div class="panel">
      <h1></h1>
      <div class="sub"></div>
      <div class="aims"></div>
      <div class="controls"><button type="button"></button></div>
      <div class="note"></div>
      <div class="tally"></div>
    </div>
  `;

  shadow.querySelector('h1').textContent = title;
  shadow.querySelector('.sub').textContent = 'Arm, then click the aim. Orbit freely when not armed.';

  const aimsEl = shadow.querySelector('.aims');
  const armBtn = shadow.querySelector('button');
  const noteEl = shadow.querySelector('.note');
  const tallyEl = shadow.querySelector('.tally');

  const state = (tests || []).map((t) => ({
    id: t.id,
    title: t.title || t.id,
    instruction: t.instruction || '',
    status: 'pending',
    detail: '',
  }));
  let current = 0;
  let armed = false;

  function renderAims() {
    aimsEl.innerHTML = '';
    state.forEach((aim, i) => {
      const el = document.createElement('div');
      el.className = 'aim' + (i === current ? ' current' : '');
      const colour = STATUS_COLOURS[aim.status] || STATUS_COLOURS.pending;
      el.innerHTML = `
        <div class="row">
          <span class="name">${i + 1}. ${escapeHtml(aim.title)}</span>
          <span class="chip" style="color:${colour}">${aim.status}</span>
        </div>
        ${i === current && aim.instruction ? `<div class="how">${escapeHtml(aim.instruction)}</div>` : ''}
        ${aim.detail ? `<div class="detail">${aim.detail}</div>` : ''}
      `;
      aimsEl.appendChild(el);
    });
  }

  function renderControls() {
    const done = current >= state.length;
    armBtn.disabled = done;
    armBtn.textContent = done ? 'All aims recorded' : (armed ? 'Armed — click the aim' : 'Arm pick');
    armBtn.className = armed && !done ? '' : 'idle';
  }

  function renderTally() {
    const count = (s) => state.filter((a) => a.status === s).length;
    tallyEl.textContent = `${count('pass')} pass · ${count('fail')} fail · ${count('miss')} miss · ${count('pending')} pending`;
  }

  function render() { renderAims(); renderControls(); renderTally(); }

  armBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onArm) onArm();
  });

  parent.appendChild(hostEl);
  render();

  return {
    root: hostEl,

    setCurrent(index) { current = index; render(); },

    setArmed(value) { armed = !!value; renderControls(); },

    /** Feed a harness result entry (testId, result, hit, expected). */
    recordResult(entry) {
      const aim = state.find((a) => a.id === entry.testId);
      if (aim) {
        aim.status = entry.result;
        const got = entry.hit ? entry.hit.objectId : 'nothing';
        const want = entry.expected && entry.expected.objectId ? entry.expected.objectId : 'any';
        aim.detail = `got <b>${escapeHtml(String(got))}</b> · wanted <b>${escapeHtml(String(want))}</b>`;
      }
      render();
    },

    setNote(text, isWarning = false) {
      noteEl.textContent = text || '';
      noteEl.className = 'note' + (isWarning ? ' warn' : '');
    },

    destroy() { hostEl.remove(); },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
