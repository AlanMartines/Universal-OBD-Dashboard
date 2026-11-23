/* Ficha para a oficina: o botão abre a impressão do navegador (dá para salvar em PDF por ela). */
(function () {
  'use strict';
  var button = document.getElementById('ficha-imprimir');
  if (button) button.addEventListener('click', function () { window.print(); });
}());
