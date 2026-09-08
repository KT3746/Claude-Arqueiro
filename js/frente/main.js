/**
 * Ponto de entrada: liga canvas, entrada, loop, partida e telas.
 *
 * Port adaptado de `js/minhocas/main.js` (jogo Minhocas, repositório
 * `Claude`). A diferença grande em relação ao original: aqui só existem
 * duas equipes (você e a IA), e o celular ganhou uma barra de controles de
 * verdade — o jogo original só tinha teclado para andar, pular e trocar de
 * arma; no toque só dava para carregar e soltar o tiro.
 */

import { createLoop } from '../engine/loop.js';
import { createInput } from '../engine/input.js';
import { createCamera } from '../engine/camera.js';
import { createParticles } from '../engine/particles.js';
import { save } from '../engine/storage.js';
import { sfx } from '../engine/audio.js';
import { hashSeed, randomSeed } from '../engine/rng.js';

import { createMatch } from './match.js';
import { DT_FISICA } from './ballistics.js';
import { desenharHud, desenharDica } from './ui/hud.js';
import { createScreens } from './ui/screens.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = document.getElementById('ui');
const pauseButton = document.getElementById('pause-button');
const battleControls = document.getElementById('battle-controls');
const armaNomeEl = document.getElementById('bc-weapon-name');

const camera = createCamera();
const particles = createParticles();
const input = createInput(canvas);

const estado = {
  modo: 'menu', // 'menu' | 'jogando' | 'pausado' | 'fim'
  partida: null,
  ultimaConfig: null,
  motion: true,
};

save.load();
sfx.setEnabled(save.settings.sound);
estado.motion = save.settings.motion !== false;
camera.shakeEnabled = estado.motion;

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
if (reducedMotion?.matches) definirMotion(false);

/** Toque grosseiro (dedo, não mouse fino): é quando a barra de botões aparece. */
const TOQUE = window.matchMedia?.('(pointer: coarse)').matches ?? false;

const screens = createScreens(ui, {
  jogar: (config) => iniciarPartida(config),
  repetir: () => iniciarPartida(estado.ultimaConfig),
  resume: () => retomar(),
  toMenu: () => aoMenu(),
  setMotion: definirMotion,
});

function definirMotion(ligado) {
  estado.motion = ligado;
  camera.shakeEnabled = ligado;
}

/** Botões que só fazem sentido com uma partida em andamento. */
function mostrarControlesDeJogo(visivel) {
  pauseButton.hidden = !visivel;
  battleControls.hidden = !visivel || !TOQUE;
}

// ------------------------------------------------------------------ tamanho

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  camera.resize(width, height);
}

window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ fluxo de jogo

function iniciarPartida(config) {
  const semente = config.semente ? hashSeed(config.semente) : randomSeed();
  estado.ultimaConfig = { ...config };

  // A geração do mapa leva algumas centenas de milissegundos: mostra a tela
  // de espera e só então trava a thread, senão o clique parece não responder.
  screens.carregando();
  pauseButton.hidden = true;
  battleControls.hidden = true;

  requestAnimationFrame(() => setTimeout(() => {
    particles.clear();
    estado.partida = createMatch({
      semente,
      equipes: [
        { nome: 'Sua unidade', soldados: config.soldados },
        { nome: 'Inimigo', soldados: config.soldados, ia: { dificuldade: config.dificuldade } },
      ],
      camera,
      particles,
      motionEnabled: estado.motion,
      tempoTurno: config.tempoTurno,
    });
    estado.modo = 'jogando';
    screens.hide();
    mostrarControlesDeJogo(true);
  }, 0));
}

function pausar() {
  if (estado.modo !== 'jogando') return;
  estado.modo = 'pausado';
  mostrarControlesDeJogo(false);
  screens.pause();
}

function retomar() {
  if (estado.modo !== 'pausado') return;
  estado.modo = 'jogando';
  mostrarControlesDeJogo(true);
  screens.hide();
}

function aoMenu() {
  estado.modo = 'menu';
  estado.partida = null;
  particles.clear();
  camera.setBounds(null);
  mostrarControlesDeJogo(false);
  screens.menu();
}

function terminar() {
  const partida = estado.partida;
  estado.modo = 'fim';
  mostrarControlesDeJogo(false);
  sfx.fanfare();
  screens.fim({
    vencedor: partida.estado.vencedor,
    semente: partida.estado.semente,
    times: partida.times,
    turnos: partida.turnos.turno,
  });
}

pauseButton.addEventListener('click', () => {
  sfx.click();
  pausar();
});

// --------------------------------------------------- barra de controles

/**
 * Botões de "segurar" (andar, mirar): ficam num Set enquanto o dedo está em
 * cima, e são lidos a cada quadro em `comandosContinuos`, do mesmo jeito que
 * `input.isDown('ArrowLeft')` funciona para o teclado.
 */
const segurando = new Set();

function ligarBotaoDeSegurar(botao) {
  const acao = botao.dataset.hold;
  const pressionar = (event) => {
    event.preventDefault();
    segurando.add(acao);
    botao.classList.add('pressionado');
  };
  const soltar = () => {
    segurando.delete(acao);
    botao.classList.remove('pressionado');
  };
  botao.addEventListener('pointerdown', pressionar);
  botao.addEventListener('pointerup', soltar);
  botao.addEventListener('pointercancel', soltar);
  botao.addEventListener('pointerleave', soltar);
}

function ligarBotaoDeToque(botao, aoTocar) {
  botao.addEventListener('click', (event) => {
    event.preventDefault();
    aoTocar();
  });
}

for (const botao of battleControls.querySelectorAll('button[data-hold]')) {
  ligarBotaoDeSegurar(botao);
}

battleControls.querySelector('[data-tap="pular"]')?.addEventListener('click', () => {
  if (!emTurnoHumano()) return;
  estado.partida?.comandos.pular('frente');
});
battleControls.querySelector('[data-tap="arma-anterior"]')?.addEventListener('click', () => {
  if (!emTurnoHumano()) return;
  estado.partida?.comandos.trocarArmaRelativa(-1);
});
battleControls.querySelector('[data-tap="arma-seguinte"]')?.addEventListener('click', () => {
  if (!emTurnoHumano()) return;
  estado.partida?.comandos.trocarArmaRelativa(1);
});

const botaoFogo = document.getElementById('bc-fire');
botaoFogo.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  botaoFogo.classList.add('pressionado');
  if (emTurnoHumano()) estado.partida?.comandos.carregar();
});
function soltarFogo() {
  botaoFogo.classList.remove('pressionado');
  if (emTurnoHumano()) estado.partida?.comandos.disparar();
}
botaoFogo.addEventListener('pointerup', soltarFogo);
botaoFogo.addEventListener('pointercancel', soltarFogo);

// --------------------------------------------------------------- entrada

/** É a vez de um time controlado por gente (e não pela IA)? */
function emTurnoHumano() {
  const partida = estado.partida;
  if (!partida) return false;
  const time = partida.times[partida.estado.equipeDaVez];
  return !!time && !time.ia;
}

function comandosContinuos(dt) {
  const partida = estado.partida;
  if (!partida || !emTurnoHumano()) return;
  const { comandos } = partida;

  if (input.isDown('ArrowLeft') || input.isDown('KeyA') || segurando.has('esquerda')) comandos.andar(-1, dt);
  if (input.isDown('ArrowRight') || input.isDown('KeyD') || segurando.has('direita')) comandos.andar(1, dt);

  const fino = input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? 0.25 : 1;
  if (input.isDown('ArrowUp') || input.isDown('KeyW') || segurando.has('mira-cima')) comandos.mirar(1.5 * dt * fino);
  if (input.isDown('ArrowDown') || input.isDown('KeyS') || segurando.has('mira-baixo')) comandos.mirar(-1.5 * dt * fino);
}

function comandosDiscretos() {
  if (estado.modo === 'jogando' && input.wasPressed('KeyP')) return pausar();
  if (estado.modo === 'pausado' && input.wasPressed('KeyP')) return retomar();
  if (estado.modo !== 'jogando' || !estado.partida || !emTurnoHumano()) return;

  const { comandos, estado: jogo } = estado.partida;

  if (input.wasPressed('Enter')) comandos.pular('frente');
  if (input.wasPressed('Backspace')) comandos.pular('costas');

  // `[` `]` percorrem o arsenal inteiro; os dígitos, com uma arma de pavio
  // ajustável na mão (granada, fragmentação), mudam quantos segundos faltam.
  if (input.wasPressed('BracketLeft')) comandos.trocarArmaRelativa(-1);
  if (input.wasPressed('BracketRight')) comandos.trocarArmaRelativa(1);
  if (jogo.arma.ajustavel) {
    for (let n = 1; n <= 5; n += 1) {
      if (input.wasPressed(`Digit${n}`)) comandos.ajustarPavio(n);
    }
  }

  // Espaço e toque no CAMPO (fora dos botões) carregam a força; soltar dispara.
  // O botão FOGO dedicado faz o mesmo por baixo do dedo — os dois convivem.
  if (input.wasPressed('Space')) comandos.carregar();
  if (!input.isDown('Space') && jogo.carregando) comandos.disparar();

  if (input.pointer.justPressed) comandos.carregar();
  if (input.pointer.justReleased) comandos.disparar();
}

// ------------------------------------------------------------------- loop

const loop = createLoop({
  dt: DT_FISICA,

  beginFrame() {
    comandosDiscretos();
  },

  step(dt) {
    if (estado.modo !== 'jogando' || !estado.partida) {
      camera.update(dt);
      return;
    }
    comandosContinuos(dt);
    estado.partida.update(dt);
    if (estado.partida.fimDeJogo) terminar();
  },

  render() {
    if (estado.partida) {
      estado.partida.desenhar(ctx);
      if (estado.modo === 'jogando' || estado.modo === 'pausado') {
        desenharHud(ctx, estado.partida, camera);
        if (estado.modo === 'jogando') desenharDica(ctx, estado.partida, camera);
      }
      if (!battleControls.hidden) armaNomeEl.textContent = estado.partida.estado.arma.nome;
    } else {
      desenharFundoDoMenu();
    }
  },

  endFrame() {
    input.endFrame();
  },
});

/** Fundo tranquilo por trás do menu: colinas ao entardecer. */
let tempoFundo = 0;
function desenharFundoDoMenu() {
  tempoFundo += 1 / 60;
  const g = ctx.createLinearGradient(0, 0, 0, camera.height);
  g.addColorStop(0, '#1d3324');
  g.addColorStop(0.55, '#3f5a3a');
  g.addColorStop(1, '#8a9a5b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, camera.width, camera.height);

  const base = camera.height * 0.78;
  ctx.fillStyle = '#2c3b26';
  ctx.beginPath();
  ctx.moveTo(0, camera.height);
  ctx.lineTo(0, base);
  for (let x = 0; x <= camera.width; x += 10) {
    const y = base
      - Math.sin(x * 0.006 + 1.2) * camera.height * 0.07
      - Math.sin(x * 0.017) * camera.height * 0.03;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(camera.width, camera.height);
  ctx.closePath();
  ctx.fill();
}

// Gancho de depuração: dirigir o jogo pelo console sem tocar na arquitetura.
window.__frente = { estado, camera, iniciarPartida, aoMenu, pausar, retomar };

loop.start();
aoMenu();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    loop.stop();
    if (estado.modo === 'jogando') pausar();
  } else {
    loop.start();
  }
});
