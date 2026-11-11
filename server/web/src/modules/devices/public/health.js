/* Aba Saúde: gráficos diários a partir do atributo data-health (sem script embutido). Um eixo por gráfico. */
(function () {
  'use strict';

  var box = document.querySelector('[data-health]');
  if (!box || !window.Chart) return;
  var data;
  try { data = JSON.parse(box.dataset.health); } catch (e) { return; }
  var charts = [];

  function css(name, fb) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; }

  function line(id, series, opts) {
    var canvas = document.getElementById(id);
    if (!canvas) return;
    var colors = [css('--app-series-1', '#128a49'), css('--app-series-2', '#2a78d6')];
    charts.push(new window.Chart(canvas, {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: series.map(function (s, i) {
          return {
            label: s.label, data: s.data, borderColor: colors[i], backgroundColor: colors[i],
            spanGaps: true, pointRadius: data.labels.length <= 31 ? 3 : 0, pointHoverRadius: 5,
          };
        }),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: series.length > 1, position: 'bottom' },
          tooltip: {
            callbacks: {
              label: function (c) {
                var v = c.parsed.y;
                return v == null ? null : ' ' + c.dataset.label + ': ' + v.toLocaleString('pt-BR', { maximumFractionDigits: opts.digits }) + ' ' + opts.unit;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
          y: { suggestedMin: opts.min, suggestedMax: opts.max, ticks: { maxTicksLimit: 6 } },
        },
      },
    }));
  }

  function draw() {
    charts.forEach(function (c) { c.destroy(); });
    charts = [];
    line('hc-stft', [{ label: 'Rodando', data: data.stftWarm }, { label: 'Marcha lenta', data: data.stftIdle }], { unit: '%', digits: 1, min: -10, max: 10 });
    line('hc-volts', [{ label: 'Desligado (bateria)', data: data.voltsOff }, { label: 'Ligado (alternador)', data: data.voltsRunning }], { unit: 'V', digits: 2, min: 12, max: 14.6 });
    line('hc-cool', [{ label: 'Média aquecido', data: data.coolantWarm }, { label: 'Máxima', data: data.coolantMax }], { unit: '°C', digits: 0, min: 80, max: 105 });
    line('hc-lambda', [{ label: 'Oscilação', data: data.lambdaSd }], { unit: 'V', digits: 3, min: 0, max: 0.25 });
  }

  // Gráfico desenhado escondido (aba fechada) fica sem tamanho: desenha ao abrir a aba e ao trocar o tema.
  var tab = document.getElementById('tab-health');
  if (tab) tab.addEventListener('shown.bs.tab', draw);
  if (box.offsetParent !== null) draw();
  document.addEventListener('app-theme', function () { if (charts.length) draw(); });
}());
