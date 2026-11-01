import { pageParam } from '../../shared/pagination.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function vehicleRoutes(app, { api, requireUser, context }) {
  // Mesmos mostradores do APK. A escolha do veículo só seleciona: quem libera é a sessão, na API.
  app.get('/painel-veiculo', { preHandler: requireUser }, async (request, reply) => {
    const query = new URLSearchParams({ page: pageParam(request), pageSize: '100' });
    const { devices } = await api(request, 'GET', `/internal/devices?${query}`);
    const usable = devices.filter((d) => d.pairedAt && !d.revokedAt);
    const wanted = String(request.query.dispositivo ?? '');
    const id = UUID.test(wanted) ? wanted : usable[0]?.id;
    let latest = null;
    if (id) ({ latest } = await api(request, 'GET', `/internal/devices/${id}`));
    return reply.view('modules/vehicle/views/panel.hbs', context(request, {
      title: 'Painel do veículo',
      devices: usable.map((d) => ({ ...d, selected: d.id === id })),
      deviceId: id,
      latestJson: JSON.stringify(latest),
      pageCss: ['/modules/vehicle/dash.css', '/modules/vehicle/vehicle.css'],
      pageScripts: ['/modules/vehicle/dash.js', '/modules/vehicle/vehicle.js'],
    }));
  });
}
