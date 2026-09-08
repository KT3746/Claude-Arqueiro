/**
 * IA do oponente — funções puras, sem DOM.
 *
 * Ela não lê nenhum atalho do estado do jogo: recebe a mesma informação que
 * um jogador tem (de onde atira, onde está o alvo, o vento, e uma função
 * `solido(x, y)` para testar o terreno) e devolve só a DECISÃO — em que
 * ângulo, com que força, com que arma atirar. Quem executa essa decisão
 * quadro a quadro, apertando os mesmos "botões" (`comandos`) que um jogador
 * apertaria, é o condutor em `match.js` — a IA nunca dispara nada sozinha.
 *
 * A solução do tiro é uma busca em duas fases sobre a MESMA física do jogo
 * (`avancar`, de `ballistics.js`): uma varredura grossa de ângulo × força,
 * depois um refinamento local em rodadas cada vez mais finas. Como a busca
 * já simula contra o terreno de verdade, uma colina no caminho reprova
 * sozinha os tiros retos que bateriam nela — não precisa de nenhuma regra
 * escrita à mão de "se estiver bloqueado, use o morteiro": a arma que
 * consegue chegar perto do alvo é a que a busca escolhe.
 *
 * A dificuldade não deixa a busca pior — ela erra pontaria DEPOIS de achar a
 * melhor solução, somando um desvio angular aleatório. É a mesma ideia do
 * tiro ao vivo: até um atirador ruim mira no alvo, só que a mão treme mais.
 */

import { avancar } from './ballistics.js';

const GRAVIDADE = 9.81;
const ARRASTO = 0.0016;

/** Desvio angular somado à melhor solução encontrada, por dificuldade. */
export const ERRO_ANGULO = {
  facil: (4 * Math.PI) / 180,
  medio: (1.2 * Math.PI) / 180,
  dificil: (0.15 * Math.PI) / 180,
};

const ANGULO_MIN = 0.03;
const ANGULO_MAX = Math.PI / 2 - 0.03;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Simula uma queda livre (com colisão contra o terreno) até o primeiro
 * impacto, ou até o tempo máximo — usa uma integração mais grossa que a do
 * jogo (o passo fino de `PHYSICS_DT` não faz falta para uma busca, só custa
 * tempo de CPU) porque é chamada dezenas de vezes por decisão.
 */
export function simularQueda(estadoInicial, env, solido, { dt = 1 / 45, tempoMax = 6 } = {}) {
  let estado = estadoInicial;
  let tempo = 0;
  while (tempo < tempoMax) {
    const r = avancar(estado, dt, env, solido);
    estado = r.estado;
    tempo += dt;
    if (r.impacto) return { x: r.impacto.x, y: r.impacto.y, tempo, bateu: true };
  }
  return { x: estado.x, y: estado.y, tempo, bateu: false };
}

/** Estado inicial do projétil para um ângulo/força/arma dados. */
function tiroInicial(atirador, direcao, angulo, forca, arma) {
  const velocidade = arma.velocidadeMax * forca;
  return {
    x: atirador.x + Math.cos(angulo) * direcao * 0.75,
    y: atirador.y + 0.85,
    vx: Math.cos(angulo) * direcao * velocidade,
    vy: Math.sin(angulo) * velocidade,
  };
}

/**
 * Busca o melhor par (ângulo, força) para uma arma específica, contra um
 * alvo e um terreno dados. Devolve a distância de pouso ao alvo, para quem
 * chama comparar entre armas diferentes.
 */
export function buscarTiro({ atirador, alvo, arma, vento = 0, solido }) {
  const direcao = alvo.x >= atirador.x ? 1 : -1;
  const env = { gravidade: GRAVIDADE, arrasto: ARRASTO, vento: arma.vento ? vento : 0 };

  function avaliar(angulo, forca) {
    const pouso = simularQueda(tiroInicial(atirador, direcao, angulo, forca, arma), env, solido);
    return { angulo, forca, distancia: Math.hypot(pouso.x - alvo.x, pouso.y - alvo.y) };
  }

  // Fase 1: varredura grossa — 12 ângulos × 8 forças.
  let melhor = null;
  for (let graus = 6; graus <= 85; graus += 7) {
    for (let forca = 0.3; forca <= 1.001; forca += 0.1) {
      const r = avaliar((graus * Math.PI) / 180, Math.min(1, forca));
      if (!melhor || r.distancia < melhor.distancia) melhor = r;
    }
  }

  // Fase 2: refinamento local, com o passo encolhendo a cada rodada —
  // é a bisseção do plano original, simplificada para uma grade 3×3 em
  // volta do melhor ponto conhecido.
  let passoAngulo = (7 * Math.PI) / 180;
  let passoForca = 0.1;
  for (let rodada = 0; rodada < 4; rodada += 1) {
    passoAngulo /= 2.4;
    passoForca /= 2.4;
    for (const dAng of [-passoAngulo, 0, passoAngulo]) {
      for (const dForca of [-passoForca, 0, passoForca]) {
        if (dAng === 0 && dForca === 0) continue;
        const angulo = clamp(melhor.angulo + dAng, ANGULO_MIN, ANGULO_MAX);
        const forca = clamp(melhor.forca + dForca, 0.05, 1);
        const r = avaliar(angulo, forca);
        if (r.distancia < melhor.distancia) melhor = r;
      }
    }
  }

  return { direcao, angulo: melhor.angulo, forca: melhor.forca, distancia: melhor.distancia };
}

/**
 * Escolhe a melhor arma entre as candidatas para esta situação (a que chega
 * mais perto do alvo) e devolve a decisão completa, já com o erro da
 * dificuldade somado ao ângulo.
 *
 * @param {Array<object>} armas candidatas (normalmente as arqueáveis: bazuca, morteiro, granada)
 * @param {{next:()=>number}} [rng] gerador de números — opcional; sem ele usa Math.random
 */
export function planejarTiro({ atirador, alvo, armas, vento = 0, solido, dificuldade = 'medio', rng }) {
  let melhor = null;
  for (const arma of armas) {
    const tentativa = buscarTiro({ atirador, alvo, arma, vento, solido });
    if (!melhor || tentativa.distancia < melhor.distancia) melhor = { ...tentativa, arma };
  }

  const erro = ERRO_ANGULO[dificuldade] ?? ERRO_ANGULO.medio;
  const sorteio = rng ? rng.range(-1, 1) : Math.random() * 2 - 1;
  const angulo = clamp(melhor.angulo + sorteio * erro, ANGULO_MIN, ANGULO_MAX);

  return {
    arma: melhor.arma,
    direcao: melhor.direcao,
    angulo,
    forca: clamp(melhor.forca, 0.1, 1),
  };
}
