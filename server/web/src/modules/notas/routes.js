// Notas do projeto (/admin/notas): como tudo funciona, o que está feito, o que está pendente, as avaliações técnicas e as
// decisões. Só o Super Admin vê (menu e página). O conteúdo é do próprio repositório, sem dado de ninguém.
import { ApiError } from '../../shared/errors.js';

export default function notasRoutes(app, { requireAdmin, context }) {
  const requireSuperadmin = async (request, reply) => {
    const result = await requireAdmin(request, reply);
    if (reply.sent || result) return result;
    if (request.user.role !== 'superadmin') throw new ApiError(403, 'forbidden');
    return undefined;
  };

  app.get('/admin/notas', { preHandler: requireSuperadmin }, async (request, reply) => reply.view(
    'modules/notas/views/notas.hbs',
    context(request, { title: 'Notas do projeto', pageCss: ['/modules/notas/notas.css'] }),
  ));
}
