import test from 'node:test';
import assert from 'node:assert/strict';

import { buscarTiro, planejarTiro, simularQueda, ERRO_ANGULO } from '../js/frente/ai.js';
import { ARMAS, armaPorId } from '../js/frente/weapons.js';
import { createRng } from '../js/engine/rng.js';

const BAZUCA = armaPorId('bazuca');
const MORTEIRO = armaPorId('morteiro');
const GRANADA = armaPorId('granada');
const ARCAVEIS = [BAZUCA, MORTEIRO, GRANADA];

/** Chão plano em y = 0: só o que a busca precisa (`solido(x, y)`). */
function chaoPlano() {
  return (x, y) => y <= 0;
}

/**
 * Chão plano com uma parede/colina sólida entre `x0` e `x1`, até a altura
 * `altura` — o caso que obriga a busca a preferir um tiro em arco.
 */
function chaoComObstaculo(x0, x1, altura) {
  return (x, y) => y <= 0 || (x >= x0 && x <= x1 && y <= altura);
}

test('simularQueda para no primeiro impacto contra um chão plano', () => {
  const pouso = simularQueda({ x: 0, y: 5, vx: 3, vy: 0 }, { gravidade: 9.81, arrasto: 0.0016, vento: 0 }, chaoPlano());
  assert.ok(pouso.bateu);
  assert.ok(Math.abs(pouso.y) < 0.5, `esperava pousar perto de y=0, ficou em ${pouso.y}`);
});

test('busca acha um tiro que cai perto do alvo, em chão plano, várias distâncias', () => {
  for (const distanciaAlvo of [10, 20, 35, 55]) {
    const r = buscarTiro({
      atirador: { x: 0, y: 0.9 },
      alvo: { x: distanciaAlvo, y: 0 },
      arma: BAZUCA,
      vento: 0,
      solido: chaoPlano(),
    });
    assert.ok(
      r.distancia < 3,
      `distância ${distanciaAlvo}m: melhor tiro encontrado ficou a ${r.distancia.toFixed(2)}m do alvo`,
    );
    assert.equal(r.direcao, 1);
  }
});

test('busca funciona atirando para a esquerda também', () => {
  const r = buscarTiro({
    atirador: { x: 30, y: 0.9 },
    alvo: { x: 5, y: 0 },
    arma: BAZUCA,
    vento: 0,
    solido: chaoPlano(),
  });
  assert.equal(r.direcao, -1);
  assert.ok(r.distancia < 3, `ficou a ${r.distancia.toFixed(2)}m do alvo`);
});

test('vento forte desloca o ponto de queda: a busca compensa e ainda acerta perto', () => {
  const comVento = buscarTiro({
    atirador: { x: 0, y: 0.9 },
    alvo: { x: 25, y: 0 },
    arma: BAZUCA, // sofre vento
    vento: 6,
    solido: chaoPlano(),
  });
  assert.ok(comVento.distancia < 3, `com vento, ficou a ${comVento.distancia.toFixed(2)}m`);
});

test('planejarTiro escolhe uma arma em arco quando o caminho reto está bloqueado', () => {
  // Parede alta bem entre atirador e alvo: só um tiro bem alto (morteiro ou
  // granada) consegue passar por cima e ainda descer perto do alvo.
  const solido = chaoComObstaculo(8, 9, 6);
  const decisao = planejarTiro({
    atirador: { x: 0, y: 0.9 },
    alvo: { x: 16, y: 0 },
    armas: ARCAVEIS,
    vento: 0,
    solido,
    dificuldade: 'dificil', // erro mínimo, para o teste medir a solução de verdade
  });
  assert.ok(decisao.angulo > (35 * Math.PI) / 180, `esperava um ângulo alto para passar a parede, veio ${(decisao.angulo * 180/Math.PI).toFixed(1)}°`);
});

test('a dificuldade fácil soma mais erro de ângulo que a difícil', () => {
  assert.ok(ERRO_ANGULO.facil > ERRO_ANGULO.medio);
  assert.ok(ERRO_ANGULO.medio > ERRO_ANGULO.dificil);
});

test('a dificuldade "difícil" com semente fixa reproduz a mesma decisão', () => {
  const cena = {
    atirador: { x: 0, y: 0.9 },
    alvo: { x: 22, y: 0 },
    armas: ARCAVEIS,
    vento: 2,
    solido: chaoPlano(),
    dificuldade: 'medio',
  };
  const a = planejarTiro({ ...cena, rng: createRng(42) });
  const b = planejarTiro({ ...cena, rng: createRng(42) });
  assert.equal(a.angulo, b.angulo);
  assert.equal(a.forca, b.forca);
  assert.equal(a.arma, b.arma);
});

test('a decisão sempre devolve valores dentro do que o jogo aceita', () => {
  const decisao = planejarTiro({
    atirador: { x: 0, y: 0.9 },
    alvo: { x: 40, y: -3 },
    armas: ARCAVEIS,
    vento: -5,
    solido: chaoPlano(),
    dificuldade: 'facil',
  });
  assert.ok(decisao.angulo > 0 && decisao.angulo < Math.PI / 2);
  assert.ok(decisao.forca >= 0.1 && decisao.forca <= 1);
  assert.ok(ARMAS.includes(decisao.arma));
});
