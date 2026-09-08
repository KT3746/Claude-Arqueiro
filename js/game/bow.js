/**
 * O arqueiro e o arco: mira, força e o desenho de tudo isso.
 *
 * Existem dois jeitos de mirar, e os dois mexem no mesmo estado:
 *  - arrastar (mouse/dedo) em qualquer ponto da tela, como um estilingue;
 *  - teclado (setas), para quem prefere precisão ou não usa apontador.
 */

import { launch, simulate } from './physics.js';

/**
 * Faixa de velocidade do disparo. Um arco real manda a flecha a ~60 m/s, mas
 * nessa velocidade a trajetória fica quase reta nas distâncias do jogo e a
 * mira perde a graça. A faixa abaixo mantém um arco visível e legível sem
 * transformar a flecha numa bola de canhão.
 */
export const MIN_SPEED = 16;
export const MAX_SPEED = 46;
export const MIN_ANGLE = -0.35;
export const MAX_ANGLE = 1.25;

/**
 * Distância de arrasto que corresponde à força máxima, em pixels de CSS.
 *
 * Era um valor fixo de 190 px medidos a partir do arco. Num celular isso
 * quase nunca cabia: a tela é estreita, o arco fica na esquerda, e o jogador
 * precisava puxar para fora da tela para chegar na força total. Agora a
 * distância acompanha o tamanho da tela — telas pequenas pedem um puxão
 * proporcionalmente menor — e o teto continua sendo 190 px no computador.
 */
const MAX_FULL_DRAW_PX = 190;
const MIN_FULL_DRAW_PX = 92;

/**
 * Folga inicial: os primeiros pixels do arrasto não valem força nem mudam a
 * mira. Sem ela, encostar o dedo já bagunçaria o ângulo (perto da âncora,
 * um tremidinho de 2 px gira a mira inteira), e não haveria como desistir do
 * tiro. Voltar o dedo para dentro dessa folga e soltar cancela o disparo.
 */
const DEAD_ZONE_PX = 12;

function fullDrawPx(camera) {
  if (!camera) return MAX_FULL_DRAW_PX;
  const menorLado = Math.min(camera.width, camera.height);
  return clamp(menorLado * 0.34, MIN_FULL_DRAW_PX, MAX_FULL_DRAW_PX);
}

export function createBow({ x = 0, y = 1.62 } = {}) {
  return {
    x,
    y,
    angle: 0.1,
    power: 0.5,
    dragging: false,
    /** Ponto da tela onde o arrasto começou — a âncora do "estilingue". */
    dragOrigin: null,
    /** Onde o dedo/mouse está agora, para desenhar a linha do puxão. */
    dragPointer: null,
    /** Distância de puxão que vale força máxima neste tamanho de tela. */
    dragFull: MAX_FULL_DRAW_PX,
    /** O arrasto já passou da folga inicial? Só então o tiro sai. */
    pulled: false,
    /** Tempo desde o disparo, usado para a animação de recuo do arco. */
    recoil: 0,

    get speed() {
      return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * this.power;
    },

    /** Ponta da flecha, de onde ela realmente sai. */
    get tip() {
      const reach = 0.55 - this.power * 0.35; // recuada quando o arco está armado
      return {
        x: this.x + Math.cos(this.angle) * reach,
        y: this.y + Math.sin(this.angle) * reach,
      };
    },

    /**
     * Começa o arrasto ancorado ONDE O DEDO TOCOU, não no arco.
     *
     * Antes a âncora era a posição do arco na tela: para armar o arco era
     * preciso tocar longe dele, atrás do arqueiro — justamente o canto onde
     * um celular não tem espaço, e onde a mão tapa o que se precisa ver.
     * Ancorando no toque, o jogador puxa a partir de qualquer lugar (de
     * preferência num canto vazio) e enxerga o arco e o alvo o tempo todo.
     */
    beginDrag(pointerScreen, camera) {
      this.dragging = true;
      this.pulled = false;
      this.dragFull = fullDrawPx(camera);
      this.dragOrigin = pointerScreen ? { x: pointerScreen.x, y: pointerScreen.y } : null;
      this.dragPointer = this.dragOrigin ? { ...this.dragOrigin } : null;
    },

    /**
     * Atualiza mira e força a partir da posição do ponteiro na tela.
     * Puxar para trás/baixo do arco mira para frente/cima — como um arco de verdade.
     */
    updateDrag(pointerScreen, camera) {
      const anchor = this.dragOrigin ?? camera.toScreen(this.x, this.y);
      this.dragPointer = { x: pointerScreen.x, y: pointerScreen.y };
      const dx = anchor.x - pointerScreen.x;
      const dy = anchor.y - pointerScreen.y;
      const distance = Math.hypot(dx, dy);

      if (distance < DEAD_ZONE_PX) {
        // Ainda dentro da folga: mantém a mira anterior e desarma o tiro.
        this.pulled = false;
        return;
      }

      const curso = Math.max(1, this.dragFull - DEAD_ZONE_PX);
      this.angle = clamp(Math.atan2(-dy, dx), MIN_ANGLE, MAX_ANGLE);
      this.power = clamp((distance - DEAD_ZONE_PX) / curso, 0.05, 1);
      this.pulled = true;
    },

    endDrag() {
      this.dragging = false;
      this.dragOrigin = null;
      this.dragPointer = null;
      this.pulled = false;
    },

    /** Ajuste fino pelo teclado. */
    adjust({ angle = 0, power = 0 }) {
      this.angle = clamp(this.angle + angle, MIN_ANGLE, MAX_ANGLE);
      this.power = clamp(this.power + power, 0.05, 1);
    },

    /** Estado inicial da flecha para este tiro. */
    shot() {
      const tip = this.tip;
      this.recoil = 0.25;
      return launch(tip.x, tip.y, this.angle, this.speed);
    },

    update(dt) {
      this.recoil = Math.max(0, this.recoil - dt);
    },

    /**
     * Trajetória prevista (linha pontilhada da mira).
     * Só é chamada quando o nível permite a ajuda visual.
     */
    preview(env, opts = {}) {
      const { points } = simulate(this.shotPreviewState(), env, {
        dt: 1 / 60,
        maxTime: opts.maxTime ?? 1.4,
        maxX: opts.maxX ?? Infinity,
      });
      return points;
    },

    shotPreviewState() {
      const tip = this.tip;
      return launch(tip.x, tip.y, this.angle, this.speed);
    },

    draw(ctx, camera, { showString = true } = {}) {
      drawArcher(ctx, camera, this);
      if (showString) drawBow(ctx, camera, this);
    },

    /**
     * Desenha o "estilingue" sob o dedo: a âncora do arrasto, o anel da força
     * máxima e a linha do puxão. Como a âncora agora é um ponto qualquer da
     * tela, ela é invisível por natureza — sem esse desenho o jogador não
     * teria como saber de onde está puxando nem o quanto falta para a força
     * total.
     */
    drawDragGuide(ctx) {
      if (!this.dragging || !this.dragOrigin || !this.dragPointer) return;
      const o = this.dragOrigin;
      const p = this.dragPointer;

      ctx.save();
      ctx.lineCap = 'round';

      // Anel da força máxima: puxar até ele já é o puxão mais forte possível.
      // Bem apagado de propósito — a linha pontilhada da trajetória é branca
      // também, e um anel forte demais se confundia com ela.
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 8]);
      ctx.beginPath();
      ctx.arc(o.x, o.y, this.dragFull, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Linha do puxão, do ponto de origem até o dedo.
      ctx.strokeStyle = this.pulled ? dragColor(this.power) : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      // Âncora: cheia enquanto o tiro está armado, vazada quando voltar para
      // a folga (aviso visual de que soltar ali NÃO dispara).
      ctx.beginPath();
      ctx.arc(o.x, o.y, 7, 0, Math.PI * 2);
      if (this.pulled) {
        ctx.fillStyle = dragColor(this.power);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Seta curta na origem mostrando para onde a flecha vai sair.
      if (this.pulled) {
        const len = 26;
        const ax = o.x + Math.cos(this.angle) * len;
        const ay = o.y - Math.sin(this.angle) * len;
        ctx.strokeStyle = dragColor(this.power);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(ax, ay);
        ctx.stroke();
      }

      ctx.restore();
    },
  };
}

function dragColor(power) {
  if (power > 0.85) return '#e2453c';
  if (power > 0.55) return '#f5d23b';
  return '#7ee081';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawArcher(ctx, camera, bow) {
  const scale = camera.scale;
  const feet = camera.toScreen(bow.x - 0.15, 0);
  const hip = camera.toScreen(bow.x - 0.15, 0.95);
  const shoulder = camera.toScreen(bow.x - 0.1, 1.55);
  const head = camera.toScreen(bow.x - 0.08, 1.78);
  const lw = Math.max(2, 0.075 * scale);

  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2f3b4a';
  ctx.lineWidth = lw;

  // Pernas afastadas, postura de tiro.
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(feet.x - 0.28 * scale, feet.y);
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(feet.x + 0.3 * scale, feet.y);
  ctx.stroke();

  // Tronco.
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(shoulder.x, shoulder.y);
  ctx.stroke();

  // Cabeça.
  ctx.fillStyle = '#e8b98c';
  ctx.beginPath();
  ctx.arc(head.x, head.y - 0.06 * scale, 0.17 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Braço do arco (esticado) e braço da corda (dobrado conforme a força).
  const grip = camera.toScreen(bow.x, bow.y);
  ctx.strokeStyle = '#3c4b5e';
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(grip.x, grip.y);
  ctx.stroke();

  const pull = bow.power * 0.5 + (bow.recoil > 0 ? -0.2 : 0);
  const nock = camera.toScreen(
    bow.x - Math.cos(bow.angle) * pull,
    bow.y - Math.sin(bow.angle) * pull,
  );
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(shoulder.x + 0.1 * scale, shoulder.y + 0.22 * scale);
  ctx.lineTo(nock.x, nock.y);
  ctx.stroke();
}

function drawBow(ctx, camera, bow) {
  const scale = camera.scale;
  const grip = camera.toScreen(bow.x, bow.y);
  const limb = 0.62 * scale;
  const perpendicular = bow.angle + Math.PI / 2;

  const upper = {
    x: grip.x + Math.cos(perpendicular) * limb,
    y: grip.y - Math.sin(perpendicular) * limb,
  };
  const lower = {
    x: grip.x - Math.cos(perpendicular) * limb,
    y: grip.y + Math.sin(perpendicular) * limb,
  };
  // Ponto de controle à frente do punho: é ele que dá a barriga curva do arco.
  const belly = {
    x: grip.x + Math.cos(bow.angle) * 0.42 * scale,
    y: grip.y - Math.sin(bow.angle) * 0.42 * scale,
  };

  // Braços do arco.
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = Math.max(2, 0.06 * scale);
  ctx.beginPath();
  ctx.moveTo(upper.x, upper.y);
  ctx.quadraticCurveTo(belly.x, belly.y, lower.x, lower.y);
  ctx.stroke();

  // Corda: puxada para trás na direção oposta à mira.
  const pull = (bow.recoil > 0 ? -0.12 : bow.power * 0.5) * scale;
  const nock = {
    x: grip.x - Math.cos(bow.angle) * pull,
    y: grip.y + Math.sin(bow.angle) * pull,
  };
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1, 0.015 * scale);
  ctx.beginPath();
  ctx.moveTo(upper.x, upper.y);
  ctx.lineTo(nock.x, nock.y);
  ctx.lineTo(lower.x, lower.y);
  ctx.stroke();

  // Flecha encaixada, enquanto ainda não foi disparada.
  if (bow.recoil <= 0) {
    ctx.strokeStyle = '#d9b04a';
    ctx.lineWidth = Math.max(1.5, 0.025 * scale);
    ctx.beginPath();
    ctx.moveTo(nock.x, nock.y);
    ctx.lineTo(
      nock.x + Math.cos(bow.angle) * 0.95 * scale,
      nock.y - Math.sin(bow.angle) * 0.95 * scale,
    );
    ctx.stroke();
  }
}
