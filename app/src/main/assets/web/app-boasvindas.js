'use strict';
/* Roteiro de primeiro uso: abre sozinho só na primeira vez e se ainda não há viagem gravada (quem atualiza o app
 * não vê). Cada passo leva ao ajuste certo; dá para rever em Ajustes → Pronto para viajar. */
const WELCOME_KEY = 'app.primeiroUso';
let welcomeStep = 0;
const welcomeSteps = () => Array.from(document.querySelectorAll('#welcome-dialog .welcome-step'));

function showWelcomeStep(n) {
  const steps = welcomeSteps();
  welcomeStep = Math.max(0, Math.min(steps.length - 1, n));
  steps.forEach((s, i) => { s.hidden = i !== welcomeStep; });
  $('welcome-count').textContent = welcomeStep === 0 ? '' : `Passo ${welcomeStep} de ${steps.length - 2}`;
  if (welcomeStep === steps.length - 1) $('welcome-count').textContent = 'Tudo certo';
  $('welcome-back').hidden = welcomeStep === 0;
  $('welcome-next').textContent = welcomeStep === 0 ? 'Começar' : welcomeStep === steps.length - 1 ? 'Concluir' : 'Próximo';
  // A escuta CAN só existe nos perfis que a têm: sem ela, o botão some
  $('welcome-can').hidden = $('can-card').hidden;
}

function closeWelcome() {
  try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) { /* vale até fechar o app */ }
  if ($('welcome-dialog').open) $('welcome-dialog').close();
}

function openWelcome() {
  showWelcomeStep(0);
  if (!$('welcome-dialog').open) $('welcome-dialog').showModal();
}

$('welcome-next').addEventListener('click', () => {
  if (welcomeStep >= welcomeSteps().length - 1) closeWelcome(); else showWelcomeStep(welcomeStep + 1);
});
$('welcome-back').addEventListener('click', () => showWelcomeStep(welcomeStep - 1));
$('welcome-skip').addEventListener('click', closeWelcome);
$('welcome-dialog').addEventListener('cancel', () => { try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) { /* idem */ } });
$('welcome-open').addEventListener('click', openWelcome);
// "Ir ao ajuste": fecha o roteiro, abre os Ajustes e rola até o cartão ou campo
document.querySelectorAll('[data-welcome-go]').forEach((b) => {
  b.addEventListener('click', () => {
    closeWelcome();
    const settings = document.querySelector('.tab[data-tab="settings"]');
    if (settings) settings.click();
    const smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setTimeout(() => {
      const alvo = document.getElementById(b.dataset.welcomeGo);
      if (alvo) alvo.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    }, 200);
  });
});

function maybeWelcome() {
  let visto = false;
  try { visto = localStorage.getItem(WELCOME_KEY) === '1'; } catch (e) { visto = true; }
  if (visto) return;
  nativeAsync((id) => bridge.getTrips(id, 1)).then((texto) => {
    if (parse(texto, []).length) closeWelcome(); else openWelcome();
  }).catch(() => { /* sem resposta: tenta de novo na próxima abertura */ });
}
