// Área pública do projeto: apresentação (/projeto), propósito (/sobre) e a placa da escuta CAN em 3D (/projeto/placa).
// Não pede login e não mostra dado de ninguém: só o que já está no repositório público.
export const REPO_URL = 'https://github.com/AlanMartines/Universal-OBD-Dashboard';
export const PLACA_URL = `${REPO_URL}/tree/master/veiculos/fiat-uno-vivace-2012/placa`;

const PAGE = { publicPage: true, repoUrl: REPO_URL, placaUrl: PLACA_URL, pageCss: ['/modules/projeto/projeto.css'] };

export default function projetoRoutes(app) {
  app.get('/projeto', async (_request, reply) => reply.view('modules/projeto/views/projeto.hbs', {
    ...PAGE, title: 'O projeto', activeTab: 'projeto',
  }));

  app.get('/sobre', async (_request, reply) => reply.view('modules/projeto/views/sobre.hbs', {
    ...PAGE, title: 'Sobre', activeTab: 'sobre',
  }));

  // ?versao=sn65 mostra a versão alternativa, com o SN65HVD230 no lugar do TJA1050; qualquer outro valor, a principal.
  app.get('/projeto/placa', async (request, reply) => {
    const sn65 = request.query?.versao === 'sn65';
    return reply.view('modules/projeto/views/placa.hbs', {
      ...PAGE,
      title: 'Placa em 3D',
      activeTab: 'placa',
      sn65,
      transceptor: sn65 ? 'SN65HVD230' : 'TJA1050',
      // Posições geradas por veiculos/fiat-uno-vivace-2012/placa/gerar_3d.py (o teste confere se a cópia está igual);
      // placa3d.mjs monta as peças com detalhe usando o Three.js local.
      pageScripts: [sn65 ? '/modules/projeto/modelo3d-sn65-dados.js' : '/modules/projeto/modelo3d-dados.js'],
      pageModules: ['/modules/projeto/placa3d.mjs'],
    });
  });
}
