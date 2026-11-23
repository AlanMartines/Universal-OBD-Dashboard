/* Novo usuário: a conta só é pedida para o perfil Usuário (Super Admin); os veículos e o prazo, só para o
 * Mecânico (dono da conta). O servidor valida de qualquer forma. */
(function () {
  'use strict';

  var role = document.getElementById('new-role');
  if (!role) return;
  var box = document.getElementById('new-account-box');
  var account = document.getElementById('new-account');
  var mechanic = document.getElementById('new-mechanic-box');

  function sync() {
    if (box && account) {
      var needed = role.value === 'user';
      box.hidden = !needed;
      account.disabled = !needed;
      account.required = needed;
    }
    if (mechanic) {
      var isMechanic = role.value === 'mechanic';
      mechanic.hidden = !isMechanic;
      mechanic.querySelectorAll('input, select').forEach(function (el) { el.disabled = !isMechanic; });
    }
  }
  role.addEventListener('change', sync);
  sync();
}());
