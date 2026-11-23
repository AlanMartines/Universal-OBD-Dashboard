import { audit } from '../db.js';
import { fail } from '../errors.js';

const AREA = { type: 'string', pattern: '^[a-z0-9-]{1,80}$' };
const CODIGOS = { maps_unconfigured: 503, maps_busy: 409, maps_area_not_found: 404, maps_no_permission: 503 };

/**
 * Página Mapas (só Super Admin): situação, catálogo do mundo inteiro, tamanho de uma área, baixar ou
 * atualizar e excluir o mapa base e o encaixe nas ruas. Baixar e excluir pedem a senha confirmada há
 * pouco e ficam na auditoria. O trabalho em si roda no contêiner "mapas".
 */
export default function mapsRoutes(app, { pool, maps, requireSuperadmin, requireRecentAuth }) {
  const repassar = async (acao) => {
    try {
      return await acao();
    } catch (error) {
      const code = CODIGOS[error.code] ? error.code : 'maps_unavailable';
      throw fail(CODIGOS[code] ?? 503, code);
    }
  };
  const quem = (request) => request.session.impersonatedBy ?? request.session.user.username;

  app.get('/internal/admin/maps', { preValidation: requireSuperadmin }, async () => repassar(() => maps.estado()));
  app.get('/internal/admin/maps/catalog', { preValidation: requireSuperadmin }, async () => repassar(() => maps.catalogo()));
  app.get('/internal/admin/maps/size', {
    preValidation: requireSuperadmin,
    schema: { querystring: { type: 'object', required: ['area'], additionalProperties: false, properties: { area: AREA } } },
  }, async (request) => repassar(() => maps.tamanho(request.query.area)));

  app.post('/internal/admin/maps', {
    preValidation: [requireSuperadmin, requireRecentAuth],
    schema: {
      body: {
        type: 'object', required: ['map', 'area'], additionalProperties: false,
        properties: { map: { enum: ['base', 'encaixe'] }, area: AREA },
      },
    },
  }, async (request, reply) => {
    const { map, area } = request.body;
    await repassar(() => maps.comecar(map, area));
    await audit(pool, { actor: quem(request), action: 'mapa_pedido', target: `${map}: ${area}`, ip: request.clientIp });
    reply.code(202);
    return { ok: true };
  });

  app.delete('/internal/admin/maps/:map', {
    preValidation: [requireSuperadmin, requireRecentAuth],
    schema: { params: { type: 'object', required: ['map'], properties: { map: { enum: ['base', 'encaixe'] } } } },
  }, async (request) => {
    await repassar(() => maps.excluir(request.params.map));
    await audit(pool, { actor: quem(request), action: 'mapa_excluido', target: request.params.map, ip: request.clientIp });
    return { ok: true };
  });
}
