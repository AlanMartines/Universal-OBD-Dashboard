/* Novo usuário: a conta só é pedida para o perfil Usuário. O servidor valida de qualquer forma. */
(function () {
  'use strict';

  var role = document.getElementById('new-role');
  var box = document.getElementById('new-account-box');
  var account = document.getElementById('new-account');
  if (!role || !box || !account) return;

  function sync() {
    var needed = role.value === 'user';
    box.hidden = !needed;
    account.disabled = !needed;
    account.required = needed;
  }
  role.addEventListener('change', sync);
  sync();
}());
