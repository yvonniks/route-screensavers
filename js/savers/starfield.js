/* Mark Starfield — ported from mark-starfield/index.html, wrapped for the saver registry. */
(() => {
'use strict';

const MARK_PATHS = [
  'M118.715 15.9197C140.153 -5.30657 174.943 -5.30657 196.38 15.9197L321.667 139.92L281.87 179.326C260.432 200.552 225.642 200.552 204.204 179.326L117.88 93.8527C116.368 92.355 114.751 90.9606 113.082 89.6695C105.936 83.5236 97.9034 78.4624 89.0885 74.8472C81.4211 71.6968 73.4928 69.6827 65.356 68.753L118.715 15.9197Z',
  'M4.22491 176.167C7.04152 182.778 11.1099 188.768 16.2216 193.83L93.8347 116.981C88.7231 111.868 82.6726 107.84 75.9962 105.103C69.372 102.366 62.2261 100.919 54.976 100.919C47.7258 100.919 40.58 102.314 33.9036 105.051C27.2272 107.737 21.1767 111.765 16.0651 116.826C11.0056 121.888 6.9372 127.878 4.17275 134.489C1.4083 141.1 0 148.175 0 155.354C0 162.533 1.46046 169.608 4.22491 176.167Z'
];
const BG_LIGHT = [0x9C, 0xF5, 0xF5].map(v => v / 255);
const BG_DARK  = [0x1A, 0x17, 0x18].map(v => v / 255);
const AQUA     = [0x9C, 0xF5, 0xF5].map(v => v / 255);
const MAX_MARKS = 800;
const Z_MIN = 0.03;          // recycle when this close
const BASE_SPEED = 0.11;     // depth units per second at 1×
const MARK_SIZE = 0.05;      // mark height at z = 1, in half-screen-height units
const TEX_W = 1024, TEX_H = 640;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const lerp = (a, b, t) => a + (b - a) * t;

// the mark bitmap is identical for every mount, so draw it once
let markCanvas = null;
function getMarkCanvas() {
  if (markCanvas) return markCanvas;
  markCanvas = document.createElement('canvas');
  markCanvas.width = TEX_W; markCanvas.height = TEX_H;
  const c = markCanvas.getContext('2d');
  const s = 1000 / 322;
  c.translate(12, (TEX_H - 196 * s) / 2);
  c.scale(s, s);
  c.fillStyle = '#fff';
  MARK_PATHS.forEach(d => c.fill(new Path2D(d)));
  return markCanvas;
}

SAVERS.register({
  id: 'starfield',
  name: 'Mark Starfield',
  controls: [
    { key: 'density', label: 'Density', min: 30, max: MAX_MARKS, step: 10, value: 100, format: v => String(v) }
  ],

  mount(host, opts) {
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
    if (!gl) { canvas.remove(); return null; }

    /* ───────────── State ───────────── */
    let wantDark = opts.theme !== 'light';
    let tDark = wantDark ? 1 : 0;                  // animated 0..1
    const speedScale = REDUCED ? 0.4 : 1;
    let speedTarget = opts.speed * speedScale, speed = speedTarget;
    let density = 100;
    let paused = false;
    let simTime = 0;
    let aspect = 1;
    let dead = false, raf = 0;
    const cam = { x: 0, y: 0 };
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const marks = [];

    /* ───────────── GL helpers ───────────── */
    function program(vs, fs) {
      const mk = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
      return { p, u };
    }

    function target(w, h) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo, w, h };
    }
    function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }

    /* ───────────── Shaders ───────────── */
    let markProg, blurProg, compProg;
    try {
      markProg = program(`#version 300 es
in vec2 a_corner;            // quad corner, -0.5..0.5
in vec4 a_inst;              // x, y, z, seed
uniform vec2  u_cam;
uniform float u_aspect, u_size, u_streak, u_time, u_markAspect;
out vec2  v_uv;
out float v_fog, v_aqua;
void main() {
  float z   = a_inst.z;
  vec2  rel = a_inst.xy - u_cam;
  vec2  dir = normalize(rel + vec2(1e-4));
  vec2  o   = a_corner * vec2(u_markAspect, 1.0);

  // Trailing corners sit deeper in z, which stretches the mark into a streak.
  float w  = clamp(0.5 - dot(normalize(o), dir) * 0.8, 0.0, 1.0);
  float zv = z * (1.0 + u_streak * w);

  float ang = sin(u_time * 0.4 + a_inst.w * 40.0) * 0.05;
  o = vec2(cos(ang) * o.x - sin(ang) * o.y, sin(ang) * o.x + cos(ang) * o.y);

  vec2 p = rel / zv + o * (u_size / zv);
  gl_Position = vec4(p.x / u_aspect, p.y, 0.0, 1.0);
  v_uv   = vec2(a_corner.x + 0.5, 0.5 - a_corner.y);
  v_fog  = smoothstep(1.0, 0.7, z);
  v_aqua = step(0.8, a_inst.w);
}`, `#version 300 es
precision highp float;
in vec2 v_uv; in float v_fog, v_aqua;
uniform sampler2D u_tex;
uniform float u_dark;
uniform vec3 u_aqua;
out vec4 o;
void main() {
  float a = texture(u_tex, v_uv).a * v_fog;
  vec3 dark = mix(vec3(0.98), u_aqua, v_aqua);
  vec3 col  = mix(vec3(0.0), dark, u_dark);
  o = vec4(col * a, a);
}`);

      const FS_VERT = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

      blurProg = program(FS_VERT, `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_dir;
uniform float u_thresh;
out vec4 o;
const float W[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
vec3 s(vec2 uv) { return max(texture(u_src, uv).rgb - u_thresh, 0.0); }
void main() {
  vec3 c = s(v_uv) * W[0];
  for (int i = 1; i < 5; i++) {
    c += (s(v_uv + u_dir * float(i)) + s(v_uv - u_dir * float(i))) * W[i];
  }
  o = vec4(c, 1.0);
}`);

      compProg = program(FS_VERT, `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene, u_bloom;
uniform float u_amount;
out vec4 o;
void main() {
  o = vec4(texture(u_scene, v_uv).rgb + texture(u_bloom, v_uv).rgb * u_amount, 1.0);
}`);
    } catch (err) {
      console.error('Starfield shader error:', err);
      canvas.remove();
      return null;
    }

    /* ───────────── Geometry ───────────── */
    const emptyVao = gl.createVertexArray();

    const markVao = gl.createVertexArray();
    gl.bindVertexArray(markVao);
    const cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5, -.5, .5, -.5, -.5, .5, .5, .5]), gl.STATIC_DRAW);
    const locCorner = gl.getAttribLocation(markProg.p, 'a_corner');
    gl.enableVertexAttribArray(locCorner);
    gl.vertexAttribPointer(locCorner, 2, gl.FLOAT, false, 0, 0);

    const instData = new Float32Array(MAX_MARKS * 4);
    const instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
    const locInst = gl.getAttribLocation(markProg.p, 'a_inst');
    gl.enableVertexAttribArray(locInst);
    gl.vertexAttribPointer(locInst, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(locInst, 1);
    gl.bindVertexArray(null);

    const markTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, markTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, getMarkCanvas());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    /* ───────────── Marks ───────────── */
    function spawn(m, initial) {
      let dx = (Math.random() * 2 - 1) * aspect * 1.05;
      let dy = (Math.random() * 2 - 1) * 1.05;
      const r = Math.hypot(dx, dy);
      if (r < 0.16) { const k = (0.16 + Math.random() * 0.1) / (r || 1); dx *= k; dy *= k; }
      m.x = cam.x + dx;
      m.y = cam.y + dy;
      m.z = initial ? Z_MIN + Math.random() * (1 - Z_MIN) : 1;
      m.s = Math.random();
      m.v = 0.8 + Math.random() * 0.45;
      return m;
    }
    function setDensity(n) {
      density = Math.max(30, Math.min(MAX_MARKS, Math.round(n)));
      while (marks.length < density) marks.push(spawn({}, true));
      while (marks.length > density) marks.splice((Math.random() * marks.length) | 0, 1);
    }

    /* ───────────── Size / targets ───────────── */
    let scene, bloomA, bloomB, dpr = 1;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(innerWidth * dpr));
      const h = Math.max(1, Math.floor(innerHeight * dpr));
      if (canvas.width === w && canvas.height === h && scene) return;
      canvas.width = w; canvas.height = h;
      aspect = w / h;
      [scene, bloomA, bloomB].forEach(freeTarget);
      scene  = target(w, h);
      bloomA = target(Math.max(1, w >> 2), Math.max(1, h >> 2));
      bloomB = target(Math.max(1, w >> 2), Math.max(1, h >> 2));
    }

    /* ───────────── Input ───────────── */
    const onPointerMove = e => {
      mouse.tx = (e.clientX / innerWidth - 0.5) * 2;
      mouse.ty = (0.5 - e.clientY / innerHeight) * 2;
    };
    const onContextLost = e => { e.preventDefault(); opts.onContextLost?.(); };
    addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('webglcontextlost', onContextLost);

    /* ───────────── Render loop ───────────── */
    let last = performance.now();
    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      resize();

      // theme crossfade
      const goal = wantDark ? 1 : 0;
      tDark += Math.sign(goal - tDark) * Math.min(Math.abs(goal - tDark), dt * 2.5);

      // simulation
      if (!paused) {
        simTime += dt;
        speed = lerp(speed, speedTarget, Math.min(1, dt * 3));
      }
      const ease = Math.min(1, dt * 2.5);
      mouse.x = lerp(mouse.x, mouse.tx, ease);
      mouse.y = lerp(mouse.y, mouse.ty, ease);
      const sway = REDUCED ? 0 : 1;
      cam.x = sway * (Math.sin(simTime * 0.13) * 0.18 + Math.sin(simTime * 0.071 + 1.3) * 0.10) + mouse.x * aspect * 0.3;
      cam.y = sway * (Math.cos(simTime * 0.11) * 0.12 + Math.sin(simTime * 0.059 + 0.4) * 0.08) + mouse.y * 0.3;

      if (!paused) {
        for (const m of marks) {
          m.z -= BASE_SPEED * speed * m.v * dt;
          const z = m.z;
          const px = (m.x - cam.x) / z, py = (m.y - cam.y) / z;
          const sz = (MARK_SIZE / z) * 0.9;
          if (z < Z_MIN || Math.abs(px) > aspect + sz * 1.7 || Math.abs(py) > 1 + sz) spawn(m, false);
        }
      }
      marks.sort((a, b) => b.z - a.z);           // far → near
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i], o = i * 4;
        instData[o] = m.x; instData[o + 1] = m.y; instData[o + 2] = m.z; instData[o + 3] = m.s;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData, 0, marks.length * 4);

      // scene
      const bg = BG_LIGHT.map((v, i) => lerp(v, BG_DARK[i], tDark));
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
      gl.viewport(0, 0, scene.w, scene.h);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      gl.useProgram(markProg.p);
      const mu = markProg.u;
      gl.uniform2f(mu.u_cam, cam.x, cam.y);
      gl.uniform1f(mu.u_aspect, aspect);
      gl.uniform1f(mu.u_size, MARK_SIZE);
      gl.uniform1f(mu.u_streak, 0.02 + Math.max(0, speed - 1) * 0.3);
      gl.uniform1f(mu.u_time, simTime);
      gl.uniform1f(mu.u_markAspect, TEX_W / TEX_H);
      gl.uniform1f(mu.u_dark, tDark);
      gl.uniform3fv(mu.u_aqua, AQUA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, markTex);
      gl.uniform1i(mu.u_tex, 0);
      gl.bindVertexArray(markVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, marks.length);
      gl.disable(gl.BLEND);

      // bloom (dark mode only)
      const doBloom = tDark > 0.01;
      gl.bindVertexArray(emptyVao);
      if (doBloom) {
        gl.useProgram(blurProg.p);
        gl.uniform1i(blurProg.u.u_src, 0);
        const pass = (src, dst, dx, dy, spread, thresh) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
          gl.viewport(0, 0, dst.w, dst.h);
          gl.bindTexture(gl.TEXTURE_2D, src.tex);
          gl.uniform2f(blurProg.u.u_dir, dx * spread / src.w, dy * spread / src.h);
          gl.uniform1f(blurProg.u.u_thresh, thresh);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        pass(scene,  bloomA, 1, 0, 3.0, 0.32);
        pass(bloomA, bloomB, 0, 1, 1.5, 0);
        pass(bloomB, bloomA, 1, 0, 3.0, 0);
        pass(bloomA, bloomB, 0, 1, 3.0, 0);
      }

      // composite
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(compProg.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
      gl.uniform1i(compProg.u.u_scene, 0);
      gl.uniform1i(compProg.u.u_bloom, 1);
      gl.uniform1f(compProg.u.u_amount, doBloom ? tDark * 0.55 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }

    /* ───────────── Go ───────────── */
    resize();
    setDensity(opts.params?.density ?? 100);
    raf = requestAnimationFrame(t => { last = t; frame(t); });

    return {
      setTheme(t, animate = true) {
        wantDark = t !== 'light';
        if (!animate) tDark = wantDark ? 1 : 0;
      },
      setSpeed(v) { speedTarget = v * speedScale; },
      setParam(key, v) { if (key === 'density') setDensity(v); },
      setPaused(p) { paused = p; },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.remove();
      }
    };
  }
});
})();
