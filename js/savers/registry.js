/*
 * Screensaver registry.
 *
 * To add a screensaver: create js/savers/<name>.js, call SAVERS.register({...}),
 * and add one <script> tag for it in index.html (before js/app.js).
 *
 *   SAVERS.register({
 *     id: 'my-saver',                 // used in ?saver=my-saver and saved choice
 *     name: 'My Saver',               // label in the picker
 *     controls: [                     // optional extra sliders shown in the panel
 *       { key: 'density', label: 'Density', min: 1, max: 10, step: 1, value: 5, format: v => v }
 *     ],
 *     mount(host, opts) {             // opts: { theme, speed, params, onStatus, onContextLost }
 *       // create your own <canvas> inside `host`; return null if it can't run (e.g. no WebGL)
 *       return {
 *         setTheme(theme, animate) {}, // 'dark' | 'light'
 *         setSpeed(multiplier) {},     // 1 = normal
 *         setParam(key, value) {},
 *         setPaused(paused) {},
 *         destroy() {}                 // stop loops, remove listeners, free GL, remove canvas
 *       };
 *     }
 *   });
 */
window.SAVERS = {
  list: [],
  register(def) { this.list.push(def); },
  get(id) { return this.list.find(s => s.id === id); }
};
