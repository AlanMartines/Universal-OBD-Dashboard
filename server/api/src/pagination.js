export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const pageNumberSchema = { type: 'string', pattern: '^[1-9][0-9]{0,5}$' };
export const pageSizeSchema = { type: 'string', pattern: '^[1-9][0-9]{0,2}$' };

/**
 * Executa uma listagem paginada no banco. Página além da última volta para a última,
 * o que acontece quando alguém exclui itens enquanto outra pessoa navega.
 * listSql recebe LIMIT e OFFSET aqui, sempre como parâmetros.
 */
export async function paged(db, { countSql, listSql, params = [], page = '1', pageSize }) {
  const size = Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const { rows: [{ total }] } = await db.query(countSql, params);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Number(page) || 1, totalPages);
  const { rows } = await db.query(
    `${listSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, size, (current - 1) * size],
  );
  return {
    rows,
    pagination: { page: current, pageSize: size, total, totalPages },
  };
}
