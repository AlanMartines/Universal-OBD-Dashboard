/* Aba Relatórios: gráfico de km/l por tanque. Os dados vêm no atributo data-report (sem script embutido). */
(function () {
  'use strict';

  var canvas = document.getElementById('report-chart');
  if (!canvas || !window.Chart) return;
  var data;
  try { data = JSON.parse(canvas.dataset.report); } catch (e) { return; }
  var chart = null;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function draw() {
    if (chart) chart.destroy();
    var brand = css('--app-brand') || '#128a49';
    var muted = css('--bs-secondary-color') || '#6c757d';
    var grid = css('--bs-border-color') || 'rgba(0,0,0,.1)';
    var ethanol = css('--bs-warning') || '#ffc107';
    chart = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [
          {
            label: 'km/l',
            data: data.kmPerL,
            backgroundColor: data.fuel.map(function (f) { return f === 'ethanol' ? ethanol : brand; }),
            borderRadius: 6,
            maxBarThickness: 48,
          },
        ].concat(data.avg ? [{
          type: 'line',
          label: 'Média',
          data: data.labels.map(function () { return data.avg; }),
          borderColor: muted,
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
        }] : []),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : undefined,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + c.parsed.y.toLocaleString('pt-BR') + ' km/l'; } } },
        },
        scales: {
          x: { ticks: { color: muted }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: muted }, grid: { color: grid }, title: { display: true, text: 'km/l', color: muted } },
        },
      },
    });
  }

  // O gráfico só tem tamanho quando a aba aparece; e acompanha o tema.
  var tab = document.querySelector('[data-bs-target="#pane-reports"]');
  if (tab) tab.addEventListener('shown.bs.tab', draw);
  document.addEventListener('app-theme', function () { if (chart) draw(); });
  if (canvas.offsetParent !== null) draw();
}());
