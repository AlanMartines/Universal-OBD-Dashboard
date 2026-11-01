/* Validação no navegador, para avisar antes do envio. O servidor continua validando tudo. */
(function ($) {
  'use strict';

  $.extend($.validator.messages, {
    required: 'Campo obrigatório.',
    email: 'Informe um e-mail válido.',
    equalTo: 'Os dois campos não conferem.',
    minlength: $.validator.format('Use pelo menos {0} caracteres.'),
    maxlength: $.validator.format('Use no máximo {0} caracteres.'),
  });

  function tooRepetitive(value) {
    return new Set(value.toLowerCase()).size < 5;
  }

  $.validator.addMethod('username', function (value, element) {
    return this.optional(element) || /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value.trim().toLowerCase());
  }, 'Use de 3 a 32 caracteres: letras, números, ponto, _ ou -.');

  $.validator.addMethod('strongpassword', function (value, element) {
    return this.optional(element) || (Array.from(value).length >= 15 && !tooRepetitive(value));
  }, 'Use pelo menos 15 caracteres, sem repetir sempre os mesmos.');

  $.validator.addMethod('notusername', function (value, element, source) {
    var username = String($(source).val() || $(source).text() || '').trim().toLowerCase();
    return this.optional(element) || !username || !value.toLowerCase().includes(username);
  }, 'A senha não pode conter o nome do usuário.');

  $('form[data-validate]').each(function () {
    var form = $(this);
    var validator = form.validate({
      errorElement: 'div',
      errorClass: 'invalid-feedback d-block',
      highlight: function (element) { $(element).addClass('is-invalid'); },
      unhighlight: function (element) { $(element).removeClass('is-invalid'); },
      errorPlacement: function (error, element) {
        var group = element.closest('.input-group');
        error.insertAfter(group.length ? group : element);
      },
    });
    // Colar ou usar o preenchimento automático não gera tecla. Sem isso, a mensagem só some ao
    // sair do campo, o botão muda de lugar nesse instante e o clique cai fora dele.
    form.on('input change', 'input', function () {
      if (this.classList.contains('is-invalid')) validator.element(this);
    });
  });

  // ---------- Força da senha ----------

  var LEVELS = [
    { max: 39, label: 'Fraca', bar: 'text-bg-danger' },
    { max: 59, label: 'Razoável', bar: 'text-bg-warning' },
    { max: 84, label: 'Boa', bar: 'text-bg-info' },
    { max: 100, label: 'Forte', bar: 'text-bg-success' },
  ];

  function evaluate(value) {
    var length = Array.from(value).length;
    var rules = {
      length: length >= 15,
      varied: value.length > 0 && !tooRepetitive(value),
      long: length >= 20,
      mixed: /[a-z]/.test(value) && /[A-Z]/.test(value),
      digit: /[0-9]/.test(value),
      symbol: /[^A-Za-z0-9]/.test(value),
    };
    var score = Math.min(length, 15) * 3;
    ['long', 'mixed', 'digit', 'symbol'].forEach(function (name) {
      if (rules[name]) score += 14;
    });
    // Sem os dois requisitos obrigatórios, nunca passa de "Fraca".
    if (!rules.length || !rules.varied) score = Math.min(score, 39);
    return { rules: rules, score: Math.min(score, 100) };
  }

  $('[data-password-meter]').each(function () {
    var meter = $(this);
    var input = $('#' + meter.attr('data-password-meter'));
    var bar = meter.find('[data-meter-bar]');
    var progress = meter.find('.progress');
    var label = meter.find('[data-meter-label]');

    input.on('input', function () {
      var value = input.val();
      meter.prop('hidden', value.length === 0);
      var result = evaluate(value);
      var level = LEVELS.find(function (l) { return result.score <= l.max; });
      bar.css('width', result.score + '%').removeClass('text-bg-danger text-bg-warning text-bg-info text-bg-success').addClass(level.bar);
      progress.attr('aria-valuenow', result.score);
      label.text('Força da senha: ' + level.label);
      Object.keys(result.rules).forEach(function (name) {
        var item = meter.find('[data-rule="' + name + '"]');
        item.toggleClass('rule-ok', result.rules[name]);
        item.find('i').toggleClass('fa-circle fa-2xs', !result.rules[name]).toggleClass('fa-circle-check', result.rules[name]);
      });
    });
  });
}(window.jQuery));
