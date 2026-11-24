/*
 * Página Mapas: escolha da área em listas encadeadas (planeta ou continente → país → região ou estado),
 * tamanho e aviso antes de baixar, e acompanhamento do trabalho em andamento. Tudo montado com
 * createElement e textContent, sem montar HTML a partir de texto, por causa da política de segurança do painel.
 */
(function () {
  'use strict';

  var form = document.getElementById('mapas-form');
  var niveis = document.getElementById('mapas-niveis');
  var campoArea = document.getElementById('mapas-area');
  var tipo = document.getElementById('mapas-tipo');
  var botao = document.getElementById('mapas-baixar');
  var infoTamanho = document.getElementById('mapas-tamanho');
  var alerta = document.getElementById('mapas-alerta');
  var filhos = {};
  var porId = {};
  var ultimoTamanho = null;
  var GB = 1024 * 1024 * 1024;

  function nome(a) { return a.nome; }

  function opcao(valor, texto) {
    var o = document.createElement('option');
    o.value = valor;
    o.textContent = texto;
    return o;
  }

  // Rótulo de cada nível da área; os estados do Brasil ficam no quarto nível (abaixo da região)
  var ROTULOS = ['Continente', 'País', 'Região', 'Estado / UF'];

  function areaEscolhida() {
    var selects = niveis.querySelectorAll('select');
    for (var i = selects.length - 1; i >= 0; i -= 1) if (selects[i].value) return selects[i].value;
    return '';
  }

  function nivel(pai, profundidade) {
    var lista = (filhos[pai || ''] || []).slice().sort(function (a, b) { return nome(a).localeCompare(nome(b), 'pt-BR'); });
    if (!lista.length) return;
    var campo = document.createElement('div');
    campo.className = 'mapas-nivel';
    var rotulo = document.createElement('label');
    rotulo.className = 'form-label';
    rotulo.htmlFor = 'mapas-nivel-' + profundidade;
    rotulo.textContent = ROTULOS[profundidade] || 'Sub-região';
    var s = document.createElement('select');
    s.className = 'form-select';
    s.id = 'mapas-nivel-' + profundidade;
    // No primeiro nível é preciso escolher; abaixo, "Todos" fica com a área inteira do nível de cima
    s.appendChild(opcao('', profundidade === 0 ? 'Escolha…' : 'Todos'));
    lista.forEach(function (a) { s.appendChild(opcao(a.id, a.nome)); });
    s.addEventListener('change', function () {
      var campos = Array.prototype.slice.call(niveis.querySelectorAll('.mapas-nivel'));
      campos.slice(campos.indexOf(campo) + 1).forEach(function (el) { el.remove(); });
      if (s.value) nivel(s.value, profundidade + 1);
      escolher();
    });
    campo.append(rotulo, s);
    niveis.appendChild(campo);
  }

  function mostrarTamanho() {
    alerta.hidden = true;
    infoTamanho.textContent = '';
    var d = ultimoTamanho;
    if (!d || d.area !== campoArea.value) return;
    var grande = d.area === 'planeta' || (d.bytesPbf && d.bytesPbf > 3 * GB);
    if (tipo.value === 'encaixe') {
      if (!d.pbfTxt) infoTamanho.textContent = 'Não foi possível saber o tamanho desta área agora.';
      else if (d.recorte && d.estimado) {
        var medido = /^\d{4}-\d{2}-\d{2}$/.test(d.medidoEm || '') ? ' (parte do estado na região medida em ' + d.medidoEm.split('-').reverse().join('/') + ')' : '';
        infoTamanho.textContent = 'Download: ' + d.pbfTxt + ' (a região inteira; o estado, cerca de ' + d.estadoTxt + ', é recortado em seguida). Depois de pronto: cerca de ' + d.discoTxt + ' em disco e ' + d.memoriaTxt + ' de memória' + medido + '.';
      } else if (d.recorte) {
        infoTamanho.textContent = 'Download: ' + d.pbfTxt + ' (a região inteira; o estado é recortado em seguida). Depois de pronto, no máximo cerca de ' + d.discoTxt + ' em disco e ' + d.memoriaTxt + ' de memória (o da região).';
      } else {
        infoTamanho.textContent = 'Download: ' + d.pbfTxt + '. Depois de pronto: cerca de ' + d.discoTxt + ' em disco e ' + d.memoriaTxt + ' de memória.';
      }
    } else if (d.baseCalculando) {
      infoTamanho.textContent = 'Calculando o tamanho do mapa base desta área (em país ou continente leva até um minuto)…';
    } else if (d.baseTxt) {
      infoTamanho.textContent = 'Mapa base: cerca de ' + d.baseTxt + ' em disco' + (d.recorte ? ', recortado pelo contorno do estado.' : ', recortado no retângulo da área.');
    } else {
      infoTamanho.textContent = d.area === 'planeta'
        ? 'Mapa base do planeta inteiro: mais de 100 GB em disco.'
        : 'Não foi possível calcular o tamanho do mapa base agora; um estado costuma ocupar de dezenas a centenas de MB.';
    }
    if (grande) {
      alerta.hidden = false;
      alerta.textContent = d.area === 'planeta'
        ? 'Planeta inteiro: centenas de GB de disco e, no encaixe, de memória, e muitas horas de processamento. O ideal é baixar só as regiões onde os carros rodam.'
        : 'Área grande: confira o espaço em disco e a memória do servidor antes de baixar. Se possível, escolha uma região menor.';
    }
  }

  // O tamanho do mapa base de um país ou continente é simulado em segundo plano (10 s a 1 min): enquanto isso
  // a página mostra "calculando" e pergunta de novo a cada 5 s, se a área escolhida ainda for a mesma.
  function consultar(area, tentativa) {
    fetch('/admin/mapas/tamanho.json?area=' + encodeURIComponent(area), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (campoArea.value !== area) return;
        ultimoTamanho = d;
        mostrarTamanho();
        if (d && d.baseCalculando && tentativa < 24) setTimeout(function () { if (campoArea.value === area) consultar(area, tentativa + 1); }, 5000);
      })
      .catch(function () { if (campoArea.value === area) infoTamanho.textContent = ''; });
  }

  function escolher() {
    var area = areaEscolhida();
    campoArea.value = area;
    botao.disabled = !area;
    ultimoTamanho = null;
    mostrarTamanho();
    if (!area) return;
    var a = porId[area];
    form.dataset.confirm = 'Baixar ' + (tipo.value === 'base' ? 'o mapa base' : 'o encaixe nas ruas') + ' de "' + (a ? a.nome : area) + '"? Pode levar de minutos a horas, conforme o tamanho. O mapa atual segue funcionando até o novo ficar pronto.';
    infoTamanho.textContent = 'Consultando o tamanho…';
    consultar(area, 0);
  }

  if (form) {
    tipo.addEventListener('change', escolher);
    fetch('/admin/mapas/catalogo.json', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (d) {
        (d.areas || []).forEach(function (a) {
          porId[a.id] = a;
          var pai = a.pai || '';
          (filhos[pai] = filhos[pai] || []).push(a);
        });
        document.getElementById('mapas-carregando').remove();
        nivel('', 0);
      })
      .catch(function () {
        document.getElementById('mapas-carregando').textContent = 'Não foi possível carregar o catálogo de áreas agora. Tente recarregar a página.';
      });
  }

  // ---------- Trabalho em andamento ----------
  var cartao = document.getElementById('mapas-trabalho');
  if (!cartao) return;
  var badge = document.getElementById('mapas-trabalho-badge');
  var fase = document.getElementById('mapas-trabalho-fase');
  var barra = document.getElementById('mapas-trabalho-barra');
  var preenchimento = document.getElementById('mapas-trabalho-barra-fill');
  var erro = document.getElementById('mapas-trabalho-erro');
  var registro = document.getElementById('mapas-trabalho-registro');
  var andando = !cartao.hidden && badge.textContent.trim() === 'Em andamento';

  function atualizar() {
    fetch('/admin/mapas/estado.json', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var t = d && d.trabalho;
        if (!t) return;
        cartao.hidden = false;
        fase.textContent = t.fase;
        registro.textContent = (t.registro || []).join('\n');
        var pct = typeof t.progresso === 'number' ? Math.round(t.progresso * 100) : null;
        barra.hidden = pct === null;
        if (pct !== null) {
          barra.setAttribute('aria-valuenow', String(pct));
          preenchimento.style.width = pct + '%';
        }
        if (t.fim) {
          badge.textContent = t.erro ? 'Falhou' : 'Concluído';
          erro.hidden = !t.erro;
          erro.textContent = t.erro || '';
          window.setTimeout(function () { window.location.reload(); }, 1500);
          return;
        }
        window.setTimeout(atualizar, 3000);
      })
      .catch(function () { window.setTimeout(atualizar, 6000); });
  }
  if (andando) window.setTimeout(atualizar, 2000);
}());
