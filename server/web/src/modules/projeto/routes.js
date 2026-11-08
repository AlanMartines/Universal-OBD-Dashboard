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

  app.get('/projeto/placa', async (_request, reply) => reply.view('modules/projeto/views/placa.hbs', {
    ...PAGE,
    title: 'Placa em 3D',
    activeTab: 'placa',
    // Cópias geradas por veiculos/fiat-uno-vivace-2012/placa/gerar_3d.py (o teste confere se estão iguais).
    pageScripts: ['/modules/projeto/modelo3d-dados.js', '/modules/projeto/visor3d.js'],
  }));
}
