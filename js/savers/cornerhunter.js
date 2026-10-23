/* Corner Hunter — ported from bounce-screensaver/index.html, wrapped for the saver registry.
 * Slowed down for large TVs: one full loop (one corner hit) takes 60 s at 1× speed
 * (the standalone version takes 30 s). The speed slider scales this. */
(() => {
'use strict';

// x and y are triangle waves whose frequencies are the coprime integers A:B.
// Both sit on an edge only at integer phases together, so the head hits a
// corner exactly once per loop.
const A = 7, B = 5;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LOOP_SECONDS = REDUCED ? 120 : 60;
const TRAIL_COUNT = 4;
const SIZE_RATIO = 0.2;
const GAP_RATIO = 0.3;        // trail spacing along the path, in head widths
const CORNER_RADIUS = 59.9978 / 517.222;
const THEME_FADE_MS = 400;
const FLASH_MS = 700;
const LOGO_PX = 1024;

const tri = p => { const m = ((p % 2) + 2) % 2; return m > 1 ? 2 - m : m; };

// palette layout: bg(3) head(3) logo(3) trailTop(4) trailBottom(4) flash(3) flashPeak(1)
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const PALETTES = {
  light: [...hex('#9ff5f5'), ...hex('#1a1618'), ...hex('#9cf5f5'),
          ...hex('#ddd8dc'), 0.55, ...hex('#1a1618'), 0.30, ...hex('#ffffff'), 0.75],
  dark:  [...hex('#1a1618'), ...hex('#9cf5f5'), 0, 0, 0,
          ...hex('#ddd8dc'), 0.34, ...hex('#ddd8dc'), 0.05, ...hex('#9cf5f5'), 0.30]
};

const VERT = `
attribute vec2 a_pos;
uniform vec2 u_res, u_origin, u_size;
varying vec2 v_local;
void main() {
  vec2 local = a_pos * (u_size + 2.0) - 1.0;   // 1px pad for edge AA
  v_local = local;
  vec2 pix = u_origin + local;
  gl_Position = vec4(pix.x / u_res.x * 2.0 - 1.0, 1.0 - pix.y / u_res.y * 2.0, 0.0, 1.0);
}`;
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_size;
uniform float u_radius, u_alpha, u_hasLogo;
uniform vec4 u_top, u_bot, u_logoColor;
uniform sampler2D u_tex;
varying vec2 v_local;
float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d = sdRound(v_local - u_size * 0.5, u_size * 0.5, u_radius);
  float cover = clamp(0.5 - d, 0.0, 1.0);
  vec4 col = mix(u_top, u_bot, clamp(v_local.y / u_size.y, 0.0, 1.0));
  if (u_hasLogo > 0.5) {
    float l = texture2D(u_tex, v_local / u_size).a;
    col = mix(col, u_logoColor, l);
  }
  float a = col.a * u_alpha * cover;
  gl_FragColor = vec4(col.rgb * a, a);
}`;

SAVERS.register({
  id: 'cornerhunter',
  name: 'Corner Hunter',
  controls: [],

  mount(host, opts) {
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) { canvas.remove(); return null; }

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const U = {};
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      for (const n of ['u_res', 'u_origin', 'u_size', 'u_radius', 'u_alpha', 'u_hasLogo', 'u_top', 'u_bot', 'u_logoColor', 'u_tex'])
        U[n] = gl.getUniformLocation(prog, n);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    } catch (err) {
      console.error('Corner Hunter shader error:', err);
      canvas.remove();
      return null;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied output

    // logo: rasterize the real SVG paths once, big, then let the GPU filter it
    {
      const c = document.createElement('canvas');
      c.width = c.height = LOGO_PX;
      const x = c.getContext('2d');
      x.scale(LOGO_PX / 517.222, LOGO_PX / 517.222);
      x.fillStyle = '#fff';
      x.fill(new Path2D('M221.927 186.465C240.599 167.722 270.9 167.722 289.571 186.465L398.692 295.961L364.03 330.758C345.358 349.501 315.057 349.501 296.386 330.758L221.2 255.282C219.883 253.96 218.475 252.728 217.021 251.588C210.797 246.161 203.801 241.692 196.124 238.5C189.445 235.718 182.54 233.939 175.453 233.119L221.927 186.465Z'));
      x.fill(new Path2D('M122.21 327.968C124.663 333.805 128.207 339.096 132.659 343.565L200.257 275.705C195.805 271.191 190.536 267.633 184.721 265.216C178.951 262.799 172.727 261.522 166.413 261.522C160.098 261.522 153.874 262.754 148.059 265.171C142.244 267.542 136.975 271.099 132.522 275.569C128.116 280.038 124.572 285.328 122.165 291.165C119.757 297.003 118.53 303.251 118.53 309.59C118.53 315.929 119.802 322.176 122.21 327.968Z'));
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(U.u_tex, 0);
    }

    /* ───────────── State ───────────── */
    let W, H, dpr, s, Wt, Ht, lagPhase;     // css px, except where noted
    let phase = 0, hits = 0, lastT = null;
    let speed = opts.speed, paused = false;
    let flashAt = -1e9;
    let from = PALETTES[opts.theme === 'light' ? 'light' : 'dark'], to = from, fadeStart = -1e9;
    let dead = false, raf = 0;

    const status = () => opts.onStatus?.('corner hits: ' + hits);

    function layout() {
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      W = innerWidth; H = innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      s = Math.round(Math.min(W, H) * SIZE_RATIO);
      Wt = W - s; Ht = H - s;
      lagPhase = (GAP_RATIO * s) / Math.hypot(A * Wt, B * Ht);
    }

    const posAt = p => ({ x: tri(A * p) * Wt, y: tri(B * p) * Ht });

    function box(x, y, size, radiusPx, top, bot, alpha, logoColor) {
      gl.uniform2f(U.u_origin, x * dpr, y * dpr);
      gl.uniform2f(U.u_size, size.w * dpr, size.h * dpr);
      gl.uniform1f(U.u_radius, radiusPx * dpr);
      gl.uniform4fv(U.u_top, top);
      gl.uniform4fv(U.u_bot, bot);
      gl.uniform1f(U.u_alpha, alpha);
      gl.uniform1f(U.u_hasLogo, logoColor ? 1 : 0);
      if (logoColor) gl.uniform4fv(U.u_logoColor, logoColor);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function render(now) {
      // palette cross-fade
      const k = Math.min(1, (now - fadeStart) / THEME_FADE_MS);
      const e = k * k * (3 - 2 * k);
      const pal = from.map((v, i) => v + (to[i] - v) * e);
      const bg = pal.slice(0, 3), head = pal.slice(3, 6), logo = pal.slice(6, 9);
      const tTop = pal.slice(9, 12).concat(pal[12]);
      const tBot = pal.slice(13, 16).concat(pal[16]);
      const flashRGB = pal.slice(17, 20), flashPeak = pal[20];

      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.u_res, canvas.width, canvas.height);

      const size = { w: s, h: s };
      const rad = s * CORNER_RADIUS;
      for (let i = 0; i < TRAIL_COUNT; i++) {
        const age = TRAIL_COUNT - i;
        const p = posAt(phase - age * lagPhase);
        const alpha = 0.18 + 0.82 * (i + 1) / (TRAIL_COUNT + 1);
        box(p.x, p.y, size, rad, tTop, tBot, alpha, null);
      }
      const hp = posAt(phase);
      const solid = head.concat(1);
      box(hp.x, hp.y, size, rad, solid, solid, 1, logo.concat(1));

      const f = 1 - (now - flashAt) / FLASH_MS;
      if (f > 0) {
        const c = flashRGB.concat(1);
        box(0, 0, { w: W, h: H }, 0, c, c, flashPeak * f * f, null);
      }
    }

    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (lastT === null) lastT = now;
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      if (!paused) {
        const before = Math.floor(phase);
        phase += dt * speed / LOOP_SECONDS;
        if (Math.floor(phase) > before) { hits++; flashAt = now; status(); }
      }
      render(now);
    }

    const onResize = () => { layout(); render(performance.now()); };
    const onContextLost = e => { e.preventDefault(); opts.onContextLost?.(); };
    addEventListener('resize', onResize);
    canvas.addEventListener('webglcontextlost', onContextLost);
    layout();
    status();
    raf = requestAnimationFrame(frame);

    return {
      setTheme(t, animate = true) {
        const now = performance.now();
        const k = Math.min(1, (now - fadeStart) / THEME_FADE_MS);
        const e = k * k * (3 - 2 * k);
        from = from.map((v, i) => v + (to[i] - v) * e);   // start from wherever the fade is now
        to = PALETTES[t === 'light' ? 'light' : 'dark'];
        fadeStart = animate ? now : -1e9;
      },
      setSpeed(v) { speed = v; },
      setParam() {},
      setPaused(p) { paused = p; },
      // hook for checking the math from the console
      debug: { A, B, LOOP_SECONDS, get phase() { return phase; }, get hits() { return hits; }, jump(p) { phase = p; } },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        removeEventListener('resize', onResize);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.remove();
      }
    };
  }
});
})();
