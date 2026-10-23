/* Route Screensavers — app shell: picks a saver, owns theme/speed/controls.
 *
 * URL presets (per-room): ?saver=starfield|cornerhunter  ?theme=dark|light  ?speed=0.5
 * Precedence on load: URL param > saved choice (this browser) > default.
 */
(() => {
'use strict';

const $ = id => document.getElementById(id);
const savers = SAVERS.list;
if (!savers.length) return;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
const query = new URLSearchParams(location.search);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SPEED_MIN = 0.25, SPEED_MAX = 4;
const FADE_MS = 350;               // keep in sync with #stage transition in app.css
const PANEL_IDLE_MS = 4000;
const HINT_MS = 6000;

/* ───────────── State ───────────── */
const state = {
  id: (savers.find(s => s.id === query.get('saver')) || savers.find(s => s.id === store.get('rcr-saver')) || savers[0]).id,
  theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  paused: false,
  nohud: false
};
let inst = null;                    // the running saver instance
let switchToken = 0;
let initialSpeed = query.has('speed') ? parseFloat(query.get('speed')) : NaN;

const def = () => SAVERS.get(state.id);
const speedFor = id => {
  const saved = parseFloat(store.get('rcr-speed-' + id));
  return clamp(Number.isFinite(saved) ? saved : 1, SPEED_MIN, SPEED_MAX);
};
const paramFor = (id, c) => {
  const saved = parseFloat(store.get(`rcr-${id}-${c.key}`));
  return Number.isFinite(saved) ? clamp(saved, c.min, c.max) : c.value;
};
const currentParams = () => Object.fromEntries((def().controls || []).map(c => [c.key, paramFor(state.id, c)]));

/* ───────────── Saver lifecycle ───────────── */
const stage = $('stage');

function setStatus(text) { $('status').textContent = text || ''; }

function mount() {
  const d = def();
  if (Number.isFinite(initialSpeed)) {
    store.set('rcr-speed-' + d.id, String(clamp(initialSpeed, SPEED_MIN, SPEED_MAX)));
    initialSpeed = NaN;                            // ?speed= only presets the room's first saver
  }
  setStatus('');
  inst = d.mount(stage, {
    theme: state.theme,
    speed: speedFor(d.id),
    params: currentParams(),
    onStatus: setStatus,
    onContextLost: () => switchTo(d.id, true)      // GPU hiccup: rebuild instead of showing a frozen frame
  });
  $('nogl').hidden = !!inst;
  inst?.setPaused(state.paused);
  buildPanelForSaver();
}

function unmount() {
  inst?.destroy();
  inst = null;
}

async function switchTo(id, force = false) {
  if (!SAVERS.get(id) || (id === state.id && !force)) return;
  const token = ++switchToken;
  stage.classList.add('fade-out');
  await new Promise(r => setTimeout(r, force ? 0 : FADE_MS));
  if (token !== switchToken) return;               // a newer switch took over
  unmount();
  state.id = id;
  store.set('rcr-saver', id);
  mount();
  requestAnimationFrame(() => stage.classList.remove('fade-out'));
}

/* ───────────── Panel ───────────── */
function buildPicker() {
  const picker = $('picker');
  picker.textContent = '';
  savers.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = s.id;
    b.textContent = s.name;
    b.title = `${s.name} (${i + 1})`;
    b.addEventListener('click', () => { switchTo(s.id); b.blur(); });
    picker.appendChild(b);
  });
}

function buildPanelForSaver() {
  for (const b of $('picker').children) b.setAttribute('aria-pressed', String(b.dataset.id === state.id));
  setSpeedUI(speedFor(state.id));

  const extra = $('extra');
  extra.textContent = '';
  for (const c of def().controls || []) {
    const label = document.createElement('label');
    const fmt = c.format || (v => String(v));
    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = c.min; input.max = c.max; input.step = c.step;
    input.value = paramFor(state.id, c);
    out.textContent = fmt(+input.value);
    input.addEventListener('input', () => {
      const v = +input.value;
      out.textContent = fmt(v);
      store.set(`rcr-${state.id}-${c.key}`, String(v));
      inst?.setParam(c.key, v);
    });
    input.addEventListener('change', () => input.blur());
    label.append(c.label + ' ', input, out);
    extra.appendChild(label);
  }
}

function setSpeedUI(v) {
  $('rSpeed').value = v;
  $('oSpeed').textContent = v.toFixed(2).replace(/0$/, '') + '×';
}
function setSpeed(v) {
  v = clamp(Math.round(v * 20) / 20, SPEED_MIN, SPEED_MAX);
  store.set('rcr-speed-' + state.id, String(v));
  setSpeedUI(v);
  inst?.setSpeed(v);
}

function setTheme(t, animate = true) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  $('themeLabel').textContent = t === 'dark' ? 'Light' : 'Dark';
  document.querySelector('meta[name="theme-color"]').content = t === 'dark' ? '#1a1618' : '#9cf5f5';
  inst?.setTheme(t, animate);
}
function toggleTheme() {
  const t = state.theme === 'dark' ? 'light' : 'dark';
  store.set('rcr-theme', t);
  setTheme(t);
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', () => {
  $('fullLabel').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
});

function setPaused(p) {
  state.paused = p;
  $('pauseLabel').textContent = p ? 'Resume' : 'Pause';
  inst?.setPaused(p);
}

/* ───────────── Hidden controls ───────────── */
const body = document.body;
let panelOpen = false, idleTimer = 0, hintTimer = 0;

function showHint() {
  body.classList.add('hint-on');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => body.classList.remove('hint-on'), HINT_MS);
}
function hideHint() { clearTimeout(hintTimer); body.classList.remove('hint-on'); }

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if ($('panel').matches(':hover, :focus-within')) armIdle();   // don't close under the pointer
    else closePanel();
  }, PANEL_IDLE_MS);
}
function openPanel() {
  if (state.nohud) return;
  panelOpen = true;
  body.classList.add('ui-open');
  hideHint();
  armIdle();
}
function closePanel() {
  panelOpen = false;
  clearTimeout(idleTimer);
  body.classList.remove('ui-open');
  if (document.activeElement && $('panel').contains(document.activeElement)) document.activeElement.blur();
}
function toggleHud() {
  state.nohud = !state.nohud;
  if (state.nohud) { closePanel(); hideHint(); } else openPanel();
}

// Bare mouse movement does NOT open the panel (a bumped mouse shouldn't pop it up on a TV),
// but it keeps an already-open panel alive.
addEventListener('pointermove', () => { if (panelOpen) armIdle(); }, { passive: true });
addEventListener('pointerdown', () => { panelOpen ? armIdle() : openPanel(); }, { passive: true });

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;            // leave browser shortcuts alone
  const k = e.key.toLowerCase();
  if (state.nohud) { if (k === 'h') { toggleHud(); e.preventDefault(); } return; }
  if (!panelOpen) {                                            // first key press only reveals the controls
    openPanel();
    if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
    return;
  }
  let handled = true;
  if (k === 'f') toggleFull();
  else if (k === 't') toggleTheme();
  else if (k === 'h') toggleHud();
  else if (k === ' ') setPaused(!state.paused);
  else if (k === 'arrowup' || k === 'arrowright') setSpeed(speedFor(state.id) + 0.25);
  else if (k === 'arrowdown' || k === 'arrowleft') setSpeed(speedFor(state.id) - 0.25);
  else if (/^[1-9]$/.test(k) && savers[+k - 1]) switchTo(savers[+k - 1].id);
  else handled = false;
  if (handled) e.preventDefault();
  armIdle();
});

const bind = (el, fn) => el.addEventListener('click', () => { fn(); el.blur(); });
bind($('bTheme'), toggleTheme);
bind($('bFull'), toggleFull);
bind($('bPause'), () => setPaused(!state.paused));
$('rSpeed').addEventListener('input', e => setSpeed(+e.target.value));
$('rSpeed').addEventListener('change', e => e.target.blur());
if (!document.documentElement.requestFullscreen) $('bFull').hidden = true;

/* ───────────── Go ───────────── */
buildPicker();
setTheme(state.theme, false);
mount();
showHint();

// console hook for testing
window.__rcr = { state, switchTo, setSpeed, get saver() { return inst; } };
})();
