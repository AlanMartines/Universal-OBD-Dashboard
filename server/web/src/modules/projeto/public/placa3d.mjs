// Placa da escuta CAN em 3D, com detalhe: Three.js local (/vendor/three/), sem CDN.
// As posições vêm de window.PLACA3D.detalhe (modelo3d-dados.js, gerado por gerar_3d.py na pasta do veículo).
// As texturas dos módulos são desenhadas aqui (nenhuma foto de terceiros).
import * as THREE from '/vendor/three/three.module.js';

const D = window.PLACA3D;
const X = D && D.detalhe;
const canvas = document.getElementById('cena');
const aviso = document.getElementById('aviso');
const dica = document.getElementById('dica3d');

function falhou() {
  if (aviso) aviso.hidden = false;
}

if (!X || !canvas) {
  falhou();
} else {
  try {
    iniciar();
  } catch (erro) {
    falhou();
    throw erro;
  }
}

function iniciar() {
  const A = X.alturas;
  const P = D.grid.p;

  // ------------------------------------------------------------ cena
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(ambiente(), 0.03).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 3000);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 0.6));
  const sol = new THREE.DirectionalLight(0xffffff, 2.4);
  sol.position.set(45, 110, 60);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.radius = 3;
  sol.shadow.camera.left = -70;
  sol.shadow.camera.right = 70;
  sol.shadow.camera.top = 70;
  sol.shadow.camera.bottom = -70;
  sol.shadow.camera.near = 10;
  sol.shadow.camera.far = 300;
  sol.shadow.bias = -0.0004;
  sol.shadow.normalBias = 0.03;
  scene.add(sol);
  const contraluz = new THREE.DirectionalLight(0xdde6ff, 1.6);
  contraluz.position.set(-60, -40, -50);
  scene.add(contraluz);

  const chao = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.16 }));
  chao.rotation.x = -Math.PI / 2;
  chao.position.y = -1.6;
  chao.receiveShadow = true;
  scene.add(chao);

  // placa (x para a direita, y para baixo, z para cima) -> mundo (x, altura, profundidade), centrado
  const W = (x, y, z) => new THREE.Vector3(x - D.W / 2, z, y - D.H / 2);

  const camadas = { placa: new THREE.Group() };
  for (const [key] of D.layers) camadas[key] = new THREE.Group();
  for (const g of Object.values(camadas)) scene.add(g);

  function poe(obj, camada, nome) {
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    if (nome) obj.userData.nome = nome;
    camadas[camada].add(obj);
    return obj;
  }

  // ------------------------------------------------------------ materiais
  const std = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const M = {
    placa: std(0xb89a6a, 0.82),
    cobre: std(0xd08c45, 0.32, 1),
    furo: std(0x2a1d10, 0.9),
    estanho: std(0xd9dee3, 0.22, 1),
    ouro: std(0xe6b94a, 0.28, 1),
    niquel: std(0xc3c8cc, 0.3, 1),
    preto: std(0x161616, 0.55),
    pretoFosco: std(0x1d1d1f, 0.75),
    nylon: std(0x202326, 0.6),
    bobina: std(0x2b2b2d, 0.7),
    ceramica: std(0xc8a27a, 0.6),
    resistor: std(0x1b1b1b, 0.5),
    branco: std(0xf2f2f2, 0.45),
    trimpot: std(0xe9e4da, 0.5),
    led: std(0xd32f2f, 0.25, 0, { emissive: 0x5a0000 }),
  };
  const PCB = {
    esp: std(0x0f1846, 0.5),
    tja: std(0x0d469c, 0.45),
    rt: std(0x0b4396, 0.45),
    modulo: std(0x111214, 0.55),
  };

  function textura(wmm, hmm, desenhar, pxmm = 28) {
    const c = document.createElement('canvas');
    c.width = Math.round(wmm * pxmm);
    c.height = Math.round(hmm * pxmm);
    const ctx = c.getContext('2d');
    ctx.scale(pxmm, pxmm);
    desenhar(ctx);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  function texto(ctx, s, x, y, tam, cor, { peso = 600, alinha = 'center', rot = 0 } = {}) {
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.fillStyle = cor;
    ctx.font = `${peso} ${tam}px "DejaVu Sans", Arial, sans-serif`;
    ctx.textAlign = alinha;
    ctx.textBaseline = 'middle';
    ctx.fillText(s, 0, 0);
    ctx.restore();
  }
  function ilha(ctx, x, y, r, quadrada = false) {
    ctx.fillStyle = '#e3c06a';
    if (quadrada) ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#20180c';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  function contorno(ctx, x, y, w, h, cor = '#f4f4f4', lw = 0.18) {
    ctx.strokeStyle = cor;
    ctx.lineWidth = lw;
    ctx.strokeRect(x, y, w, h);
  }
  function trilhaTex(ctx, pts, cor, lw = 0.35) {
    ctx.strokeStyle = cor;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }

  /** Placa com textura só na face de cima. Canto (x0, y0) em mm da placa, base em z. */
  function placaModulo(x0, y0, l, w, z, esp, lado, tex, baixo) {
    const mats = [lado, lado, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), baixo || lado, lado, lado];
    const m = new THREE.Mesh(new THREE.BoxGeometry(l, esp, w), mats);
    m.position.copy(W(x0 + l / 2, y0 + w / 2, z + esp / 2));
    return m;
  }
  function caixa(l, h, w, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(l, h, w), mat);
    m.position.copy(W(x, y, z + h / 2));
    return m;
  }
  function cilindro(a, b, r, mat, seg = 16) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), seg), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return m;
  }

  // ------------------------------------------------------------ componentes SMD
  /** Chip SOP-8: corpo preto com marcação e 4 pernas de cada lado. eixo 'x' = pernas saem em ±y da placa. */
  function sop8(x, y, z, marca, pernasEmX = false) {
    const g = new THREE.Group();
    const bl = 4.9, bw = 3.9, bh = 1.5;
    const tex = textura(bl, bw, (ctx) => {
      ctx.fillStyle = '#1f1f21';
      ctx.fillRect(0, 0, bl, bw);
      texto(ctx, marca[0], bl / 2, bw * 0.38, 0.62, '#cfcfcf', { peso: 500 });
      if (marca[1]) texto(ctx, marca[1], bl / 2, bw * 0.68, 0.5, '#bdbdbd', { peso: 500 });
      ctx.fillStyle = '#3a3a3c';
      ctx.beginPath();
      ctx.arc(0.6, bw - 0.6, 0.28, 0, Math.PI * 2);
      ctx.fill();
    }, 60);
    const corpo = new THREE.Mesh(new THREE.BoxGeometry(bl, bh, bw), [M.preto, M.preto, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), M.preto, M.preto, M.preto]);
    corpo.position.y = 0.15 + bh / 2;
    g.add(corpo);
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) {
        const px = -1.905 + i * 1.27;
        const perna = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 1.1), M.estanho);
        perna.position.set(px, 0.1, s * (bw / 2 + 0.5));
        g.add(perna);
        const subida = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.2), M.estanho);
        subida.position.set(px, 0.45, s * (bw / 2 + 0.05));
        g.add(subida);
      }
    }
    if (pernasEmX) g.rotation.y = Math.PI / 2;
    g.position.copy(W(x, y, z));
    return g;
  }
  /** Regulador SOT-223: corpo, aba larga de um lado e três pernas do outro. */
  function sot223(x, y, z, marca) {
    const g = new THREE.Group();
    const tex = textura(6.5, 3.5, (ctx) => {
      ctx.fillStyle = '#1f1f21';
      ctx.fillRect(0, 0, 6.5, 3.5);
      texto(ctx, marca, 3.25, 1.75, 0.8, '#cfcfcf', { peso: 500 });
    }, 60);
    const corpo = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.6, 3.5), [M.preto, M.preto, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), M.preto, M.preto, M.preto]);
    corpo.position.y = 0.9;
    g.add(corpo);
    const aba = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.25, 1.6), M.estanho);
    aba.position.set(0, 0.12, -2.45);
    g.add(aba);
    for (const px of [-2.3, 0, 2.3]) {
      const perna = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 1.6), M.estanho);
      perna.position.set(px, 0.12, 2.45);
      g.add(perna);
    }
    g.position.copy(W(x, y, z));
    return g;
  }
  /** Resistor ou capacitor SMD (0805/1206): corpo e duas pontas estanhadas. */
  function smd(x, y, z, comp, larg, corpoMat, rotacionar = false, marca = null) {
    const g = new THREE.Group();
    const h = comp > 2.5 ? 0.9 : 0.55;
    const ponta = Math.min(0.5, comp * 0.22);
    let mat = corpoMat;
    if (marca) {
      const tex = textura(comp - 2 * ponta, larg, (ctx) => {
        ctx.fillStyle = '#151515';
        ctx.fillRect(0, 0, comp, larg);
        texto(ctx, marca, (comp - 2 * ponta) / 2, larg / 2, larg * 0.62, '#eaeaea', { peso: 500 });
      }, 80);
      mat = [corpoMat, corpoMat, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), corpoMat, corpoMat, corpoMat];
    }
    const corpo = new THREE.Mesh(new THREE.BoxGeometry(comp - 2 * ponta, h, larg), mat);
    corpo.position.y = h / 2;
    g.add(corpo);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(ponta, h + 0.02, larg + 0.02), M.estanho);
      p.position.set(s * (comp / 2 - ponta / 2), h / 2, 0);
      g.add(p);
    }
    if (rotacionar) g.rotation.y = Math.PI / 2;
    g.position.copy(W(x, y, z));
    return g;
  }
  /** Pinos macho saindo de um módulo para baixo, com o plástico separador e a solda por cima. */
  function barraMacho(pinos, zTopo, camada, nome, comPlastico = true) {
    const g = new THREE.Group();
    const xs = pinos.map((p) => p[0]), ys = pinos.map((p) => p[1]);
    if (comPlastico) {
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const lx = Math.max(...xs) - Math.min(...xs) + P, ly = Math.max(...ys) - Math.min(...ys) + P;
      g.add(caixa(lx, A.MALE_H, ly, M.preto, cx, cy, A.T));
    }
    for (const [x, y] of pinos) {
      g.add(cilindro(W(x, y, -0.95), W(x, y, zTopo + 0.7), 0.32, M.ouro, 4));
      g.add(solda(x, y, zTopo, 0.75, 0.55, false));
    }
    return poe(g, camada, nome);
  }

  // ------------------------------------------------------------ solda e ilhas
  const perfilSolda = [[0.001, 0], [1, 0], [0.86, 0.22], [0.55, 0.55], [0.32, 0.85], [0.001, 1]].map(([r, h]) => new THREE.Vector2(r, h));
  const geoSolda = new THREE.LatheGeometry(perfilSolda, 18);
  function solda(x, y, z, raio, altura, paraBaixo) {
    const m = new THREE.Mesh(geoSolda, M.estanho);
    m.scale.set(raio, altura, raio);
    if (paraBaixo) m.rotation.x = Math.PI;
    m.position.copy(W(x, y, z));
    return m;
  }

  // placa perfurada
  {
    const g = new THREE.Group();
    const placa = new THREE.Mesh(new THREE.BoxGeometry(D.W, A.T, D.H), M.placa);
    placa.position.y = A.T / 2;
    g.add(placa);
    const n = D.grid.cols * D.grid.rows;
    const geoIlha = new THREE.CylinderGeometry(0.88, 0.88, 0.05, 20);
    const geoFuro = new THREE.CylinderGeometry(0.45, 0.45, 0.06, 12);
    const ilhas = new THREE.InstancedMesh(geoIlha, M.cobre, n * 2);
    const furos = new THREE.InstancedMesh(geoFuro, M.furo, n * 2);
    const m4 = new THREE.Matrix4();
    let i = 0;
    for (let c = 1; c <= D.grid.cols; c++) {
      for (let r = 1; r <= D.grid.rows; r++) {
        const x = D.grid.mx + (c - 1) * P, y = D.grid.my + (r - 1) * P;
        for (const z of [A.T + 0.025, -0.025]) {
          m4.makeTranslation(W(x, y, z));
          ilhas.setMatrixAt(i, m4);
          m4.makeTranslation(W(x, y, z > 0 ? z + 0.01 : z - 0.01));
          furos.setMatrixAt(i, m4);
          i++;
        }
      }
    }
    ilhas.receiveShadow = true;
    g.add(ilhas, furos);
    poe(g, 'placa', 'Placa perfurada 5 × 7 cm (18 × 24 furos)');
    ilhas.castShadow = false;
    furos.castShadow = false;
  }

  // ------------------------------------------------------------ barras fêmea e ESP32
  const E = X.esp32;
  const filas = [E.pinos.slice(0, 15), E.pinos.slice(15)];
  for (const fila of filas) {
    const g = new THREE.Group();
    const x1 = fila[0].p[0], x2 = fila[14].p[0], y = fila[0].p[1];
    g.add(caixa(x2 - x1 + P, A.FEM_H, P, M.nylon, (x1 + x2) / 2, y, A.T));
    for (const pin of fila) {
      const furo = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 1.0), M.furo);
      furo.position.copy(W(pin.p[0], pin.p[1], A.T + A.FEM_H + 0.01));
      g.add(furo);
      g.add(cilindro(W(pin.p[0], pin.p[1], -0.95), W(pin.p[0], pin.p[1], A.T), 0.3, M.estanho, 4));
    }
    poe(g, 'placa', 'Barra de pinos fêmea do ESP32 (15 pinos)');
  }
  {
    const g = new THREE.Group();
    const topo = A.ESP_Z + 1.6;
    const usados = new Set(E.pinos.filter((p) => p.usado).map((p) => p.n + p.p[1]));
    const tex = textura(E.l, E.w, (ctx) => {
      ctx.fillStyle = '#121c52';
      ctx.fillRect(0, 0, E.l, E.w);
      // trilhas decorativas
      for (let k = 0; k < 6; k++) trilhaTex(ctx, [[33 + k * 1.2, 4.2], [33 + k * 1.2, 6.5], [35 + k * 0.9, 7.6]], 'rgba(90,120,220,0.35)', 0.22);
      for (const fila2 of filas) {
        for (const pin of fila2) {
          const px = pin.p[0] - E.x0, py = pin.p[1] - E.y0;
          ilha(ctx, px, py, 0.85, pin.n === 'GND' && py < 5);
          const emCima = py < E.w / 2;
          const cor = usados.has(pin.n + pin.p[1]) ? '#ffd54f' : '#f2f2f2';
          texto(ctx, pin.n, px, emCima ? py + 2.0 : py - 2.0, 0.78, cor, { rot: -Math.PI / 2, alinha: emCima ? 'right' : 'left' });
        }
      }
      contorno(ctx, 0.5, 0.5, E.l - 1, E.w - 1, 'rgba(255,255,255,0.65)', 0.15);
      texto(ctx, 'ESP32 DEVKIT V1', 29.0, 14, 1.15, '#ffffff', { peso: 700, rot: -Math.PI / 2 });
      texto(ctx, 'DOIT', 31.0, 14, 0.85, '#e0e0e0', { rot: -Math.PI / 2 });
      texto(ctx, 'EN', 41.7, 22.4, 0.8, '#ffffff');
      texto(ctx, 'BOOT', 41.7, 5.3, 0.8, '#ffffff');
      contorno(ctx, 33, 15.5, 6.6, 6.6, 'rgba(255,255,255,0.7)');
    });
    g.add(placaModulo(E.x0, E.y0, E.l, E.w, A.ESP_Z, 1.6, PCB.esp, tex));
    // plástico das barras macho e pinos
    for (const fila of filas) {
      const x1 = fila[0].p[0], x2 = fila[14].p[0], y = fila[0].p[1];
      g.add(caixa(x2 - x1 + P, A.MALE_H, P, M.preto, (x1 + x2) / 2, y, A.T + A.FEM_H));
      for (const pin of fila) {
        g.add(cilindro(W(pin.p[0], pin.p[1], A.T + A.FEM_H - 3), W(pin.p[0], pin.p[1], topo + 0.6), 0.32, M.ouro, 4));
        g.add(solda(pin.p[0], pin.p[1], topo, 0.8, 0.55, false));
      }
    }
    // módulo ESP-WROOM-32: placa preta com antena impressa e blindagem metálica
    const cy = E.y0 + E.w / 2;
    const mx0 = E.x0 + 1.0;
    const texMod = textura(25.5, 18, (ctx) => {
      ctx.fillStyle = '#121214';
      ctx.fillRect(0, 0, 25.5, 18);
      trilhaTex(ctx, [[1.2, 2], [5.4, 2], [5.4, 4], [1.6, 4], [1.6, 6], [5.4, 6], [5.4, 8], [1.6, 8], [1.6, 10], [5.4, 10], [5.4, 12], [1.6, 12], [1.6, 14], [5.4, 14], [5.4, 16]], '#c9a227', 0.45);
      for (let k = 0; k < 13; k++) {
        ctx.fillStyle = '#d4af37';
        ctx.fillRect(7.5 + k * 1.27, 17.2, 0.6, 0.8);
        ctx.fillRect(7.5 + k * 1.27, 0, 0.6, 0.8);
      }
    }, 40);
    g.add(placaModulo(mx0, cy - 9, 25.5, 18, topo, 0.8, PCB.modulo, texMod));
    const texBlind = textura(18, 16, (ctx) => {
      ctx.fillStyle = '#b9bfc4';
      ctx.fillRect(0, 0, 18, 16);
      const linhas = [['ESPRESSIF', 1.2, 700], ['ESP32-WROOM-32', 1.15, 700], ['Wi-Fi + BT + BLE', 0.85, 500], ['MCU', 0.85, 500], ['FCC ID: 2AC7Z-ESPWROOM32', 0.62, 500], ['CE  R 211-161007', 0.62, 500]];
      linhas.forEach(([s, t, p], k) => texto(ctx, s, 9, 3.0 + k * 2.0, t, '#5d6368', { peso: p }));
      contorno(ctx, 0.3, 0.3, 17.4, 15.4, '#9aa0a5', 0.2);
    }, 40);
    const blind = new THREE.Mesh(new THREE.BoxGeometry(18, 2.4, 16), [M.niquel, M.niquel, std(0xffffff, 0.38, 0.85, { map: texBlind }), M.niquel, M.niquel, M.niquel]);
    blind.position.copy(W(mx0 + 6.5 + 9, cy, topo + 0.8 + 1.2));
    g.add(blind);
    // micro-USB, botões, regulador, CP2102, LED
    const usb = caixa(5.6, 2.6, 7.6, M.niquel, E.x0 + E.l - 1.6, cy, topo);
    g.add(usb);
    const boca = caixa(0.1, 1.3, 6.0, M.furo, E.x0 + E.l + 1.25, cy, topo + 0.6);
    g.add(boca);
    for (const by of [cy - 8.6, cy + 8.6]) {
      g.add(caixa(5.2, 1.4, 3.4, M.niquel, E.x0 + 41.7, by, topo));
      const botao = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.7, 20), M.preto);
      botao.position.copy(W(E.x0 + 41.7, by, topo + 1.75));
      g.add(botao);
    }
    g.add(sot223(E.x0 + 36.5, cy - 4.6, topo, 'AMS1117'));
    g.add(caixa(4.4, 0.9, 4.4, M.preto, E.x0 + 36.5, cy + 4.2, topo));
    g.add(smd(E.x0 + 30, cy + 7.6, topo, 1.6, 0.8, M.ceramica));
    g.add(smd(E.x0 + 30, cy - 7.6, topo, 1.6, 0.8, M.ceramica));
    g.add(smd(E.x0 + 46.6, cy - 6.2, topo, 1.6, 0.8, M.led, true));
    g.add(smd(E.x0 + 32.2, cy + 1, topo, 2.0, 1.25, M.resistor, true));
    poe(g, 'esp32', 'ESP32 DevKit V1 (30 pinos), encaixado nas barras fêmea');
  }

  // ------------------------------------------------------------ TJA1050
  {
    const T = X.tja;
    const g = new THREE.Group();
    const z = A.MOD_Z, topo = A.MOD_Z + A.MOD_T;
    const tex = textura(T.l, T.w, (ctx) => {
      ctx.fillStyle = '#0f4fae';
      ctx.fillRect(0, 0, T.l, T.w);
      trilhaTex(ctx, [[1.2, 3.7], [4, 3.7], [5.6, 5.4]], 'rgba(120,180,255,0.45)', 0.28);
      trilhaTex(ctx, [[1.2, 6.3], [4.5, 6.3], [5.6, 7]], 'rgba(120,180,255,0.45)', 0.28);
      trilhaTex(ctx, [[10.6, 5.2], [14, 5.2], [19.4, 3.9]], 'rgba(120,180,255,0.45)', 0.28);
      trilhaTex(ctx, [[10.6, 7.2], [14, 7.2], [19.4, 6.5]], 'rgba(120,180,255,0.45)', 0.28);
      T.pinos.forEach((p, k) => {
        const px = p.p[0] - T.x0, py = p.p[1] - T.y0;
        ilha(ctx, px, py, 0.85, k === 3);
        texto(ctx, p.n, px + 1.45, py, 0.75, '#ffffff', { alinha: 'left' });
      });
      T.can.forEach((p) => {
        const px = p.p[0] - T.x0, py = p.p[1] - T.y0;
        ilha(ctx, px, py, 0.8);
        texto(ctx, p.n, px - 1.3, py, 0.7, '#ffffff', { alinha: 'right' });
      });
      for (const hy of [1.8, T.w - 1.8]) {
        ctx.fillStyle = '#e3c06a';
        ctx.beginPath();
        ctx.arc(T.l - 2.9, hy, 1.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0c1a2e';
        ctx.beginPath();
        ctx.arc(T.l - 2.9, hy, 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      texto(ctx, 'C5', 6.0, 0.55, 0.55, '#ffffff');
      texto(ctx, 'C3', 9.6, 0.55, 0.55, '#ffffff');
      texto(ctx, 'R1', 15.6, 1.5, 0.55, '#ffffff');
      texto(ctx, 'R2/R6', 15.8, 5.4, 0.5, '#ffffff');
      contorno(ctx, 4.7, 4.4, 6.6, 6.2, 'rgba(255,255,255,0.8)', 0.14);
    });
    g.add(placaModulo(T.x0, T.y0, T.l, T.w, z, A.MOD_T, PCB.tja, tex));
    const yc = T.y0 + T.w / 2;
    g.add(sop8(T.x0 + 8.0, yc + 1.9, topo, ['A1050/C', 'TJA1050'], false));
    g.add(smd(T.x0 + 6.0, T.y0 + 1.6, topo, 2.0, 1.25, M.ceramica));
    g.add(smd(T.x0 + 9.6, T.y0 + 1.6, topo, 2.0, 1.25, M.ceramica));
    g.add(smd(T.x0 + 14.2, T.y0 + 2.6, topo, 2.0, 1.25, M.resistor, false, '121'));
    g.add(smd(T.x0 + 14.2, T.y0 + 6.4, topo, 2.0, 1.25, M.resistor, false, '000'));
    g.add(smd(T.x0 + 14.2, T.y0 + 9.0, topo, 2.0, 1.25, M.ceramica));
    poe(g, 'modulos', 'TJA1050: transceptor CAN, só escuta (TX preso nos 5 V)');
    // CANH e CANL: perna curta (sobra de perna de resistor) do pino até a ilha logo abaixo; a ligação segue por baixo
    for (const p of T.can) {
      const perna = new THREE.Group();
      const [x, y] = p.p, [hx, hy] = p.furo;
      const curva = new THREE.CatmullRomCurve3([W(x, y, topo + 0.6), W(x, y, topo - 0.2), W(x, y, A.T + 1.6), W(hx, hy, A.T + 0.3), W(hx, hy, -0.9)], false, 'centripetal');
      perna.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 40, 0.3, 8), M.estanho));
      perna.add(solda(x, y, topo, 0.75, 0.5, false));
      poe(perna, 'modulos', `Perna do ${p.n}: do pino do TJA1050 até a ilha (${p.n === 'CANH' ? '18,20' : '18,21'})`);
    }
    barraMacho(T.pinos.map((p) => p.p), topo, 'modulos', 'Barra de 4 pinos do TJA1050: VCC, TX, RX, GND');
  }

  // ------------------------------------------------------------ RT8272
  {
    const R = X.rt;
    const g = new THREE.Group();
    const z = A.MOD_Z, topo = A.MOD_Z + A.MOD_T, L = R.lado;
    const tex = textura(L, L, (ctx) => {
      ctx.fillStyle = '#0d4ba6';
      ctx.fillRect(0, 0, L, L);
      R.pinos.forEach((p) => {
        const px = p.p[0] - R.x0, py = p.p[1] - R.y0;
        ilha(ctx, px, py, 0.85, p.n === 'EN' || p.n === 'OUT+');
        contorno(ctx, px - 1.3, py - 1.3, 2.6, 2.6, 'rgba(255,255,255,0.8)', 0.12);
      });
      contorno(ctx, 0.6, 0.6, 4.4, 4.4);
      contorno(ctx, 5.2, 1.3, 7.4, 6.6);
      contorno(ctx, 14.3, 2.6, 3.4, 5.6);
      contorno(ctx, 3.2, 9.2, 7.2, 3.6);
      contorno(ctx, 3.6, 14.2, 3.2, 5.0);
      contorno(ctx, 10.2, 9.2, 9.6, 9.6);
      trilhaTex(ctx, [[12.6, 4.6], [16, 4.6], [19.7, 3.5]], 'rgba(120,180,255,0.45)', 0.5);
      trilhaTex(ctx, [[2, 18], [2, 13], [6, 11]], 'rgba(120,180,255,0.45)', 0.5);
      texto(ctx, 'K', 19.8, 8.6, 0.7, '#ffffff');
    });
    g.add(placaModulo(R.x0, R.y0, L, L, z, A.MOD_T, PCB.rt, tex));
    // trimpot
    g.add(caixa(3.6, 1.0, 3.6, M.trimpot, R.x0 + 2.8, R.y0 + 2.8, topo));
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.6, 24), M.niquel);
    rotor.position.copy(W(R.x0 + 2.8, R.y0 + 2.8, topo + 1.3));
    g.add(rotor);
    g.add(caixa(1.8, 0.1, 0.35, M.furo, R.x0 + 2.8, R.y0 + 2.8, topo + 1.6));
    // chip RT8272 com as pernas para os lados
    g.add(sop8(R.x0 + 8.9, R.y0 + 4.6, topo, ['RT8272', 'GSPBEC2E'], true));
    g.add(smd(R.x0 + 16, R.y0 + 5.4, topo, 3.2, 1.6, M.ceramica, true));
    g.add(smd(R.x0 + 8.6, R.y0 + 0.9, topo, 1.6, 0.8, M.resistor, false, '19E'));
    g.add(smd(R.x0 + 1.9, R.y0 + 6.6, topo, 1.6, 0.8, M.resistor, true, '60C'));
    g.add(smd(R.x0 + 3.9, R.y0 + 6.6, topo, 1.6, 0.8, M.ceramica, true));
    g.add(smd(R.x0 + 3.9, R.y0 + 8.1, topo, 1.6, 0.8, M.ceramica));
    // diodo SS34 (SMA) com a faixa
    const diodo = new THREE.Group();
    const corpoD = new THREE.Mesh(new THREE.BoxGeometry(4.3, 2.1, 2.6), M.preto);
    corpoD.position.y = 1.05;
    diodo.add(corpoD);
    const faixa = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 2.6), M.branco);
    faixa.position.set(-1.6, 2.11, 0);
    diodo.add(faixa);
    for (const s of [-1, 1]) {
      const aba = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 1.6), M.estanho);
      aba.position.set(s * 2.6, 0.12, 0);
      diodo.add(aba);
    }
    diodo.position.copy(W(R.x0 + 6.8, R.y0 + 11, topo));
    g.add(diodo);
    g.add(smd(R.x0 + 5.2, R.y0 + 16.6, topo, 3.2, 1.6, M.ceramica, true));
    // bobina 4R7
    const bob = new THREE.Group();
    const corpoB = new THREE.Mesh(new THREE.BoxGeometry(9, 3.8, 9), M.bobina);
    corpoB.position.y = 1.9;
    bob.add(corpoB);
    const texB = textura(7.4, 7.4, (ctx) => {
      ctx.fillStyle = '#3a3a3c';
      ctx.fillRect(0, 0, 7.4, 7.4);
      texto(ctx, '4R7', 3.7, 3.7, 2.0, '#8f8f92', { peso: 700 });
    }, 50);
    const tampa = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 0.25, 40), [M.bobina, std(0xffffff, 0.8, 0, { map: texB }), M.bobina]);
    tampa.position.y = 3.9;
    bob.add(tampa);
    for (const s of [-1, 1]) {
      const clipe = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 0.25), M.estanho);
      clipe.position.set(0, 1.6, s * 4.55);
      bob.add(clipe);
    }
    bob.position.copy(W(R.x0 + 15, R.y0 + 14, topo));
    g.add(bob);
    poe(g, 'modulos', 'RT8272 (HW-108): conversor 12 V → 5 V, regulado em 5,0 V');
    barraMacho(R.pinos.filter((p) => p.n.startsWith('IN') || p.n === 'EN').map((p) => p.p), topo, 'modulos', 'Pinos do RT8272: EN (sem ligação), IN−, IN+');
    barraMacho(R.pinos.filter((p) => p.n.startsWith('OUT')).map((p) => p.p), topo, 'modulos', 'Pinos do RT8272: OUT− (sem ligação), OUT+');
  }

  // ------------------------------------------------------------ conector do cabo do BMP180 (barra de 4 pinos macho)
  if (X.bmp) {
    const g = new THREE.Group();
    const xs = X.bmp.map((p) => p.p[0]);
    const y = X.bmp[0].p[1];
    g.add(caixa(Math.max(...xs) - Math.min(...xs) + P, A.MALE_H, P, M.preto, (Math.min(...xs) + Math.max(...xs)) / 2, y, A.T));
    for (const p of X.bmp) {
      const pino = new THREE.Mesh(new THREE.BoxGeometry(0.64, A.MALE_H + 6.9, 0.64), M.ouro);
      pino.position.copy(W(p.p[0], p.p[1], -0.95 + (A.MALE_H + 6.9) / 2 + 0.0));
      g.add(pino);
    }
    poe(g, 'placa', 'Conector do cabo do BMP180: SDA, SCL, GND, VCC (5 V)');
  }

  // ------------------------------------------------------------ resistores de 1 kΩ (corpo em "osso", faixas marrom, preto, vermelho, ouro)
  {
    const texR = textura(4, 24, (ctx) => {
      ctx.fillStyle = '#d9b98b';
      ctx.fillRect(0, 0, 4, 24);
      [['#6d4c41', 6.2], ['#111111', 9.0], ['#c62828', 11.8], ['#c9a227', 17.4]].forEach(([c, v]) => {
        ctx.fillStyle = c;
        ctx.fillRect(0, v, 4, 1.7);
      });
    }, 20);
    const matR = std(0xffffff, 0.55, 0, { map: texR });
    const perfil = [[0.001, 0], [0.75, 0.05], [1.12, 0.6], [1.15, 1.3], [0.98, 2.0], [0.98, 4.2], [1.15, 4.9], [1.12, 5.6], [0.75, 6.15], [0.001, 6.2]]
      .map(([r, h]) => new THREE.Vector2(r, h));
    const geoR = new THREE.LatheGeometry(perfil, 28);
    for (const r of X.resistores) {
      const g = new THREE.Group();
      const [x1, y1] = r.a, [x2, y2] = r.b;
      const L = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const zc = A.T + 1.25;
      const a = W(mx - ux * 3.1, my - uy * 3.1, zc), b = W(mx + ux * 3.1, my + uy * 3.1, zc);
      const corpo = new THREE.Mesh(geoR, matR);
      corpo.position.copy(a);
      corpo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(corpo);
      for (const [hx, hy, s] of [[x1, y1, -1], [x2, y2, 1]]) {
        const fim = new THREE.Vector3(mx + ux * 3.0 * s, my + uy * 3.0 * s, zc);
        const pts = [W(hx, hy, -0.9), W(hx, hy, zc - 0.7), W(hx - ux * s * 0.15 + (fim.x - hx) * 0.25, hy + (fim.y - hy) * 0.25, zc), W(fim.x, fim.y, zc)];
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 24, 0.28, 8), M.estanho));
      }
      poe(g, 'placa', r.n);
    }
  }

  // ------------------------------------------------------------ suporte do fusível e fusível mini de 1 A
  {
    const F = X.fusivel;
    const g = new THREE.Group();
    const [cx, cy] = F.c;
    g.add(caixa(F.w, F.h, F.d, M.nylon, cx, cy, A.T));
    g.add(caixa(F.w - 2.2, 0.06, F.d - 2.2, M.furo, cx, cy, A.T + F.h));
    const texF = textura(10.9, 9, (ctx) => {
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, 0, 10.9, 9);
      texto(ctx, '1', 5.45, 4.3, 4.2, '#f5f5f5', { peso: 700 });
      texto(ctx, 'ATM', 5.45, 7.7, 1.0, '#9e9e9e', { peso: 600 });
    }, 40);
    const matF = std(0xffffff, 0.35, 0, { map: texF });
    const fus = new THREE.Mesh(new THREE.BoxGeometry(10.9, 9, 3.8), [M.preto, M.preto, M.preto, M.preto, matF, matF]);
    fus.position.copy(W(cx, cy, A.T + F.h - 2.5 + 4.5));
    g.add(fus);
    const pega = new THREE.Mesh(new THREE.BoxGeometry(10.9, 1.4, 2.4), M.preto);
    pega.position.copy(W(cx, cy, A.T + F.h - 2.5 + 9.7));
    g.add(pega);
    for (const [x, y] of F.pinos) g.add(cilindro(W(x, y, -1.0), W(x, y, A.T), 0.78, M.estanho, 12));
    poe(g, 'fusivel', 'Fusível mini lâmina de 1 A no suporte Keystone 3568 (medidas de catálogo)');
  }

  // ------------------------------------------------------------ fios isolados (cantos arredondados)
  function caminho(pts, raio) {
    const path = new THREE.CurvePath();
    const v = pts.map((p) => W(p[0], p[1], p[2]));
    let atual = v[0];
    for (let i = 1; i < v.length; i++) {
      const canto = v[i];
      if (i === v.length - 1) {
        if (atual.distanceTo(canto) > 1e-3) path.add(new THREE.LineCurve3(atual, canto));
        break;
      }
      const prox = v[i + 1];
      const dIn = canto.clone().sub(atual), dOut = prox.clone().sub(canto);
      const r = Math.min(raio, dIn.length() / 2, dOut.length() / 2);
      const a = canto.clone().addScaledVector(dIn.normalize(), -r);
      const b = canto.clone().addScaledVector(dOut.normalize(), r);
      if (atual.distanceTo(a) > 1e-3) path.add(new THREE.LineCurve3(atual, a));
      path.add(new THREE.QuadraticBezierCurve3(a, canto, b));
      atual = b;
    }
    return path;
  }
  for (const f of X.fios) {
    const g = new THREE.Group();
    const cor = new THREE.Color(f.cor);
    const mat = std(cor, 0.42);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(caminho(f.pts, 1.4), 160, f.r, 12), mat));
    for (const [x, y] of f.pontas) {
      g.add(cilindro(W(x, y, -0.9), W(x, y, A.T + 0.3), f.r * 0.55, M.estanho, 10));
    }
    poe(g, 'fios', f.n);
  }

  // ------------------------------------------------------------ lado de baixo: fio estanhado e solda
  const trilhas = [];
  for (const t of X.trilhas) {
    const pts = t.pts.map(([x, y]) => [x, y, A.BOT_Z]);
    const mat = M.estanho.clone();
    mat.userData.cor = new THREE.Color(t.cor);
    const m = new THREE.Mesh(new THREE.TubeGeometry(caminho(pts, 0.6), 120, 0.36, 8), mat);
    trilhas.push(mat);
    poe(m, 'trilhas', `Trilha (fio estanhado): ${t.n}`);
  }
  // fios isolados por baixo (I2C do BMP180), passando por cima das trilhas
  for (const f of X.fios_baixo || []) {
    const pts = f.pts.map(([x, y]) => [x, y, -1.05]);
    poe(new THREE.Mesh(new THREE.TubeGeometry(caminho(pts, 0.8), 120, 0.45, 10), std(new THREE.Color(f.cor), 0.42)), 'trilhas', f.n);
  }
  {
    const g = new THREE.Group();
    const inst = new THREE.InstancedMesh(geoSolda, M.estanho, X.solda.length + X.fusivel.pinos.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    X.solda.forEach(([x, y], i) => inst.setMatrixAt(i, m4.compose(W(x, y, 0), q, new THREE.Vector3(0.85, 0.8, 0.85))));
    X.fusivel.pinos.forEach(([x, y], i) => inst.setMatrixAt(X.solda.length + i, m4.compose(W(x, y, 0), q, new THREE.Vector3(1.2, 0.9, 1.2))));
    g.add(inst);
    poe(g, 'trilhas', 'Pontos de solda');
  }

  // ------------------------------------------------------------ câmera e controles
  const VISTAS = {
    perspectiva: { yaw: -0.6, pitch: 0.62, dist: 128 },
    cima: { yaw: 0, pitch: 1.5607, dist: 135 },
    baixo: { yaw: Math.PI, pitch: -1.5607, dist: 135 },
    lado: { yaw: 0, pitch: 0.08, dist: 105 },
  };
  const alvoPadrao = () => new THREE.Vector3(0, 5, 0);
  const cam = { yaw: 0, pitch: 0, dist: 150, alvo: alvoPadrao() };
  const meta = { ...cam, alvo: alvoPadrao() };
  function vista(nome) {
    Object.assign(meta, VISTAS[nome], { alvo: alvoPadrao() });
    if (nome === 'cima' || nome === 'baixo') cam.yaw = meta.yaw;
    pedir();
  }
  function posicionar() {
    const cp = Math.cos(cam.pitch);
    camera.position.set(
      cam.alvo.x + cam.dist * cp * Math.sin(cam.yaw),
      cam.alvo.y + cam.dist * Math.sin(cam.pitch),
      cam.alvo.z + cam.dist * cp * Math.cos(cam.yaw),
    );
    camera.lookAt(cam.alvo);
    chao.visible = camera.position.y > chao.position.y + 2;
  }

  let pendente = false;
  function pedir() {
    if (!pendente) {
      pendente = true;
      requestAnimationFrame(quadro);
    }
  }
  function corFundo() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--fundo-cena').trim();
    scene.background = new THREE.Color(v || '#e9eef2');
  }
  function quadro() {
    pendente = false;
    const k = 0.22;
    let mexeu = false;
    for (const c of ['yaw', 'pitch', 'dist']) {
      const d = meta[c] - cam[c];
      if (Math.abs(d) > 1e-4) {
        cam[c] += d * k;
        mexeu = true;
      } else cam[c] = meta[c];
    }
    if (cam.alvo.distanceTo(meta.alvo) > 1e-3) {
      cam.alvo.lerp(meta.alvo, k);
      mexeu = true;
    } else cam.alvo.copy(meta.alvo);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const pr = renderer.getPixelRatio();
    if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }
    posicionar();
    renderer.render(scene, camera);
    if (mexeu) pedir();
  }

  const ponteiros = new Map();
  let pinca = 0;
  let arrastou = false;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY, mover: e.button !== 0 || e.shiftKey });
    arrastou = false;
    if (ponteiros.size === 2) {
      const [a, b] = [...ponteiros.values()];
      pinca = Math.hypot(a.x - b.x, a.y - b.y);
    }
    if (dica) dica.hidden = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ponteiros.get(e.pointerId);
    if (!p) {
      apontar(e);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 1) arrastou = true;
    if (ponteiros.size === 2) {
      const [a, b] = [...ponteiros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinca > 0) meta.dist = Math.min(500, Math.max(25, meta.dist * (pinca / d)));
      pinca = d;
    } else if (p.mover) {
      const f = new THREE.Vector3().subVectors(cam.alvo, camera.position).normalize();
      const dir = new THREE.Vector3().crossVectors(f, camera.up).normalize();
      const cima = new THREE.Vector3().crossVectors(dir, f);
      const s = cam.dist * 0.0014;
      meta.alvo.addScaledVector(dir, -dx * s).addScaledVector(cima, dy * s);
    } else {
      meta.yaw -= dx * 0.008;
      meta.pitch = Math.min(1.5607, Math.max(-1.5607, meta.pitch + dy * 0.008));
    }
    pedir();
  });
  const soltar = (e) => {
    ponteiros.delete(e.pointerId);
    pinca = 0;
    if (!arrastou && e.type === 'pointerup') apontar(e, true);
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);
  canvas.addEventListener('pointerleave', () => {
    if (dica) dica.hidden = true;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    meta.dist = Math.min(500, Math.max(25, meta.dist * Math.exp(e.deltaY * 0.0012)));
    pedir();
  }, { passive: false });

  // nome da peça sob o mouse (ou no toque)
  const raio = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function apontar(e, toque = false) {
    if (!dica || (e.pointerType === 'touch' && !toque)) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raio.setFromCamera(ndc, camera);
    const visiveis = Object.values(camadas).filter((g) => g.visible);
    const hit = raio.intersectObjects(visiveis, true)[0];
    let o = hit && hit.object;
    while (o && !o.userData.nome) o = o.parent;
    if (!o) {
      dica.hidden = true;
      canvas.style.cursor = '';
      return;
    }
    dica.textContent = o.userData.nome;
    dica.style.left = '0px';   // mede a etiqueta inteira antes de posicionar perto da borda
    dica.hidden = false;
    const x = Math.min(e.clientX - r.left + 14, r.width - dica.offsetWidth - 6);
    dica.style.left = `${Math.max(6, x)}px`;
    dica.style.top = `${Math.max(6, e.clientY - r.top - 34)}px`;
  }

  // ------------------------------------------------------------ painel de controle
  for (const btn of document.querySelectorAll('[data-vista]')) btn.addEventListener('click', () => vista(btn.dataset.vista));
  const caixaCamadas = document.getElementById('camadas');
  for (const [key, label] of D.layers) {
    const wrap = document.createElement('div');
    wrap.className = 'form-check form-check-inline camada';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'form-check-input';
    input.id = `camada-${key}`;
    input.checked = true;
    input.addEventListener('change', () => {
      camadas[key].visible = input.checked;
      pedir();
    });
    const lab = document.createElement('label');
    lab.className = 'form-check-label';
    lab.htmlFor = input.id;
    lab.textContent = label;
    wrap.append(input, lab);
    caixaCamadas.append(wrap);
  }
  const cores = document.getElementById('cores-ligacoes');
  if (cores) {
    cores.addEventListener('change', () => {
      for (const mat of trilhas) {
        mat.color.copy(cores.checked ? mat.userData.cor : M.estanho.color);
        mat.metalness = cores.checked ? 0.3 : 1;
        mat.roughness = cores.checked ? 0.45 : 0.22;
      }
      pedir();
    });
  }
  new ResizeObserver(pedir).observe(canvas);
  new MutationObserver(() => {
    corFundo();
    pedir();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });

  corFundo();
  const inicial = location.hash.slice(1);
  Object.assign(cam, VISTAS[VISTAS[inicial] ? inicial : 'perspectiva']);
  vista(VISTAS[inicial] ? inicial : 'perspectiva');
}

/** Sala com painéis de luz, só para os reflexos dos metais (sem imagem externa). */
function ambiente() {
  const s = new THREE.Scene();
  const sala = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 12), new THREE.MeshBasicMaterial({ color: 0x9aa3ab, side: THREE.BackSide }));
  s.add(sala);
  for (const [x, y, z, w, h, i] of [[0, 3.9, 0, 6, 6, 5], [-5.9, 1, 0, 4, 3, 2.2], [5.9, 1.5, 2, 3, 2, 3], [0, 1, -5.9, 5, 2, 1.6], [0, -3.9, 0, 8, 8, 0.35]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  }
  return s;
}
