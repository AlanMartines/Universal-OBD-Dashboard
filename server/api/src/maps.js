/*
 * Cliente do contêiner "mapas" (baixa e prepara o mapa base e o encaixe nas ruas). Só a API fala com ele,
 * pela rede interna do Compose. Sem MAPAS_URL, a página Mapas avisa que o serviço não está configurado e
 * o encaixe depende só do OSRM_URL, como antes.
 */
const TIPOS = new Set(['base', 'encaixe']);

export function createMapsClient({ url, fetchImpl = fetch, timeoutMs = 8000 }) {
  const base = (url || '').replace(/\/+$/, '');
  let cacheEncaixe = null;

  async function pedir(caminho, { method = 'GET', body } = {}) {
    if (!base) throw Object.assign(new Error('mapas não configurado'), { code: 'maps_unconfigured' });
    let res;
    try {
      res = await fetchImpl(`${base}${caminho}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw Object.assign(new Error('mapas fora do ar'), { code: 'maps_unavailable' });
    }
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = res.status === 409 ? 'maps_busy' : res.status === 404 ? 'maps_area_not_found' : res.status === 403 ? 'maps_no_permission' : 'maps_unavailable';
      throw Object.assign(new Error(dados.message || `mapas ${res.status}`), { code, status: res.status });
    }
    return dados;
  }

  return {
    enabled: Boolean(base),
    estado: () => pedir('/estado'),
    catalogo: () => pedir('/catalogo'),
    tamanho: (area) => pedir(`/tamanho?${new URLSearchParams({ area })}`),
    async comecar(mapa, area) {
      if (!TIPOS.has(mapa)) throw Object.assign(new Error('mapa inválido'), { code: 'invalid_request' });
      cacheEncaixe = null;
      return pedir('/trabalhos', { method: 'POST', body: { mapa, area } });
    },
    async excluir(mapa) {
      if (!TIPOS.has(mapa)) throw Object.assign(new Error('mapa inválido'), { code: 'invalid_request' });
      cacheEncaixe = null;
      return pedir(`/mapas/${mapa}`, { method: 'DELETE' });
    },
    /**
     * Há mapa de encaixe instalado? Cache de 30 s. Sem o serviço de mapas configurado, null: quem chama
     * decide só pelo OSRM_URL (instalações antigas, com o mapa preparado pelo script).
     */
    async encaixeInstalado() {
      if (!base) return null;
      if (cacheEncaixe && cacheEncaixe.ate > Date.now()) return cacheEncaixe.valor;
      let valor = null;
      try {
        valor = Boolean((await pedir('/estado')).encaixe?.instalado);
      } catch {
        valor = null;
      }
      cacheEncaixe = { valor, ate: Date.now() + 30000 };
      return valor;
    },
  };
}
