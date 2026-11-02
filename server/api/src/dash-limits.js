// Só o que o painel usa, dentro de faixas possíveis: o resto da leitura não vai para o cadastro.
const RANGES = {
  'dash.rpmMax': [1000, 20000],
  'dash.rpmRedline': [500, 20000],
  'dash.speedMax': [40, 300],
  'dash.speedCorrectionPct': [-10, 15],
  'dash.voltageMin': [0, 40],
  'dash.voltageMax': [0, 40],
  'dash.thermostatC': [-40, 200],
  'dash.fan1C': [-40, 200],
  'dash.fan2C': [-40, 200],
  'dash.criticalC': [-40, 200],
  'dash.tankL': [1, 500],
  'dash.reserveL': [0, 500],
};

export function dashLimitsFrom(metrics) {
  const limits = {};
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const value = metrics[key];
    if (typeof value === 'number' && value >= min && value <= max) limits[key] = value;
  }
  return Object.keys(limits).length ? limits : null;
}
