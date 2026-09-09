import test from 'node:test';
import assert from 'node:assert/strict';

import { createMatch } from '../js/frente/match.js';

/**
 * Testes de ponta a ponta da IA dentro de `match.js` de verdade — mapa
 * gerado, terreno com relevo, tudo. Os testes de `ai.test.js` validam a
 * busca em terreno sintético; este arquivo existe porque a busca sozinha
 * não teria pego um bug real encontrado ao testar no navegador: com o
 * tamanho de mapa do Minhocas (160 m, pensado para várias equipes que andam
 * e se aproximam ao longo do jogo), os dois nascimentos de um duelo 1×1
 * caíam tipicamente MUITO além do alcance de qualquer arma — a bazuca, a
 * mais forte, não passa de uns 64 m. Sem andar até o alvo (que esta IA
 * ainda não faz), ela atirava para o vazio a partida inteira, sempre.
 *
 * `LARGURA_MAPA_DUELO` (em `match.js`) resolve isso encolhendo o mapa; este
 * teste é o que garante que ninguém aumente esse número de volta sem notar.
 */

function cameraFalsa() {
  return {
    x: 0, y: 0, scale: 20, width: 900, height: 500,
    setBounds() {}, lookAt() {}, addShake() {}, update() {},
    toScreen: (x, y) => ({ x, y }),
    get halfWidth() { return this.width / 2 / this.scale; },
    get halfHeight() { return this.height / 2 / this.scale; },
  };
}

function particulasFalsas() {
  return { spawn() {}, update() {}, draw() {}, clear() {} };
}

const DT = 1 / 120;
const PASSOS_MAX = 120 * 60 * 4; // 4 min de jogo simulado por turno-alvo — bem folgado

/** Roda a partida até completar `turnoAlvo` turnos, ou travar tentando. */
function simularAte(partida, turnoAlvo) {
  let passos = 0;
  while (partida.turnos.turno < turnoAlvo && passos < PASSOS_MAX && !partida.fimDeJogo) {
    partida.update(DT);
    passos += 1;
  }
  return passos < PASSOS_MAX;
}

test('a IA (dificuldade difícil) acerta o jogador humano na maioria das sementes, no primeiro tiro', () => {
  let acertos = 0;
  const SEMENTES = 12;
  for (let semente = 1; semente <= SEMENTES; semente += 1) {
    const partida = createMatch({
      semente,
      equipes: [
        { nome: 'Você', soldados: 1 },
        { nome: 'IA', soldados: 1, ia: { dificuldade: 'dificil' } },
      ],
      camera: cameraFalsa(),
      particles: particulasFalsas(),
      tempoTurno: 45,
    });

    const avancou = simularAte(partida, 2); // turno 0 (humano, timeout) + turno 1 (IA atira)
    assert.ok(avancou, `semente ${semente}: a partida travou antes do turno 2`);

    if (partida.times[0].vida < 100) acertos += 1;
  }

  assert.ok(
    acertos >= SEMENTES * 0.6,
    `IA difícil acertou só ${acertos}/${SEMENTES} sementes — abaixo do esperado ` +
    '(sinal de que o alvo ficou fora do alcance de toda arma, como no bug do mapa largo)',
  );
});

test('a IA nunca trava a partida (turno avança) em várias sementes e dificuldades', () => {
  for (const dificuldade of ['facil', 'medio', 'dificil']) {
    for (let semente = 1; semente <= 6; semente += 1) {
      const partida = createMatch({
        semente: semente * 1000, // sementes diferentes das do teste acima
        equipes: [
          { nome: 'Você', soldados: 1 },
          { nome: 'IA', soldados: 1, ia: { dificuldade } },
        ],
        camera: cameraFalsa(),
        particles: particulasFalsas(),
        tempoTurno: 45,
      });
      const avancou = simularAte(partida, 3);
      assert.ok(avancou, `dificuldade ${dificuldade}, semente ${semente}: travou antes do turno 3`);
    }
  }
});
