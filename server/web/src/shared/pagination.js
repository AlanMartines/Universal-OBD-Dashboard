const WINDOW = 2;
// Parâmetros de aviso não devem seguir nos links de página.
const DROPPED = ['ok', 'erro', 'aviso'];

/** Número de página vindo da URL. Qualquer valor estranho vira a primeira página. */
export function pageParam(request, name = 'page') {
  const raw = String(request.query?.[name] ?? '');
  return /^[1-9][0-9]{0,5}$/.test(raw) ? raw : '1';
}

/** Monta os links do componente de paginação. Com uma página só, não há o que mostrar. */
export function pagerFor(page, request, { path, param = 'page' }) {
  if (!page || page.totalPages <= 1) return null;
  const urlFor = (number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (!DROPPED.includes(key) && typeof value === 'string') query.set(key, value);
    }
    query.set(param, String(number));
    return `${path}?${query}`;
  };
  const link = (number, title, icon, disabled) => ({ url: urlFor(number), title, icon, disabled });
  const links = [
    link(1, 'Primeira página', 'fa-angles-left', page.page === 1),
    link(page.page - 1, 'Página anterior', 'fa-angle-left', page.page === 1),
  ];
  const first = Math.max(1, page.page - WINDOW);
  const last = Math.min(page.totalPages, page.page + WINDOW);
  for (let number = first; number <= last; number += 1) {
    links.push({ url: urlFor(number), number, title: `Página ${number}`, active: number === page.page });
  }
  links.push(
    link(page.page + 1, 'Próxima página', 'fa-angle-right', page.page === page.totalPages),
    link(page.totalPages, 'Última página', 'fa-angles-right', page.page === page.totalPages),
  );
  return {
    from: (page.page - 1) * page.pageSize + 1,
    to: Math.min(page.page * page.pageSize, page.total),
    total: page.total,
    links,
  };
}
