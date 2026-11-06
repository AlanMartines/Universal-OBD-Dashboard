/*
 * Gráficos com a cara do painel: fonte, cores do texto, grade e dicas tiradas dos tokens do tema
 * (claro ou escuro). Carregado logo depois do Chart.js; os gráficos são redesenhados ao trocar o tema.
 */
(function () {
  'use strict';
  var Chart = window.Chart;
  if (!Chart) return;

  function css(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function apply() {
    var d = Chart.defaults;
    d.font.family = getComputedStyle(document.body).fontFamily;
    d.font.size = 12;
    d.color = css('--bs-secondary-color', '#6c757d');
    d.borderColor = css('--bs-border-color', 'rgba(0,0,0,.1)');
    d.plugins.legend.labels.usePointStyle = true;
    var tip = d.plugins.tooltip;
    tip.backgroundColor = css('--app-card-bg', '#fff');
    tip.titleColor = css('--bs-body-color', '#212529');
    tip.bodyColor = css('--bs-body-color', '#212529');
    tip.borderColor = css('--bs-border-color', 'rgba(0,0,0,.1)');
    tip.borderWidth = 1;
    tip.padding = 10;
    tip.cornerRadius = 10;
    tip.boxPadding = 4;
    d.elements.line.tension = 0.3;
    d.elements.line.borderWidth = 2;
    d.elements.point.radius = 0;
    d.elements.point.hoverRadius = 4;
    d.elements.bar.borderRadius = 6;
  }
  apply();
  document.addEventListener('app-theme', function () {
    apply();
    Object.values(Chart.instances || {}).forEach(function (c) { c.update('none'); });
  });
  window.chartTheme = { css: css };
}());
