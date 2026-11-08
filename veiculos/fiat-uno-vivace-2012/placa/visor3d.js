// Visor 3D da placa ilhada: WebGL puro, sem bibliotecas. Lê window.PLACA3D (modelo3d-dados.js, gerado por gerar_3d.py).
(function () {
  'use strict';
  const D = window.PLACA3D;
  const canvas = document.getElementById('cena');
  const gl = canvas.getContext('webgl', { antialias: true });
  if (!D || !gl) {
    document.getElementById('aviso').hidden = false;
    return;
  }

  // ------------------------------------------------------------ vetores
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => mul(a, 1 / (len(a) || 1));
  const hex = (c) => {
    const n = parseInt(c.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  // placa (x para a direita, y para baixo, z para cima) -> mundo (x, altura, profundidade), centrado
  const W = (p) => [p[0] - D.W / 2, p[2], p[1] - D.H / 2];

  // ------------------------------------------------------------ geometria por camada
  const geo = {};
  const G = (name) => geo[name] || (geo[name] = { v: [] });
  function tri(l, a, b, c, na, nb, nc, col) {
    l.v.push(...a, ...na, ...col, ...b, ...nb, ...col, ...c, ...nc, ...col);
  }
  function box(l, c, s, col) {
    const h = [s[0] / 2, s[1] / 2, s[2] / 2];
    for (let ax = 0; ax < 3; ax++) {
      for (const sg of [-1, 1]) {
        const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
        const n = [0, 0, 0];
        n[ax] = sg;
        const pt = (u, v) => {
          const p = c.slice();
          p[ax] += sg * h[ax];
          p[a1] += u * h[a1];
          p[a2] += v * h[a2];
          return p;
        };
        const q = [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)];
        tri(l, q[0], q[1], q[2], n, n, n, col);
        tri(l, q[0], q[2], q[3], n, n, n, col);
      }
    }
  }
  function basis(k) {
    const t = Math.abs(k[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = unit(cross(k, t));
    return [u, cross(k, u)];
  }
  function cyl(l, a, b, r, col, seg) {
    seg = seg || 14;
    const d = sub(b, a);
    const L = len(d);
    if (L < 1e-6) return;
    const k = mul(d, 1 / L);
    const [u, v] = basis(k);
    const nk = mul(k, -1);
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * 2 * Math.PI, t1 = ((i + 1) / seg) * 2 * Math.PI;
      const n0 = add(mul(u, Math.cos(t0)), mul(v, Math.sin(t0)));
      const n1 = add(mul(u, Math.cos(t1)), mul(v, Math.sin(t1)));
      const a0 = add(a, mul(n0, r)), a1 = add(a, mul(n1, r)), b0 = add(b, mul(n0, r)), b1 = add(b, mul(n1, r));
      tri(l, a0, a1, b1, n0, n1, n1, col);
      tri(l, a0, b1, b0, n0, n1, n0, col);
      tri(l, a, a1, a0, nk, nk, nk, col);
      tri(l, b, b0, b1, k, k, k, col);
    }
  }
  function disc(l, c, n, r, col, seg) {
    const [u, v] = basis(n);
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * 2 * Math.PI, t1 = ((i + 1) / seg) * 2 * Math.PI;
      const p0 = add(c, mul(add(mul(u, Math.cos(t0)), mul(v, Math.sin(t0))), r));
      const p1 = add(c, mul(add(mul(u, Math.cos(t1)), mul(v, Math.sin(t1))), r));
      tri(l, c, p0, p1, n, n, n, col);
    }
  }
  function ball(l, c, r, col) {
    const la = 6, lo = 10;
    const pt = (i, j) => {
      const th = (i / la) * Math.PI, ph = (j / lo) * 2 * Math.PI;
      return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    };
    for (let i = 0; i < la; i++) {
      for (let j = 0; j < lo; j++) {
        const n00 = pt(i, j), n01 = pt(i, j + 1), n10 = pt(i + 1, j), n11 = pt(i + 1, j + 1);
        const P = (n) => add(c, mul(n, r));
        tri(l, P(n00), P(n10), P(n11), n00, n10, n11, col);
        tri(l, P(n00), P(n11), P(n01), n00, n11, n01, col);
      }
    }
  }

  // ilhas de cobre dos dois lados
  const gp = D.grid;
  const placa = G('placa');
  const cobre = hex('#d4a24c'), furo = hex('#4e3b22');
  for (let c = 1; c <= gp.cols; c++) {
    for (let r = 1; r <= gp.rows; r++) {
      const x = gp.mx + (c - 1) * gp.p, y = gp.my + (r - 1) * gp.p;
      disc(placa, W([x, y, gp.t + 0.01]), [0, 1, 0], 0.88, cobre, 12);
      disc(placa, W([x, y, gp.t + 0.02]), [0, 1, 0], 0.42, furo, 8);
      disc(placa, W([x, y, -0.01]), [0, -1, 0], 0.88, cobre, 12);
      disc(placa, W([x, y, -0.02]), [0, -1, 0], 0.42, furo, 8);
    }
  }
  for (const p of D.parts) {
    const l = G(p[0]);
    const col = hex(p[2]);
    if (p[1] === 'box') box(l, W(p[3]), [p[4][0], p[4][2], p[4][1]], col);
    else if (p[1] === 'cyl') cyl(l, W(p[3]), W(p[4]), p[5], col);
    else ball(l, W(p[3]), p[4], col);
  }

  // ------------------------------------------------------------ WebGL
  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, [
    'attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;',
    'uniform mat4 uMVP; varying vec3 vNor; varying vec3 vCol;',
    'void main() { gl_Position = uMVP * vec4(aPos, 1.0); vNor = aNor; vCol = aCol; }',
  ].join('\n')));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, [
    'precision mediump float; varying vec3 vNor; varying vec3 vCol;',
    'void main() {',
    '  vec3 n = normalize(vNor);',
    '  float d1 = max(dot(n, normalize(vec3(0.35, 1.0, 0.55))), 0.0);',
    '  float d2 = max(dot(n, normalize(vec3(-0.5, -0.7, -0.4))), 0.0);',
    '  gl_FragColor = vec4(vCol * (0.36 + 0.62 * d1 + 0.5 * d2), 1.0);',
    '}',
  ].join('\n')));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aNor = gl.getAttribLocation(prog, 'aNor');
  const aCol = gl.getAttribLocation(prog, 'aCol');
  const uMVP = gl.getUniformLocation(prog, 'uMVP');
  gl.enableVertexAttribArray(aPos);
  gl.enableVertexAttribArray(aNor);
  gl.enableVertexAttribArray(aCol);
  gl.enable(gl.DEPTH_TEST);

  const buffers = {};
  for (const [name, g] of Object.entries(geo)) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.v), gl.STATIC_DRAW);
    buffers[name] = { b, n: g.v.length / 9 };
  }
  const visible = { placa: true };
  for (const [key] of D.layers) visible[key] = true;

  // ------------------------------------------------------------ câmera
  const VIEWS = {
    perspectiva: { yaw: -0.55, pitch: 0.72, dist: 165 },
    cima: { yaw: 0, pitch: 1.5607, dist: 150 },
    baixo: { yaw: Math.PI, pitch: -1.5607, dist: 150 },   // espelhada, linha 1 no topo, como baixo.svg
    lado: { yaw: 0, pitch: 0.06, dist: 115 },
  };
  const cam = { yaw: 0, pitch: 0, dist: 0, target: [0, 5, 0] };
  function setView(name) {
    Object.assign(cam, VIEWS[name], { target: [0, 5, 0] });
    draw();
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(e, c, up) {
    const z = unit(sub(e, c)), x = unit(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mat(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  function eye() {
    const cp = Math.cos(cam.pitch);
    return add(cam.target, mul([cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)], cam.dist));
  }

  let pending = false;
  function draw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(render);
  }
  function render() {
    pending = false;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    const bg = hex(getComputedStyle(document.documentElement).getPropertyValue('--fundo-cena').trim() || '#e9eef2');
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const mvp = mat(perspective(0.7, w / h, 1, 2000), lookAt(eye(), cam.target, [0, 1, 0]));
    gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvp));
    for (const [name, buf] of Object.entries(buffers)) {
      if (!visible[name]) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.b);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 36, 0);
      gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 36, 12);
      gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 36, 24);
      gl.drawArrays(gl.TRIANGLES, 0, buf.n);
    }
  }

  // ------------------------------------------------------------ mouse e toque
  const pointers = new Map();
  let pinch = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) cam.dist = Math.min(400, Math.max(25, cam.dist * (pinch / d)));
      pinch = d;
    } else if (p.pan) {
      const e0 = eye();
      const f = unit(sub(cam.target, e0));
      const right = unit(cross(f, [0, 1, 0]));
      const up = cross(right, f);
      const s = cam.dist * 0.0016;
      cam.target = add(cam.target, add(mul(right, -dx * s), mul(up, dy * s)));
    } else {
      cam.yaw -= dx * 0.008;
      cam.pitch = Math.min(1.5607, Math.max(-1.5607, cam.pitch + dy * 0.008));
    }
    draw();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.min(400, Math.max(25, cam.dist * Math.exp(e.deltaY * 0.001)));
    draw();
  }, { passive: false });
  window.addEventListener('resize', draw);
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);

  // ------------------------------------------------------------ controles
  for (const btn of document.querySelectorAll('[data-vista]')) {
    btn.addEventListener('click', () => setView(btn.dataset.vista));
  }
  const box_ = document.getElementById('camadas');
  for (const [key, label] of D.layers) {
    const lab = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', () => {
      visible[key] = input.checked;
      draw();
    });
    lab.append(input, ' ' + label);
    box_.append(lab);
  }
  const inicial = location.hash.slice(1);
  setView(VIEWS[inicial] ? inicial : 'perspectiva');
})();
