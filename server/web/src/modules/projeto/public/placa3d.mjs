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
  // abaixo de tudo, inclusive do sensor BMP180, que recebe o cabo por baixo
  chao.position.y = Math.min(-1.6, X.bmp_modulo?.z_min ?? -1.6, X.acessorios?.z0 ?? -1.6);
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
    ledEsp: std(0x3d6fd6, 0.3, 0, { emissive: 0x000000 }),   // LED azul da placa do ESP32 (pisca na animação)
    ledPwr: std(0xd32f2f, 0.3, 0, { emissive: 0x000000 }),   // LED vermelho de energia do ESP32 (aceso com a placa ligada)
  };
  const PCB = {
    esp: std(0x0f1846, 0.5),
    tja: std(0x0d469c, 0.45),
    rt: std(0x0b4396, 0.45),
    modulo: std(0x111214, 0.55),
  };

  // LEDs do ELM327 (preenchidos ao montar o adaptador): piscam como consultas OBD quando o estado é Capturando
  let elmLeds = [];

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
  /** Pinos macho saindo de um módulo para baixo, com o plástico separador e a solda por cima. Com A.ENCAIXE, o módulo
   *  fica encaixado numa barra fêmea (como o ESP32): o corpo dela na placa, o plástico dos pinos por cima. */
  function barraMacho(pinos, zTopo, camada, nome, comPlastico = true) {
    const g = new THREE.Group();
    const xs = pinos.map((p) => p[0]), ys = pinos.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const lx = Math.max(...xs) - Math.min(...xs) + P, ly = Math.max(...ys) - Math.min(...ys) + P;
    const deitada = lx > ly;
    if (A.ENCAIXE) {
      const fw = A.FEM_W ?? P;
      g.add(caixa(deitada ? lx : fw, A.FEM_H, deitada ? fw : ly, M.nylon, cx, cy, A.T));
      for (const [x, y] of pinos) {
        const furo = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 1.0), M.furo);
        furo.position.copy(W(x, y, A.T + A.FEM_H + 0.01));
        g.add(furo);
        g.add(cilindro(W(x, y, -(A.FEM_PINO ?? 0.95)), W(x, y, A.T), 0.25, M.estanho, 4));
      }
    }
    if (comPlastico) g.add(caixa(lx, A.MALE_H, ly, M.preto, cx, cy, A.ENCAIXE ? A.T + A.FEM_H : A.T));
    for (const [x, y] of pinos) {
      g.add(cilindro(W(x, y, A.ENCAIXE ? A.T + A.FEM_H - 1 : -0.95), W(x, y, zTopo + 0.7), 0.32, M.ouro, 4));
      g.add(solda(x, y, zTopo, 0.75, 0.55, false));
    }
    return poe(g, camada, A.ENCAIXE ? `${nome}, encaixada numa barra fêmea` : nome);
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
    g.add(caixa(x2 - x1 + P, A.FEM_H, A.FEM_W ?? P, M.nylon, (x1 + x2) / 2, y, A.T));
    for (const pin of fila) {
      const furo = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 1.0), M.furo);
      furo.position.copy(W(pin.p[0], pin.p[1], A.T + A.FEM_H + 0.01));
      g.add(furo);
      // pino da barra: 3,2 mm por baixo da placa (desenho do fabricante)
      g.add(cilindro(W(pin.p[0], pin.p[1], -(A.FEM_PINO ?? 0.95)), W(pin.p[0], pin.p[1], A.T), 0.25, M.estanho, 4));
    }
    poe(g, 'placa', 'Barra de pinos fêmea do ESP32 (15 pinos)');
  }
  {
    const g = new THREE.Group();
    const topo = A.ESP_Z + (A.ESP_T ?? 1.6);
    const usados = new Set(E.pinos.filter((p) => p.usado).map((p) => p.n + p.p[1]));
    const tex = textura(E.l, E.w, (ctx) => {
      ctx.fillStyle = '#121c52';
      ctx.fillRect(0, 0, E.l, E.w);
      // trilhas decorativas
      for (let k = 0; k < 5; k++) trilhaTex(ctx, [[34 + k * 1.1, 11.2], [34 + k * 1.1, 12.6], [27.7 + k * 1.2, 13.6]], 'rgba(90,120,220,0.35)', 0.22);
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
      // posições do layout de cima (a partir da ponta do USB, em E.l): nome entre os LEDs e os transistores
      texto(ctx, 'ESP32 DEVKIT V1', E.l - 20.8, E.w / 2, 0.85, '#ffffff', { peso: 700, rot: -Math.PI / 2 });
      texto(ctx, 'BOOT', E.l - 7.0, E.w / 2 - 7.4, 0.75, '#ffffff', { rot: -Math.PI / 2 });
      texto(ctx, 'EN', E.l - 7.0, E.w / 2 + 7.4, 0.75, '#ffffff', { rot: -Math.PI / 2 });
      contorno(ctx, E.l - 15.4, E.w / 2 - 9.0, 6.0, 6.0, 'rgba(255,255,255,0.7)');   // CP2102
    });
    g.add(placaModulo(E.x0, E.y0, E.l, E.w, A.ESP_Z, A.ESP_T ?? 1.6, PCB.esp, tex));
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
    const hBlind = (A.ESP_WIFI ?? 3.2) - 0.8;   // blindagem do WROOM-32 sobre a plaquinha dele
    const blind = new THREE.Mesh(new THREE.BoxGeometry(18, hBlind, 16), [M.niquel, M.niquel, std(0xffffff, 0.38, 0.85, { map: texBlind }), M.niquel, M.niquel, M.niquel]);
    blind.position.copy(W(mx0 + 6.5 + 9, cy, topo + 0.8 + hBlind / 2));
    g.add(blind);
    // micro-USB, botões, CP2102, regulador, transistores, diodo e LEDs. Posições pela ilustração da placa (11/11/2026)
    // e tamanhos pelo modelo STEP do DevKit V1, medidas a partir da ponta do USB. Lado do 3V3 = cy − ; lado do VIN = cy +.
    const fimUsb = E.x0 + E.l;
    g.add(caixa(5.6, 3.0, 7.9, M.niquel, fimUsb - 2.1, cy, topo));            // micro-USB, passa 0,7 mm da borda
    g.add(caixa(0.1, 1.5, 6.4, M.furo, fimUsb + 0.72, cy, topo + 0.7));
    for (const by of [cy - 7.4, cy + 7.4]) {                                    // BOOT (3V3) e EN (VIN), ao lado do USB
      g.add(caixa(3.7, 0.9, 2.9, M.niquel, fimUsb - 4.2, by, topo));
      const botao = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.6, 20), M.preto);
      botao.position.copy(W(fimUsb - 4.2, by, topo + 1.2));
      g.add(botao);
    }
    for (const by of [cy - 2.6, cy - 0.9, cy + 0.9, cy + 2.6]) g.add(smd(fimUsb - 7.8, by, topo, 1.6, 0.8, M.ceramica, true));
    g.add(caixa(5.0, 0.9, 5.0, M.preto, fimUsb - 12.4, cy - 6.0, topo));       // CP2102 (QFN 5 × 5), lado do 3V3
    g.add(sot223(fimUsb - 13.0, cy + 4.5, topo, 'AMS1117'));                    // regulador, lado do VIN
    for (const by of [cy - 5.8, cy + 0.5]) g.add(caixa(2.9, 1.0, 1.6, M.preto, fimUsb - 18.5, by, topo));   // SOT-23
    g.add(caixa(2.6, 2.0, 4.3, M.preto, fimUsb - 18.5, cy + 6.7, topo));        // diodo SMA
    g.add(caixa(2.6, 0.05, 0.7, M.estanho, fimUsb - 18.5, cy + 8.4, topo + 2.0));
    for (let k = 0; k < 5; k++) g.add(smd(fimUsb - 22.3, cy - 2.4 + k * 1.2, topo, 1.6, 0.8, M.resistor));
    // LEDs conferidos na placa do Alan (11/11/2026): azul do lado do 3V3, vermelho do lado do VIN
    g.add(smd(fimUsb - 22.3, cy - 4.3, topo, 1.6, 0.8, M.ledEsp));             // LED azul (D2): o que o firmware pisca
    g.add(smd(fimUsb - 22.3, cy + 4.7, topo, 1.6, 0.8, M.ledPwr));             // LED vermelho: energia
    poe(g, 'esp32', 'ESP32 DevKit V1 (30 pinos), encaixado nas barras fêmea');
  }

  // ------------------------------------------------------------ TJA1050 (versão principal)
  if (X.tja) {
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
    // CANH e CANL: fios curtos soldados por cima do módulo até um conector Dupont de 2 vias na barra macho da linha 24
    if (T.can.length && T.can[0].fio) {
      const con = new THREE.Group();
      const hx = T.can.map((p) => p.furo[0]), hy = T.can[0].furo[1];
      const cx = (Math.min(...hx) + Math.max(...hx)) / 2, lx = Math.max(...hx) - Math.min(...hx) + P;
      con.add(caixa(lx, A.MALE_H, P, M.preto, cx, hy, A.T));
      con.add(caixa(lx, A.HOUSING_H, P, M.nylon, cx, hy, A.T + A.MALE_H));
      for (const p of T.can) con.add(cilindro(W(p.furo[0], hy, -0.95), W(p.furo[0], hy, A.T + 1), 0.32, M.ouro, 4));
      poe(con, 'modulos', `Conector dos fios do CANH e do CANL: barra macho de 2 pinos em (${T.can.map((p) => p.furo_cr.join(',')).join(') e (')})`);
      for (const p of T.can) {
        const fio = new THREE.Group();
        const curva = new THREE.CatmullRomCurve3(p.fio.map((q) => W(q[0], q[1], q[2])), false, 'centripetal');
        fio.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 48, 0.5, 10), std(0x1565c0, 0.5)));
        fio.add(solda(p.p[0], p.p[1], topo, 0.75, 0.5, false));
        poe(fio, 'modulos', `Fio do ${p.n}: do pino do TJA1050 ao conector de 2 vias (${p.furo_cr.join(',')})`);
      }
    }
    barraMacho(T.pinos.map((p) => p.p), topo, 'modulos', 'Barra de 4 pinos do TJA1050: VCC, TX, RX, GND');
  }

  // ------------------------------------------------------------ SN65HVD230 (versão alternativa, módulo WCMCU-230)
  if (X.sn65) {
    const S = X.sn65;
    const g = new THREE.Group();
    const z = A.MOD_Z, topo = A.MOD_Z + A.MOD_T;
    const tex = textura(S.l, S.w, (ctx) => {
      ctx.fillStyle = '#0f4fae';
      ctx.fillRect(0, 0, S.l, S.w);
      // trilhas do módulo: dos pinos ao chip
      S.pinos.forEach((p, k) => {
        const px = p.p[0] - S.x0, py = p.p[1] - S.y0;
        trilhaTex(ctx, [[px, py - 0.9], [px, 8.4], [5.6 + Math.min(k, 3) * 1.27, 6.6]], 'rgba(120,180,255,0.45)', 0.26);
        ilha(ctx, px, py, 0.85, k === 0);
        texto(ctx, p.n, px, py - 2.6, 0.72, '#ffffff', { rot: -Math.PI / 2 });
      });
      for (const hx of [2.6, S.l - 2.6]) {
        ctx.fillStyle = '#e3c06a';
        ctx.beginPath();
        ctx.arc(hx, 2.6, 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0c1a2e';
        ctx.beginPath();
        ctx.arc(hx, 2.6, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      texto(ctx, 'R1', 3.3, 5.6, 0.6, '#ffffff');
      texto(ctx, 'R2', 13.0, 5.6, 0.6, '#ffffff');
      contorno(ctx, 5.3, 0.8, 5.2, 6.0, 'rgba(255,255,255,0.8)', 0.12);
    });
    g.add(placaModulo(S.x0, S.y0, S.l, S.w, z, A.MOD_T, PCB.tja, tex));
    g.add(sop8(S.x0 + 7.9, S.y0 + 3.8, topo, ['VP230', '83M'], true));
    g.add(smd(S.x0 + 2.5, S.y0 + 7.25, topo, 2.0, 1.25, M.resistor, false, '103'));
    // R2 ("121", terminação de 120 Ω entre CANH e CANL) retirado: ficam as duas ilhas com estanho
    for (const dx of [-0.75, 0.75]) g.add(caixa(0.55, 0.06, 1.0, M.estanho, S.x0 + 13.0 + dx, S.y0 + 7.25, topo));
    poe(g, 'modulos', 'SN65HVD230 (WCMCU-230): transceptor CAN em 3,3 V, só escuta (CTX preso no 3V3). Sem o R2 "121": medido 120 Ω entre CANH e CANL, ele sai');
    barraMacho(S.pinos.map((p) => p.p), topo, 'modulos', 'Barra de 6 pinos do SN65HVD230: 3V3, GND, CTX, CRX, CANH, CANL');
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

  // ------------------------------------------------------------ sensor BMP180 (GY-68) na ponta do cabo
  if (X.bmp_modulo && X.bmp) {
    const B = X.bmp_modulo;
    const g = new THREE.Group();
    // conector fêmea do cabo, encaixado nos pinos da placa
    const xs = X.bmp.map((p) => p.p[0]);
    const y = X.bmp[0].p[1];
    g.add(caixa(Math.max(...xs) - Math.min(...xs) + P, B.housing, P, M.nylon, (Math.min(...xs) + Math.max(...xs)) / 2, y, A.T + A.MALE_H));
    // placa do módulo, com a serigrafia desenhada
    const tex = textura(B.l, B.w, (ctx) => {
      ctx.fillStyle = '#1565c9';
      ctx.fillRect(0, 0, B.l, B.w);
      B.pinos.forEach((p, k) => {
        const px = p.p[0] - B.x0, py = p.p[1] - B.y0;
        ilha(ctx, px, py, 0.8, k === 0);
        texto(ctx, p.n, px + 4.1, py, 0.75, '#ffffff', { alinha: 'left' });
      });
      contorno(ctx, 0.25, B.w / 2 - 6.6, 2.4, 13.2, 'rgba(255,255,255,0.85)', 0.12);
      for (const hy of [2.6, B.w - 2.6]) {
        ctx.fillStyle = '#e3c06a';
        ctx.beginPath();
        ctx.arc(B.l - 2.6, hy, 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0c1a2e';
        ctx.beginPath();
        ctx.arc(B.l - 2.6, hy, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      texto(ctx, 'GY-68', 10.2, 1.0, 0.7, '#ffffff');
      texto(ctx, 'U3', 3.6, B.w - 0.7, 0.6, '#ffffff');
    });
    g.add(placaModulo(B.x0, B.y0, B.l, B.w, B.z0, 1.6, PCB.tja, tex));
    const topo = B.z0 + 1.6;
    // BMP180: cápsula metálica com o furo de ventilação
    const texS = textura(3.8, 3.6, (ctx) => {
      ctx.fillStyle = '#c9ced2';
      ctx.fillRect(0, 0, 3.8, 3.6);
      texto(ctx, 'U3V', 1.9, 1.0, 0.55, '#6d7378', { peso: 500 });
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      ctx.arc(1.0, 2.6, 0.28, 0, Math.PI * 2);
      ctx.fill();
    }, 80);
    const sensor = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.95, 3.6), [M.niquel, M.niquel, std(0xffffff, 0.35, 0.8, { map: texS }), M.niquel, M.niquel, M.niquel]);
    sensor.position.copy(W(B.x0 + 9.9, B.y0 + 6.4, topo + 0.475));
    g.add(sensor);
    g.add(caixa(2.9, 1.1, 1.6, M.preto, B.x0 + 6.6, B.y0 + 2.8, topo));
    g.add(smd(B.x0 + 6.4, B.y0 + 8.4, topo, 1.6, 0.8, M.resistor, false, '472'));
    g.add(smd(B.x0 + 6.4, B.y0 + 10.0, topo, 1.6, 0.8, M.resistor, false, '472'));
    g.add(smd(B.x0 + 6.4, B.y0 + 5.4, topo, 1.6, 0.8, M.ceramica));
    // barra de 5 pinos do módulo e o conector fêmea do cabo
    const ys = B.pinos.map((p) => p.p[1]);
    const px = B.pinos[0].p[0];
    // pinos para baixo: o cabo chega por baixo do sensor
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2, ly = Math.max(...ys) - Math.min(...ys) + P;
    g.add(caixa(P, A.MALE_H, ly, M.preto, px, cy, B.z0 - A.MALE_H));
    g.add(caixa(P, B.housing, ly, M.nylon, px, cy, B.z0 - A.MALE_H - B.housing));
    for (const p of B.pinos) {
      g.add(cilindro(W(p.p[0], p.p[1], B.z0 - A.MALE_H - B.housing + 2), W(p.p[0], p.p[1], topo + 0.6), 0.32, M.ouro, 4));
      g.add(solda(p.p[0], p.p[1], topo, 0.7, 0.5, false));
    }
    poe(g, 'bmp180', 'Sensor BMP180 (GY-68): pressão e temperatura, na ponta do cabo, longe do calor da placa');
    // cabo de 4 fios
    for (const f of B.cabo) {
      const curva = new THREE.CatmullRomCurve3(f.pts.map(([x, y, z]) => W(x, y, z)), false, 'centripetal');
      poe(new THREE.Mesh(new THREE.TubeGeometry(curva, 80, 0.55, 10), std(new THREE.Color(f.cor), 0.42)), 'bmp180', `Cabo do BMP180: ${f.n}`);
    }
  }

  // ------------------------------------------------------------ LSM6DS3 (acelerômetro e giroscópio) na ponta de outro cabo
  if (X.lsm && X.lsm_modulo) {
    const L = X.lsm_modulo;
    // conector na placa (linha 16), igual ao do BMP180
    {
      const g = new THREE.Group();
      const xs = X.lsm.map((p) => p.p[0]);
      const y = X.lsm[0].p[1];
      g.add(caixa(Math.max(...xs) - Math.min(...xs) + P, A.MALE_H, P, M.preto, (Math.min(...xs) + Math.max(...xs)) / 2, y, A.T));
      for (const p of X.lsm) {
        const pino = new THREE.Mesh(new THREE.BoxGeometry(0.64, A.MALE_H + 6.9, 0.64), M.ouro);
        pino.position.copy(W(p.p[0], p.p[1], -0.95 + (A.MALE_H + 6.9) / 2));
        g.add(pino);
      }
      poe(g, 'placa', 'Conector do cabo do LSM6DS3: SDA, SCL, GND, VCC (5 V), ligado ao do BMP180');
    }
    const g = new THREE.Group();
    const xs = X.lsm.map((p) => p.p[0]);
    g.add(caixa(Math.max(...xs) - Math.min(...xs) + P, L.housing, P, M.nylon, (Math.min(...xs) + Math.max(...xs)) / 2, X.lsm[0].p[1], A.T + A.MALE_H));
    // placa roxa do módulo, com a serigrafia desenhada (nomes dos pinos e os eixos X, Y e Z)
    const tex = textura(L.l, L.w, (ctx) => {
      ctx.fillStyle = '#6a1b9a';
      ctx.fillRect(0, 0, L.l, L.w);
      const pinos = (lista, lado) => lista.forEach((p, k) => {
        const px = p.p[0] - L.x0, py = p.p[1] - L.y0;
        ilha(ctx, px, py, 0.8, k === 0 && lado > 0);
        texto(ctx, p.n, px + lado * 1.5, py, 0.7, '#ffffff', { alinha: lado > 0 ? 'left' : 'right' });
      });
      pinos(L.pinos7, 1);
      pinos(L.pinos5, -1);
      for (const hy of [2.3, L.w - 2.3]) {
        ctx.fillStyle = '#e3c06a';
        ctx.beginPath();
        ctx.arc(L.l / 2, hy, 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0c1a2e';
        ctx.beginPath();
        ctx.arc(L.l / 2, hy, 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
      // eixos impressos: X para a direita, Y para cima (na placa), Z saindo dela
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.18;
      ctx.beginPath();
      ctx.moveTo(8.4, 17.1); ctx.lineTo(10.2, 17.1);
      ctx.moveTo(8.4, 17.1); ctx.lineTo(8.4, 15.6);
      ctx.stroke();
      texto(ctx, 'X', 10.7, 17.1, 0.55, '#ffffff');
      texto(ctx, 'Y', 8.4, 15.15, 0.55, '#ffffff');
      texto(ctx, 'Z', 7.8, 17.55, 0.5, '#ffffff');
    });
    g.add(placaModulo(L.x0, L.y0, L.l, L.w, L.z0, 1.6, std(0x5b1787, 0.5), tex));
    const topo = L.z0 + 1.6;
    // LSM6DS3: encapsulamento LGA pequeno; regulador ao lado e os resistores e capacitores SMD
    const chip = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.86, 3.0), std(0x1f1f21, 0.5));
    chip.position.copy(W(L.x0 + 6.65, L.y0 + 9.2, topo + 0.43));
    g.add(chip);
    g.add(caixa(3.0, 1.1, 1.7, M.preto, L.x0 + 10.3, L.y0 + 13.85, topo));
    g.add(smd(L.x0 + 9.4, L.y0 + 4.4, topo, 1.6, 0.8, M.resistor, true, '392'));
    g.add(smd(L.x0 + 10.6, L.y0 + 4.4, topo, 1.6, 0.8, M.resistor, true, '392'));
    g.add(smd(L.x0 + 9.0, L.y0 + 7.6, topo, 1.6, 0.8, M.ceramica));
    g.add(smd(L.x0 + 9.0, L.y0 + 9.4, topo, 1.6, 0.8, M.ceramica));
    // barra de 7 pinos para baixo (a de 5 fica sem barra) e o conector fêmea do cabo, por baixo
    const ys = L.pinos7.map((p) => p.p[1]);
    const px = L.pinos7[0].p[0];
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2, ly = Math.max(...ys) - Math.min(...ys) + P;
    g.add(caixa(P, A.MALE_H, ly, M.preto, px, cy, L.z0 - A.MALE_H));
    g.add(caixa(P, L.housing, ly, M.nylon, px, cy, L.z0 - A.MALE_H - L.housing));
    for (const p of L.pinos7) {
      g.add(cilindro(W(p.p[0], p.p[1], L.z0 - A.MALE_H - L.housing + 2), W(p.p[0], p.p[1], topo + 0.6), 0.32, M.ouro, 4));
      g.add(solda(p.p[0], p.p[1], topo, 0.7, 0.5, false));
    }
    poe(g, 'lsm6ds3', 'LSM6DS3 (acelerômetro e giroscópio, 6 eixos) na ponta do cabo: prenda firme no carro, alinhado com ele');
    for (const j of L.jumpers) {
      const curva = new THREE.CatmullRomCurve3(j.pts.map(([x, y, z]) => W(x, y, z)), false, 'centripetal');
      poe(new THREE.Mesh(new THREE.TubeGeometry(curva, 40, 0.24, 8), std(0x9e9e9e, 0.45)), 'lsm6ds3', j.n);
    }
    for (const f of L.cabo) {
      const curva = new THREE.CatmullRomCurve3(f.pts.map(([x, y, z]) => W(x, y, z)), false, 'centripetal');
      poe(new THREE.Mesh(new THREE.TubeGeometry(curva, 100, 0.55, 10), std(new THREE.Color(f.cor), 0.42)), 'lsm6ds3', `Cabo do LSM6DS3: ${f.n}`);
    }
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

  // ------------------------------------------------------------ suporte AS-06 com tampa e o fusível de vidro de 1,5 A
  // corpo aberto em cima (piso e duas torres com as presilhas), vazado nas laterais do meio; tampa com duas abas
  {
    const F = X.fusivel;
    const g = new THREE.Group();
    const [cx, cy] = F.c;
    const base = A.T + F.pes;
    const topo = A.T + F.h - F.tampa;
    for (const s of [-1, 1]) g.add(caixa(3, F.pes, F.d, M.preto, cx + s * (F.corpo / 2 - 1.5), cy, A.T));
    g.add(caixa(F.corpo, F.piso, F.d, M.preto, cx, cy, base));
    for (const s of [-1, 1]) {
      const tx = cx + s * (F.corpo / 2 - F.torre / 2);
      g.add(caixa(F.torre, topo - base - F.piso, F.d, M.preto, tx, cy, base + F.piso));
      // presilha de latão aparecendo na boca da torre
      g.add(caixa(0.3, 4.2, 4.0, M.ouro, cx + s * (F.corpo / 2 - F.torre - 0.1), cy, F.vidro.z - 2.1));
    }
    const texT = textura(F.w, F.d, (ctx) => {
      ctx.fillStyle = '#161616';
      ctx.fillRect(0, 0, F.w, F.d);
      contorno(ctx, 1.2, 1.2, F.w - 2.4, F.d - 2.4, 'rgba(255,255,255,0.10)', 0.15);
      texto(ctx, 'AS-06', F.w / 2, F.d / 2 - 1.2, 1.5, '#8a8a8a', { peso: 600 });
      texto(ctx, '1,5 A · 5 × 20', F.w / 2, F.d / 2 + 1.4, 1.2, '#9e9e9e', { peso: 500 });
    }, 40);
    const matT = std(0xffffff, 0.45, 0, { map: texT });
    const tampa = new THREE.Mesh(new THREE.BoxGeometry(F.w, F.tampa, F.d), [M.preto, M.preto, matT, M.preto, M.preto, M.preto]);
    tampa.position.copy(W(cx, cy, topo + F.tampa / 2));
    g.add(tampa);
    const fundoAba = F.vidro.z + F.vidro.d / 2 + 0.3;
    // abas de encaixe da tampa, uma de cada lado do fusível
    for (const a of F.abas) g.add(caixa(4.0, topo - fundoAba, 1.3, M.preto, cx + a.x, cy + a.lado * 2.6, fundoAba));
    // fusível de vidro 5 x 20 mm: tubo transparente, filamento e terminais metálicos
    const r = F.vidro.d / 2, meio = F.vidro.l - 2 * F.vidro.tampa;
    const vidro = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, meio, 28),
      new THREE.MeshPhysicalMaterial({ color: 0xe8f4f8, roughness: 0.05, transmission: 0.9, transparent: true, opacity: 0.45, ior: 1.5, thickness: 0.6 }));
    vidro.rotation.z = Math.PI / 2;
    vidro.position.copy(W(cx, cy, F.vidro.z));
    g.add(vidro);
    // filamento fino, atravessando o vidro na diagonal
    g.add(cilindro(W(cx - meio / 2, cy - r * 0.3, F.vidro.z - r * 0.65), W(cx + meio / 2, cy + r * 0.3, F.vidro.z + r * 0.65), 0.07, std(0xb0a090, 0.4, 0.8), 6));
    for (const s of [-1, 1]) {
      const a = W(cx + s * (meio / 2), cy, F.vidro.z), b = W(cx + s * (F.vidro.l / 2), cy, F.vidro.z);
      g.add(cilindro(a, b, r * 1.02, M.niquel, 28));
    }
    for (const [x, y] of F.pinos) g.add(caixa(1.3, A.T + F.pes + 1.5, 0.4, M.estanho, x, y, -1.5));
    poe(g, 'fusivel', 'Porta-fusível AS-06 (5 × 20 mm, com tampa) e fusível de vidro de 1,5 A');
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

  // ------------------------------------------------------------ cabo OBD2 macho com fios soltos (pigtail) e o plugue
  // Boca do conector OBD2: trapézio de cantos arredondados. furo = true: contorno no sentido contrário, como o
  // Three.js espera nos furos (senão as paredes de dentro somem).
  function trap(topo, base, alt, r, furo = false) {
    const s0 = furo ? new THREE.Path() : new THREE.Shape();
    const pts = [[-topo / 2, alt / 2], [topo / 2, alt / 2], [base / 2, -alt / 2], [-base / 2, -alt / 2]];
    if (furo) pts.reverse();
    pts.forEach(([x, y], i) => {
      const [px, py] = pts[(i + 3) % 4], [nx, ny] = pts[(i + 1) % 4];
      const din = Math.hypot(x - px, y - py), dout = Math.hypot(nx - x, ny - y);
      const a = [x + (px - x) * r / din, y + (py - y) * r / din], b = [x + (nx - x) * r / dout, y + (ny - y) * r / dout];
      if (i === 0) s0.moveTo(...a); else s0.lineTo(...a);
      s0.quadraticCurveTo(x, y, ...b);
    });
    s0.closePath();
    return s0;
  }

  if (X.cabo_obd) {
    const C = X.cabo_obd;
    const [bx, by, bz] = C.boca;
    const borracha = std(0x1c1c1c, 0.7);
    for (const f of C.fios) {
      let mat;
      if (f.listra) {   // fio verde com listra branca (pino 14)
        const cv = document.createElement('canvas');
        cv.width = 4; cv.height = 32;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = f.cor; ctx.fillRect(0, 0, 4, 32);
        ctx.fillStyle = f.listra; ctx.fillRect(0, 2, 4, 7);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        mat = std(0xffffff, 0.42, 0, { map: t });
      } else mat = std(new THREE.Color(f.cor), 0.42);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.TubeGeometry(caminho(f.pts, 2.5), 160, 0.7, 12), mat));
      const [x, y] = f.ponta;
      g.add(cilindro(W(x, y, -0.9), W(x, y, A.T + 0.3), 0.38, M.estanho, 10));
      poe(g, 'fios', f.n);
    }
    {
      const g = new THREE.Group();
      const [a, b] = C.pino6.pts.map(([x, y, z]) => W(x, y, z));
      g.add(cilindro(a, b, 0.7, std(new THREE.Color(C.pino6.cor), 0.42), 12));
      const d = b.clone().sub(a);
      g.add(cilindro(a.clone().addScaledVector(d, 0.55), b.clone().addScaledVector(d, 0.15), 1.0, borracha, 14));
      poe(g, 'fios', C.pino6.n);
    }
    // capa do cabo, termorretrátil na boca e os fios cortados rente
    {
      const g = new THREE.Group();
      g.add(cilindro(W(bx - 1.0, by, bz), W(bx + 2.5, by, bz), C.capa_r + 0.35, borracha, 28));
      g.add(cilindro(W(bx, by, bz), W(C.capa_fim, by, bz), C.capa_r, std(0x202020, 0.55), 28));
      poe(g, 'fios', 'Capa do cabo OBD (os outros 11 fios cortados rente e isolados)');
    }
    // plugue OBD2 macho: alívio de tensão com nervuras, corpo e a boca trapezoidal com os 16 contatos
    {
      const P0 = C.plugue;
      const g = new THREE.Group();
      const plast = std(0x2a2a2a, 0.62);
      g.add(cilindro(W(C.capa_fim, by, bz), W(P0.x0, by, bz), 4.6, plast, 28));
      for (let k = 0; k < 4; k++) {
        const anel = new THREE.Mesh(new THREE.TorusGeometry(4.75, 0.45, 8, 28), plast);
        anel.rotation.y = Math.PI / 2;
        anel.position.copy(W(C.capa_fim + 1.5 + k * 1.8, by, bz));
        g.add(anel);
      }
      // "OBD II" em relevo no topo, lido de quem olha a placa de frente
      const texO = textura(P0.w, P0.l, (ctx) => {
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, P0.w, P0.l);
        contorno(ctx, 6, P0.l / 2 - 3.2, P0.w - 12, 6.4, 'rgba(255,255,255,0.18)', 0.3);
        texto(ctx, 'OBD II', P0.w / 2, P0.l / 2, 3.4, '#7a7a7a', { peso: 700 });
      }, 30);
      texO.center.set(0.5, 0.5);
      texO.rotation = Math.PI / 2;
      const corpo = new THREE.Mesh(new THREE.BoxGeometry(P0.l, P0.h, P0.w), [plast, plast, std(0xffffff, 0.62, 0, { map: texO }), plast, plast, plast]);
      corpo.position.copy(W(P0.x0 + P0.l / 2, by, bz));
      g.add(corpo);
      // boca (moldura trapezoidal com cantos arredondados), aberta para longe da placa
      const fora = trap(38, 31, 14, 2.2);
      fora.holes.push(trap(35, 28.4, 11.4, 1.6, true));
      // a moldura e o fundo são desenhados no plano e girados para a boca olhar para +x (para longe da placa)
      const boca = new THREE.Group();
      boca.rotation.y = Math.PI / 2;
      boca.position.copy(W(P0.x0 + P0.l, by, bz));
      const plastDuplo = plast.clone();
      plastDuplo.side = THREE.DoubleSide;
      boca.add(new THREE.Mesh(new THREE.ExtrudeGeometry(fora, { depth: 7, bevelEnabled: false }), plastDuplo));
      // fundo da boca com os 16 contatos (2 fileiras de 8) e a chave no meio da fileira de baixo
      const fundo = new THREE.Mesh(new THREE.ShapeGeometry(trap(35, 28.4, 11.4, 1.6)), std(0x151515, 0.8));
      fundo.position.z = 0.05;
      boca.add(fundo);
      for (const fz of [2.6, -2.6]) {
        for (let k = 0; k < 8; k++) {
          const contato = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 5.5), M.ouro);
          contato.position.set((k - 3.5) * 3.2 + (k >= 4 ? 1.4 : -1.4), fz, 2.75);
          boca.add(contato);
        }
      }
      const chave = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.0, 6.5), plast);
      chave.position.set(0, -4.2, 3.25);
      boca.add(chave);
      g.add(boca);
      poe(g, 'fios', 'Plugue OBD2 macho (16 pinos) do cabo com fios soltos: encaixa numa das fêmeas do cabo Y');
    }
  }

  // ------------------------------------------------------------ ELM327 e cabo Y: soltos atrás da placa, só para mostrar o kit
  if (X.acessorios) {
    const K = X.acessorios;
    const z0 = K.z0;
    const preto = std(0x2a2a2a, 0.62);
    const pretoDuplo = preto.clone();
    pretoDuplo.side = THREE.DoubleSide;
    // boca de pé (olhando para cima): o trapézio vem no plano xy e gira para o plano da placa
    const bocaDePe = (x, y, z, fora, dentro, alt, mat, fundoMat) => {
      const g = new THREE.Group();
      const sh = fora;
      if (dentro) sh.holes.push(dentro);
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: alt, bevelEnabled: false }), mat);
      g.add(m);
      if (fundoMat) {
        const f = new THREE.Mesh(new THREE.ShapeGeometry(trap(35, 28.4, 11.4, 1.6)), fundoMat);
        f.position.z = 0.05;
        g.add(f);
      }
      g.rotation.x = -Math.PI / 2;
      g.position.copy(W(x, y, z));
      return g;
    };
    const contatos = (g, x, y, z, alt) => {
      for (const fy of [-2.6, 2.6]) {
        for (let k = 0; k < 8; k++) {
          const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, alt, 0.5), M.ouro);
          c.position.copy(W(x + (k - 3.5) * 3.2 + (k >= 4 ? 1.4 : -1.4), y + fy, z + alt / 2));
          g.add(c);
        }
      }
    };

    // ELM327 mini: caixa azul translúcida e, por dentro, as duas placas como nas fotos de montagem (conector para cima):
    // embaixo a placa do Bluetooth (módulo e LEDs na face de baixo, aparecendo pelo fundo), J1/J2 ligando à placa
    // principal com o PIC18F25K80 e o cristal virados para baixo, e os 16 pinos subindo até o conector.
    {
      const E = K.elm;
      const [x, y] = E.c;
      const g = new THREE.Group();
      const vidroAzul = std(0x1f4fd8, 0.25, 0, { transparent: true, opacity: 0.5, depthWrite: false });
      const tex = textura(E.w, E.h, (ctx) => {
        ctx.fillStyle = '#1f4fd8';
        ctx.fillRect(0, 0, E.w, E.h);
        ctx.fillStyle = '#1a237e';
        ctx.fillRect(3, 3.5, E.w - 6, E.h - 7);
        ctx.strokeStyle = '#e3f2fd';
        ctx.lineWidth = 0.35;
        ctx.strokeRect(3.6, 4.1, E.w - 7.2, E.h - 8.2);
        texto(ctx, 'ELM 327', E.w / 2 + 1, E.h / 2 - 2.6, 4.4, '#ff7043', { peso: 800 });
        ctx.fillStyle = '#f5f5f5';
        ctx.beginPath();
        ctx.ellipse(E.w - 8.2, E.h / 2 - 1.4, 2.4, 1.1, 0, 0, Math.PI * 2);
        ctx.fill();
        texto(ctx, 'MINI', E.w - 8.2, E.h / 2 - 1.4, 1.2, '#1a237e', { peso: 800 });
        texto(ctx, 'Inter face', E.w / 2, E.h / 2 + 1.3, 2.0, '#e3f2fd', { peso: 700 });
        texto(ctx, 'Supports all OBDII protocols', E.w / 2, E.h / 2 + 3.9, 1.6, '#e3f2fd', { peso: 600 });
        texto(ctx, 'ᛒ', 6.3, E.h / 2 - 0.5, 3.2, '#e3f2fd', { peso: 700 });
      });
      const rotulo = std(0xffffff, 0.5, 0, { map: tex, transparent: true, opacity: 0.94 });
      const corpo = new THREE.Mesh(new THREE.BoxGeometry(E.w, E.h, E.d), [vidroAzul, vidroAzul, vidroAzul, vidroAzul, rotulo, vidroAzul]);
      corpo.position.copy(W(x, y, z0 + E.h / 2));
      g.add(corpo);

      const verde = std(0x1f8a3a, 0.5);
      const tBt = 1.0, tMain = 1.2;
      const zBt = z0 + 4.2;            // placa do Bluetooth (face de baixo virada para o fundo da caixa)
      const zMain = z0 + 10.5;         // placa principal
      // placa do Bluetooth: verde, com serigrafia na face de baixo
      const texBtBaixo = textura(40, 19, (ctx) => {
        ctx.fillStyle = '#1f8a3a';
        ctx.fillRect(0, 0, 40, 19);
        ctx.strokeStyle = '#2fa64e';
        ctx.lineWidth = 0.3;
        for (let k = 0; k < 6; k++) trilhaTex(ctx, [[30 + k * 1.4, 2], [30 + k * 1.4, 8], [26, 10]], '#2fa64e', 0.25);
        // LEDs na ponta oposta à antena (foto da placa): dois verdes de tráfego e o vermelho de energia
        [['LED1', 4.2], ['LED3', 9.5], ['LED4', 13.9]].forEach(([t, ly]) => texto(ctx, t, 35.2, ly, 0.7, '#f5f5f5', { peso: 600, rot: -Math.PI / 2 }));
        texto(ctx, 'J2', 2.2, 1.6, 0.9, '#f5f5f5');
        texto(ctx, 'J1', 38, 17.6, 0.9, '#f5f5f5');
        texto(ctx, 'U4', 27, 9, 0.8, '#f5f5f5');
        texto(ctx, 'U6', 2.6, 17.4, 0.8, '#f5f5f5');
        texto(ctx, 'R24 R26 R27 R28', 31, 6.5, 0.6, '#f5f5f5', { peso: 500 });
      });
      g.add(placaModulo(x - 20, y - 9.5, 40, 19, zBt, tBt, verde, null, std(0xffffff, 0.5, 0, { map: texBtBaixo })));
      // módulo Bluetooth (azul, antena em zigue-zague para fora da placa), pendurado embaixo
      const texBt = textura(27, 13, (ctx) => {
        ctx.fillStyle = '#1565c0';
        ctx.fillRect(0, 0, 27, 13);
        ctx.strokeStyle = '#90caf9';
        ctx.lineWidth = 0.45;
        ctx.beginPath();
        let ax = 1.2;
        ctx.moveTo(ax, 11.5);
        for (let k = 0; k < 4; k++) { ctx.lineTo(ax, 1.5); ctx.lineTo(ax + 0.9, 1.5); ctx.lineTo(ax + 0.9, 11.5); ctx.lineTo(ax + 1.8, 11.5); ax += 1.8; }
        ctx.stroke();
        ctx.fillStyle = '#212121';
        ctx.fillRect(14, 4.5, 4.2, 4.2);
        ctx.fillStyle = '#cfd8dc';
        ctx.fillRect(10, 3.5, 2.4, 1.6);
        ctx.fillStyle = '#ffca28';
        for (let k = 0; k < 13; k++) { ctx.fillRect(9 + k * 1.4, 0, 0.7, 0.8); ctx.fillRect(9 + k * 1.4, 12.2, 0.7, 0.8); }
        texto(ctx, '16.000', 11.2, 6.2, 0.55, '#eceff1', { peso: 500 });
      });
      const bt = new THREE.Mesh(new THREE.BoxGeometry(27, 1.6, 13), [PCB.tja, PCB.tja, PCB.tja, std(0xffffff, 0.45, 0, { map: texBt }), PCB.tja, PCB.tja]);
      bt.position.copy(W(x - 9, y + 1.5, zBt - 0.8));
      g.add(bt);
      // regulador U4 (SOT-23) e os 3 LEDs na face de baixo, na ponta oposta à antena (foto da placa do Alan):
      // dois verdes que piscam com o tráfego OBD e o vermelho de energia, sempre aceso
      g.add(caixa(2.9, 1.0, 1.6, M.preto, x + 7, y - 0.5, zBt - 1.0));
      elmLeds = [[0x00e676, 4.4, 'trafego'], [0x00e676, 0, 'trafego'], [0xff1744, -5.3, 'energia']].map(([c, dy, papel]) => {
        const mat = std(c, 0.35, 0, { emissive: 0x000000 });
        mat.userData.cor = c;
        mat.userData.papel = papel;
        g.add(caixa(0.8, 0.6, 1.6, mat, x + 17.4, y + dy, zBt - 0.6));
        return mat;
      });
      // J1 (6 pinos) e J2 (7 pinos) ligando as placas
      const barra = (n, x0, y0, passoX) => {
        g.add(caixa(passoX * n, zMain - (zBt + tBt), 2.5, M.preto, x0 + (passoX * (n - 1)) / 2, y0, zBt + tBt));
        for (let k = 0; k < n; k++) g.add(cilindro(W(x0 + k * passoX, y0, zBt - 0.6), W(x0 + k * passoX, y0, zMain + tMain + 0.6), 0.32, M.ouro, 8));
      };
      barra(7, x - 18.5, y - 8.3, 2.54);
      barra(6, x + 5.5, y + 8.3, 2.54);
      // placa principal: PIC18F25K80 (SSOP-28) e cristal de 4 MHz virados para baixo
      const texMain = textura(40, 19, (ctx) => {
        ctx.fillStyle = '#1f8a3a';
        ctx.fillRect(0, 0, 40, 19);
        for (let k = 0; k < 10; k++) trilhaTex(ctx, [[12 + k * 1.3, 4], [12 + k * 1.3, 15]], '#2fa64e', 0.25);
        texto(ctx, 'U3', 30, 3, 0.8, '#f5f5f5');
        texto(ctx, 'Y1', 6, 3, 0.8, '#f5f5f5');
      });
      g.add(placaModulo(x - 20, y - 9.5, 40, 19, zMain, tMain, verde, null, std(0xffffff, 0.5, 0, { map: texMain })));
      const texPic = textura(10.2, 5.3, (ctx) => {
        ctx.fillStyle = '#1f1f21';
        ctx.fillRect(0, 0, 10.2, 5.3);
        texto(ctx, 'PIC18F25K80', 5.1, 1.7, 0.95, '#cfcfcf', { peso: 500 });
        texto(ctx, '-I/SS', 5.1, 2.9, 0.8, '#bdbdbd', { peso: 500 });
        texto(ctx, '1850AAJ', 5.1, 4.1, 0.8, '#bdbdbd', { peso: 500 });
      }, 60);
      const pic = new THREE.Mesh(new THREE.BoxGeometry(10.2, 1.5, 5.3), [M.preto, M.preto, M.preto, std(0xffffff, 0.6, 0, { map: texPic }), M.preto, M.preto]);
      pic.position.copy(W(x + 4, y, zMain - 0.75));
      g.add(pic);
      for (let k = 0; k < 14; k++) for (const s of [-1, 1]) g.add(caixa(0.3, 0.2, 1.0, M.estanho, x + 4 - 4.2 + k * 0.65, y + s * 3.1, zMain - 0.2));
      const cristal = new THREE.Mesh(new THREE.BoxGeometry(11, 3.4, 4.6), M.niquel);
      cristal.position.copy(W(x - 10, y, zMain - 1.7));
      g.add(cristal);
      // 16 pinos da placa principal até o conector
      for (const fy of [-2.6, 2.6]) {
        for (let k = 0; k < 8; k++) {
          const px = x + (k - 3.5) * 3.2 + (k >= 4 ? 1.4 : -1.4);
          g.add(cilindro(W(px, y + fy, zMain + tMain), W(px, y + fy, z0 + E.h), 0.22, M.ouro, 6));
        }
      }
      // conector OBD2 macho por cima, com os 16 contatos
      const pw = E.plugue_w;
      const boca = bocaDePe(x, y, z0 + E.h, trap(pw, pw - 7, 14, 2.2), trap(pw - 3, pw - 9.6, 11.4, 1.6, true), E.plugue, vidroAzul, std(0x15308a, 0.6, 0, { side: THREE.DoubleSide }));
      g.add(boca);
      contatos(g, x, y, z0 + E.h, E.plugue - 2.5);
      poe(g, 'acessorios', 'Adaptador ELM327 mini (Bluetooth, PIC18F25K80): consultas OBD no conector do carro, numa das fêmeas do cabo Y');
    }

    // Cabo Y: corpo com nervuras e boca para cima
    const conector = (x, y, macho) => {
      const C = K.con;
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) g.add(caixa(C.w - k * 0.6, C.h / 3 - 0.3, C.d - k * 0.6, preto, x, y, z0 + k * (C.h / 3)));
      if (macho) {
        g.add(bocaDePe(x, y, z0 + C.h, trap(38, 31, 14, 2.2), trap(35, 28.4, 11.4, 1.6, true), 9, pretoDuplo, std(0x151515, 0.8, 0, { side: THREE.DoubleSide })));
        contatos(g, x, y, z0 + C.h, 6);
      } else {
        // fêmea: bloco cheio com os 16 furos em cruz desenhados no topo
        const tex = textura(36, 13, (ctx) => {
          ctx.fillStyle = '#2a2a2a';
          ctx.fillRect(0, 0, 36, 13);
          ctx.fillStyle = '#0c0c0c';
          ctx.fillRect(4, 5.8, 28, 1.4);
          for (const fy of [3.2, 9.8]) {
            for (let k = 0; k < 8; k++) {
              const cx = 18 + (k - 3.5) * 3.2 + (k >= 4 ? 1.4 : -1.4);
              ctx.fillRect(cx - 0.9, fy - 0.3, 1.8, 0.6);
              ctx.fillRect(cx - 0.3, fy - 0.9, 0.6, 1.8);
            }
          }
        });
        const topo = std(0xffffff, 0.62, 0, { map: tex });
        const forma = trap(36, 30, 13, 2.0);
        const bloco = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: 9, bevelEnabled: false }), [topo, preto]);
        // a tampa (grupo 0) recebe a textura; o mapeamento do ExtrudeGeometry usa as coordenadas do plano
        tex.repeat.set(1 / 36, 1 / 13);
        tex.offset.set(0.5, 0.5);
        bloco.rotation.x = -Math.PI / 2;
        bloco.position.copy(W(x, y, z0 + C.h));
        g.add(bloco);
      }
      return g;
    };
    poe(conector(K.macho[0], K.macho[1], true), 'acessorios', 'Cabo Y OBD2: o macho encaixa no conector do carro');
    K.femeas.forEach((f, i) => poe(conector(f[0], f[1], false), 'acessorios',
      `Cabo Y OBD2: fêmea ${i + 1} (${i === 0 ? 'no ELM327' : 'no cabo da placa com o ESP32'})`));
    // cabos chatos de 16 vias, deitados: retas com cantos arredondados
    for (const pts of K.fitas) {
      const g = new THREE.Group();
      const F = K.fita;
      const fita = std(0x303030, 0.55);
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        const horiz = Math.abs(bx - ax) > Math.abs(by - ay);
        g.add(caixa(horiz ? len : F.w, F.t, horiz ? F.w : len, fita, (ax + bx) / 2, (ay + by) / 2, z0));
        // nervuras das 16 vias
        for (let k = 0; k < 16; k += 3) {
          const o = -F.w / 2 + 0.75 + k * 0.75;
          g.add(caixa(horiz ? len : 0.25, 0.15, horiz ? 0.25 : len, M.pretoFosco, (ax + bx) / 2 + (horiz ? 0 : o), (ay + by) / 2 + (horiz ? o : 0), z0 + F.t));
        }
      }
      for (const [x, y] of pts.slice(1, -1)) g.add(cilindro(W(x, y, z0), W(x, y, z0 + F.t), F.w / 2, fita, 24));
      poe(g, 'acessorios', 'Cabo Y OBD2: cabo chato de 16 vias (encurtado no desenho)');
    }
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

  // ------------------------------------------------------------ legenda dos fios (cabo OBD e cabo do BMP180)
  {
    const leg = document.getElementById('legenda3d');
    const cor = (c, listra) => {
      const sw = document.createElement('span');
      sw.className = 'placa3d-cor';
      sw.style.background = listra ? `linear-gradient(${c} 0 35%, ${listra} 35% 65%, ${c} 65%)` : c;
      return sw;
    };
    const tabela = (alvo, titulo, cab, linhas) => {
      const h = document.createElement('h2');
      h.textContent = titulo;
      const t = document.createElement('table');
      const thead = t.createTHead().insertRow();
      for (const c of cab) {
        const th = document.createElement('th');
        th.className = 'visually-hidden';
        th.textContent = c;
        thead.appendChild(th);
      }
      const tb = t.createTBody();
      for (const l of linhas) {
        const tr = tb.insertRow();
        if (l.isolado) tr.className = 'isolado';
        tr.insertCell().appendChild(cor(l.cor, l.listra));
        const p = tr.insertCell();
        p.className = 'pino';
        p.textContent = l.pino;
        tr.insertCell().textContent = l.funcao;
        tr.insertCell().textContent = l.cor_nome;
      }
      alvo.replaceChildren(h, t);
    };
    if (leg && X.cabo_obd) {
      const C = X.cabo_obd;
      tabela(document.getElementById('legenda3d-obd'), 'Cabo OBD2: pino, função e cor do fio', ['Cor', 'Pino', 'Função', 'Fio'],
        [...C.fios, { ...C.pino6, isolado: true }]);
      if (X.bmp_modulo) {
        tabela(document.getElementById('legenda3d-bmp'), 'Cabo do BMP180: pino, função e cor do fio', ['Cor', 'Pino', 'Função', 'Fio'],
          X.bmp_modulo.cabo.map((f) => ({ ...f, pino: f.n })));
      }
      if (X.lsm_modulo) {
        tabela(document.getElementById('legenda3d-lsm'), 'Cabo do LSM6DS3: pino, função e cor do fio', ['Cor', 'Pino', 'Função', 'Fio'],
          X.lsm_modulo.cabo.map((f) => ({ ...f, pino: f.n })));
      }
      // LEDs de estado (firmware esp32-can-listen 1.4): só cores puras no tricolor; o azul da placa pisca junto
      if (X.led) {
        const h = document.createElement('h2');
        h.textContent = 'LEDs de estado: cor e ritmo';
        const t = document.createElement('table');
        const cab = t.createTHead().insertRow();
        for (const c of ['Cor', 'Situação', 'Ritmo']) {
          const th = document.createElement('th');
          th.className = 'visually-hidden';
          th.textContent = c;
          cab.appendChild(th);
        }
        const tb = t.createTBody();
        const linhas = [
          ['#1e88e5', 'azul', 'Sem o app', '1 piscada por segundo'],
          ['#43a047', 'verde', 'Com o app, rede sem quadros', '1 piscada por segundo'],
          ['#43a047', 'verde', 'Capturando', '2 piscadas por segundo'],
          ['#e53935', 'vermelho', 'Erro do transceptor', 'rápido, por 10 s'],
          [null, 'apagado', 'Descanso (rede parada)', 'apagado'],
        ];
        for (const [c, nome, situacao, ritmo] of linhas) {
          const tr = tb.insertRow();
          if (!c) tr.className = 'isolado';
          const sw = document.createElement('span');
          sw.className = 'placa3d-cor led';
          if (c) sw.style.background = c;
          sw.title = nome;
          tr.insertCell().appendChild(sw);
          tr.insertCell().textContent = situacao;
          tr.insertCell().textContent = ritmo;
        }
        const nota = document.createElement('p');
        nota.className = 'placa3d-nota';
        nota.textContent = 'Cores do LED tricolor (opcional). O LED azul da placa do ESP32 pisca junto, no mesmo ritmo, sempre em azul. As piscadas são curtas (80 ms).';
        document.getElementById('legenda3d-led').replaceChildren(h, t, nota);
      }
      // a legenda começa fechada, para não cobrir a placa; abre com um clique
      leg.hidden = false;
    }
  }

  // ------------------------------------------------------------ LED tricolor (opcional): conector na linha 1 e LED na tampa
  let ledTri = null;   // vidro do LED tricolor: a animação acende a cor dele
  if (X.led) {
    const L = X.led;
    const ys = L.pinos[0][1];
    const xs = L.pinos.map((q) => q[0]);
    const base = new THREE.Group();
    base.add(caixa(Math.max(...xs) - Math.min(...xs) + P, A.MALE_H, P, M.preto, (Math.min(...xs) + Math.max(...xs)) / 2, ys, A.T));
    for (const [x, y] of L.pinos) base.add(cilindro(W(x, y, -0.95), W(x, y, A.T + A.MALE_H + 6), 0.32, M.ouro, 4));
    poe(base, 'placa', `Conector do LED tricolor (linha 1): ${L.conector.map((c) => `${c.n === 'COM' ? 'comum' : c.n} no ${c.esp}`).join(', ')}; o pino do meio fica sem ligação`);
    for (const f of L.fios) {
      const g = new THREE.Group();
      const c = L.conector.find((q) => q.n === f.n);
      g.add(caixa(P, A.HOUSING_H, P, M.nylon, c.p[0], c.p[1], A.T + A.MALE_H));
      const curva = new THREE.CatmullRomCurve3(f.pts.map((q) => W(q[0], q[1], q[2])), false, 'centripetal');
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 40, 0.45, 8), std(new THREE.Color(f.cor).getHex(), 0.5)));
      if (f.resistor) {
        const [a, b] = f.pts.slice(-2);
        g.add(cilindro(W(a[0], a[1], a[2]), W(b[0], b[1], b[2]), 0.9, M.pretoFosco, 12));
      }
      const nome = { COM: 'comum (no D18)', R: 'vermelho (no TX2)', G: 'verde (no RX2)', B: 'azul (no D4)' }[f.n];
      poe(g, 'led', `LED tricolor: fio do ${nome}${f.resistor ? ', com o resistor no termorretrátil' : ''}`);
    }
    const led = new THREE.Group();
    const vidro = std(0xeef3f6, 0.15, 0, { transparent: true, opacity: 0.82, emissive: 0x000000 });
    ledTri = vidro;
    led.add(cilindro(W(L.c[0], L.c[1], L.z), W(L.c[0], L.c[1], L.z + 1), 2.9, vidro, 32));
    led.add(cilindro(W(L.c[0], L.c[1], L.z + 1), W(L.c[0], L.c[1], L.topo), 2.5, vidro, 32));
    const domo = new THREE.Mesh(new THREE.SphereGeometry(2.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), vidro);
    domo.position.copy(W(L.c[0], L.c[1], L.topo));
    led.add(domo);
    poe(led, 'led', 'LED tricolor de 5 mm (opcional), no furo da tampa: azul sem o app, verde com o app (2 piscadas capturando), vermelho no erro');
  }

  // ------------------------------------------------------------ caixa de proteção (caixa.py): base e tampa
  const CX = X.caixa;
  const matBase = std(0x4b5661, 0.62);
  const matTampa = std(0x6f7d89, 0.58, 0, { transparent: true });
  if (CX) {
    camadas.caixa = new THREE.Group();
    camadas.tampa = new THREE.Group();
    scene.add(camadas.caixa, camadas.tampa);
    const peca = (p, mat) => {
      if (p.t === 'box') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(p.b[0] - p.a[0], p.b[2] - p.a[2], p.b[1] - p.a[1]), mat);
        m.position.copy(W((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2));
        return m;
      }
      const [z0, z1] = p.z;
      let geo;
      if (p.t === 'cil') {
        geo = new THREE.CylinderGeometry(p.r, p.r, z1 - z0, 40);
      } else {
        // anel (torre com furo) ou placa com furo (aba): contorno com o furo, extrudado na altura
        const sh = new THREE.Shape();
        if (p.t === 'anel') sh.absarc(0, 0, p.r, 0, Math.PI * 2, false);
        else {
          sh.moveTo(-p.w / 2, -p.h / 2);
          sh.lineTo(p.w / 2, -p.h / 2);
          sh.lineTo(p.w / 2, p.h / 2);
          sh.lineTo(-p.w / 2, p.h / 2);
          sh.closePath();
        }
        const furo = new THREE.Path();
        furo.absarc(0, 0, p.ri, 0, Math.PI * 2, true);
        sh.holes.push(furo);
        geo = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false, curveSegments: 32 });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, -(z1 - z0) / 2, 0);
      }
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(W(p.c[0], p.c[1], (z0 + z1) / 2));
      return m;
    };
    for (const p of CX.base) poe(peca(p, matBase), 'caixa', p.n || 'Caixa');
    for (const p of CX.tampa) poe(peca(p, matTampa), 'tampa', p.n || 'Tampa');
  }
  const chaoPlaca = chao.position.y;
  // sem caixa; dentro (tampa transparente); fora (vista explodida: a placa e a tampa sobem)
  const EXPLODE = { pecas: 40, tampa: 78 };
  let modo = 'sem';
  function modoCaixa(novo) {
    if (!CX) return;
    const antes = modo;
    modo = novo;
    // A tampa e a placa vão até a posição nova devagar (anim.caixa); ao mostrar a caixa, a tampa desce de cima.
    if (antes === 'sem' && modo !== 'sem') {
      camadas.caixa.visible = camadas.tampa.visible = true;
      anim.caixa.tampa = EXPLODE.tampa + 50;
    }
    anim.caixa.alvoPecas = modo === 'fora' ? EXPLODE.pecas : 0;
    anim.caixa.alvoTampa = modo === 'fora' ? EXPLODE.tampa : modo === 'sem' ? EXPLODE.tampa + 50 : 0;
    anim.caixa.ativa = true;
    pedir();
    const vidro = modo === 'dentro';
    matTampa.opacity = vidro ? 0.26 : 1;
    matTampa.depthWrite = !vidro;
    camadas.tampa.traverse((o) => {
      if (o.isMesh) o.castShadow = !vidro;
    });
    chao.position.y = modo === 'sem' ? chaoPlaca : Math.min(chaoPlaca, CX.externa.z0);
    for (const b of document.querySelectorAll('[data-caixa]')) {
      const ativo = b.dataset.caixa === modo;
      b.classList.toggle('active', ativo);
      b.setAttribute('aria-pressed', String(ativo));
    }
    vista(vistaAtual);
  }

  // ------------------------------------------------------------ animações: LEDs, caixa, giro e sinais nos fios
  const poucoMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anim = {
    led: 'capturando',
    girar: !poucoMovimento,
    sinais: !poucoMovimento,
    caixa: { pecas: 0, tampa: 0, alvoPecas: 0, alvoTampa: 0, ativa: false },
  };
  // Cores e ritmos do firmware esp32-can-listen 1.4 (piscadas curtas de 80 ms; só cores puras no tricolor)
  const LED_ESTADOS = {
    sem_app: { cor: 0x1e88e5, porSeg: 1 },
    sem_rede: { cor: 0x43a047, porSeg: 1 },
    capturando: { cor: 0x43a047, porSeg: 2 },
    erro: { cor: 0xe53935, rapido: true },
    descanso: null,
  };
  function ledAceso(e, ms) {
    if (!e) return false;
    if (e.rapido) return ms % 200 < 100;
    const f = ms % 1000;
    return f < 80 || (e.porSeg === 2 && f >= 500 && f < 580);
  }
  const PRETO = new THREE.Color(0x000000);
  function acenderLeds(ms) {
    const e = LED_ESTADOS[anim.led];
    const on = ledAceso(e, ms);
    M.ledEsp.emissive.set(on ? 0x3b82ff : 0x000000);
    M.ledEsp.emissiveIntensity = on ? 3 : 1;
    // LED de energia: sempre aceso (no descanso o ESP32 dorme, mas a placa continua alimentada)
    M.ledPwr.emissive.set(0xff1a1a);
    M.ledPwr.emissiveIntensity = 1.8;
    if (ledTri) {
      if (on) ledTri.emissive.set(e.cor); else ledTri.emissive.copy(PRETO);
      ledTri.emissiveIntensity = on ? 2.6 : 1;
    }
    // ELM327: vermelho de energia sempre aceso (alimentado pela tomada do carro); os dois verdes piscam
    // rápido enquanto há tráfego OBD (estado Capturando) e ficam apagados sem tráfego
    const consultando = anim.led === 'capturando';
    elmLeds.forEach((m, k) => {
      const aceso = m.userData.papel === 'energia' || (consultando && Math.floor(ms / (70 + k * 37)) % 2 === 0);
      m.emissive.set(aceso ? m.userData.cor : 0x000000);
      m.emissiveIntensity = aceso ? 2.2 : 1;
    });
  }

  // Sinais nos fios: pulsos de luz andando pelos caminhos; rápidos nos de dados, lentos na alimentação, nada no GND.
  const pulsos = [];
  const geoPulso = new THREE.SphereGeometry(1.15, 14, 10);
  const branco = new THREE.Color(0xffffff);
  function sinal(camada, nome, cor, pts, raio = 0.8) {
    if (!pts || pts.length < 2 || !camadas[camada]) return;
    if (/GND|[Tt]erra|IN−|OUT−|isolado|sem liga/.test(nome)) return;
    const curva = caminho(pts, raio);
    const len = curva.getLength();
    if (len < 4) return;
    const energia = /12 V|5 V|VCC|VIN|3V3|OUT\+|fusível|comum|\+12/.test(nome);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(cor).lerp(branco, 0.6) });
    const n = Math.max(1, Math.min(4, Math.round(len / 25)));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geoPulso, mat);
      m.visible = anim.sinais;
      camadas[camada].add(m);
      pulsos.push({ m, curva, len, vel: energia ? 14 : 45, fase: i / n });
    }
  }
  for (const f of X.fios) sinal('fios', f.n, f.cor, f.pts, 1.4);
  for (const t of X.trilhas) sinal('trilhas', t.n, t.cor, t.pts.map(([x, y]) => [x, y, A.BOT_Z]), 0.6);
  for (const f of X.fios_baixo || []) sinal('trilhas', f.n, f.cor, f.pts.map(([x, y]) => [x, y, -1.05]));
  if (X.cabo_obd) for (const f of X.cabo_obd.fios) sinal('fios', `${f.n} ${f.funcao}`, f.cor, f.pts);
  if (X.bmp_modulo) for (const f of X.bmp_modulo.cabo) sinal('bmp180', `${f.n} ${f.funcao}`, f.cor, f.pts);
  if (X.lsm_modulo) for (const f of X.lsm_modulo.cabo) sinal('lsm6ds3', `${f.n} ${f.funcao}`, f.cor, f.pts);
  if (X.tja) for (const p of X.tja.can) if (p.fio && p.n === 'CANL') sinal('modulos', 'CANL', '#1e88e5', p.fio);
  if (X.led) for (const f of X.led.fios) sinal('led', f.n === 'COM' ? 'comum' : f.n, f.cor, f.pts);

  function animarQuadro(dt, agora) {
    acenderLeds(agora);
    if (anim.girar) meta.yaw -= dt * 0.22;
    if (anim.sinais) {
      const s = agora / 1000;
      for (const p of pulsos) p.m.position.copy(p.curva.getPointAt((s * p.vel / p.len + p.fase) % 1));
    }
    const C = anim.caixa;
    if (C.ativa && CX) {
      const k = poucoMovimento ? 1 : 1 - Math.exp(-dt * 4);
      C.pecas += (C.alvoPecas - C.pecas) * k;
      C.tampa += (C.alvoTampa - C.tampa) * k;
      if (Math.abs(C.alvoPecas - C.pecas) < 0.05 && Math.abs(C.alvoTampa - C.tampa) < 0.05) {
        C.pecas = C.alvoPecas;
        C.tampa = C.alvoTampa;
        C.ativa = false;
        if (modo === 'sem') {   // a tampa já saiu de vista: esconde a caixa e deixa a tampa no lugar para a próxima
          camadas.caixa.visible = camadas.tampa.visible = false;
          C.tampa = 0;
        }
      }
      for (const [key, g] of Object.entries(camadas)) {
        if (key !== 'caixa' && key !== 'tampa' && key !== 'acessorios') g.position.y = C.pecas;
      }
      camadas.tampa.position.y = C.tampa;
    }
  }
  // Pisca sempre (os LEDs), mas no descanso, sem giro, sem pulsos e sem transição, a cena fica parada.
  const animando = () => anim.girar || anim.sinais || anim.caixa.ativa || anim.led !== 'descanso';
  function pararGiro() {
    if (!anim.girar) return;
    anim.girar = false;
    const c = document.getElementById('girar3d');
    if (c) c.checked = false;
  }

  // ------------------------------------------------------------ câmera e controles
  // dx: onde o alvo fica no eixo do cabo OBD: a placa e o plugue cabem juntos e sobra o canto da legenda (embaixo à esquerda)
  const VISTAS = {
    perspectiva: { yaw: -0.45, pitch: 0.66, dist: 215, dx: 10 },
    cima: { yaw: 0, pitch: 1.5607, dist: 220, dx: 4 },
    baixo: { yaw: Math.PI, pitch: -1.5607, dist: 220, dx: 78 },
    lado: { yaw: 0, pitch: 0.1, dist: 205, dx: 4 },
  };
  const alvoPadrao = (dx = 0) => {
    // com a caixa a cena cresce para a esquerda (torres e abas): o alvo vai junto, longe da legenda
    const sobe = modo === 'fora' ? EXPLODE.pecas : 0;
    const lado = modo === 'sem' ? 0 : -14;
    // o ELM327 e o cabo Y ficam atrás da placa: o alvo recua e vai um pouco para a direita
    const ac = X.acessorios && camadas.acessorios?.visible ? { x: 22, z: -14 } : { x: 0, z: 0 };
    return X.cabo_obd ? new THREE.Vector3(dx + lado + ac.x, 5 + sobe, 10 + ac.z) : new THREE.Vector3(8 + lado + ac.x, 5 + sobe, ac.z);
  };
  let vistaAtual = 'perspectiva';
  const cam = { yaw: 0, pitch: 0, dist: 150, alvo: alvoPadrao() };
  const meta = { ...cam, alvo: alvoPadrao() };
  function vista(nome) {
    vistaAtual = nome;
    const { dx, ...v } = VISTAS[nome];
    const acDist = X.acessorios && camadas.acessorios?.visible ? (nome === 'cima' || nome === 'baixo' ? 1.65 : 1.45) : 1;
    Object.assign(meta, v, { alvo: alvoPadrao(dx), dist: v.dist * ({ sem: 1, dentro: 1.12, fora: 1.4 })[modo] * acDist });
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
  let ultimoQuadro = performance.now();
  function quadro() {
    pendente = false;
    const agora = performance.now();
    const dt = Math.min(0.1, (agora - ultimoQuadro) / 1000);
    ultimoQuadro = agora;
    animarQuadro(dt, agora);
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
    if (mexeu || animando()) pedir();
  }

  const ponteiros = new Map();
  let pinca = 0;
  let arrastou = false;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    pararGiro();
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
    pararGiro();
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
  for (const btn of document.querySelectorAll('[data-caixa]')) btn.addEventListener('click', () => modoCaixa(btn.dataset.caixa));
  for (const btn of document.querySelectorAll('[data-led]')) {
    btn.addEventListener('click', () => {
      anim.led = btn.dataset.led;
      for (const b of document.querySelectorAll('[data-led]')) {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      }
      pedir();
    });
  }
  const girar = document.getElementById('girar3d');
  if (girar) {
    girar.checked = anim.girar;
    girar.addEventListener('change', () => { anim.girar = girar.checked; pedir(); });
  }
  const sinais = document.getElementById('sinais3d');
  if (sinais) {
    sinais.checked = anim.sinais;
    sinais.addEventListener('change', () => {
      anim.sinais = sinais.checked;
      for (const p of pulsos) p.m.visible = anim.sinais;
      pedir();
    });
  }
  if (CX) {
    camadas.caixa.visible = camadas.tampa.visible = false;
    const grupo = document.getElementById('modo-caixa');
    if (grupo) grupo.hidden = false;
  }
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
      if (key === 'acessorios') vista(vistaAtual);
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
  {
    const { dx, ...v } = VISTAS[VISTAS[inicial] ? inicial : 'perspectiva'];
    Object.assign(cam, v, { alvo: alvoPadrao(dx) });
  }
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
