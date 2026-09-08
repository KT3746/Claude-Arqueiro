/**
 * O soldado: estados de movimento e desenho.
 *
 * Ele não é um corpo físico honesto — é uma cápsula que segue regras de jogo.
 * Andar é dar passos de um pixel tentando subir ou descer um degrau; só o voo
 * é física de verdade. É o que faz o movimento ter "peso" sem virar um motor
 * de física genérico.
 *
 * Colisão por SONDA DE 5 PONTOS (pés, dois flancos em duas alturas, cabeça),
 * não por varredura da cápsula inteira: é barato, previsível, e nunca gruda
 * numa quina.
 *
 * Este módulo é um port quase literal de `worm.js`, do jogo Minhocas
 * (repositório `Claude`, `js/minhocas/worm.js`) — só o desenho mudou, de
 * minhoca fofa para soldado; a física e as regras de movimento (já testadas
 * em `tests/soldado-move.test.js`, herdado de `worm-move.test.js`) ficaram
 * exatamente como estavam.
 */

import { avancar, refletir } from './ballistics.js';
import { danoDeQueda } from './damage.js';

export const LARGURA = 0.55;
export const ALTURA = 0.95;
export const VIDA_MAX = 100;

const MEIA = LARGURA / 2;
export const VELOCIDADE = 2.4;   // m/s andando
const DEGRAU = 0.32;        // altura de degrau que sobe e desce sem pular
const PASSO_SONDA = 0.05;   // 1 px a 20 px/m
const PARADA = 0.35;        // abaixo disso, considera-se em repouso

export const PULOS = {
  frente: { vx: 3.2, vy: 6.3 },
  costas: { vx: -1.9, vy: 9.0 },
};

export function createSoldado({ nome, equipe, x, y }) {
  return {
    nome,
    equipe,
    x,
    y,
    vx: 0,
    vy: 0,
    vida: VIDA_MAX,
    vivo: true,
    estado: 'voando',       // 'parada' | 'andando' | 'voando'
    direcao: 1,             // para onde olha: 1 direita, -1 esquerda
    angulo: Math.PI / 4,    // mira, em radianos
    tempoNoAr: 0,
    quedaMaxima: 0,
    restoDoPasso: 0,       // sobra de movimento menor que um pixel         // maior velocidade de queda desde que saiu do chão
    afogando: false,
    piscar: 0,
    quadrosResvalandoSemMover: 0, // ver comentário em `atualizar()`
    travada: false,               // idem — presa numa fresta, sem contar como "voando" pro turno
  };
}

// ---------------------------------------------------------------- sondas

/** A cápsula do soldado encosta em terreno se posicionada em (x, y)? */
export function colide(terreno, x, y) {
  return (
    terreno.solidoEm(x, y + 0.06) ||
    terreno.solidoEm(x - MEIA, y + 0.28) ||
    terreno.solidoEm(x + MEIA, y + 0.28) ||
    terreno.solidoEm(x - MEIA, y + 0.70) ||
    terreno.solidoEm(x + MEIA, y + 0.70) ||
    terreno.solidoEm(x, y + ALTURA - 0.06)
  );
}

/** Tem chão logo abaixo dos pés? */
export function apoiada(terreno, x, y) {
  return terreno.solidoEm(x, y - 0.04);
}

/**
 * Só a base da cápsula (sem os flancos) — usado para decidir se um pouso
 * "por velocidade baixa" é de verdade um pouso em cima de alguma coisa, e
 * não só o flanco da cápsula roçando numa parede ao lado (uma cratera
 * cavada rente à borda do mapa, por exemplo, deixa exatamente essa quina).
 * Sem esta distinção, um soldado podia oscilar para sempre entre 'voando'
 * e 'parada' no mesmo lugar, encostado de lado numa parede, sem cair para
 * o chão de verdade — achado pelo teste de estresse (fuzz.test.js).
 */
function tocaPeloFundo(terreno, x, y) {
  return terreno.solidoEm(x, y + 0.06);
}

// -------------------------------------------------------------- movimento

/**
 * Um passo de 1 px na horizontal, com degrau para cima e para baixo.
 * @returns {boolean} false se bateu numa parede alta demais
 */
function passoHorizontal(terreno, w, dir) {
  const nx = w.x + dir * PASSO_SONDA;

  if (!colide(terreno, nx, w.y)) {
    // Caminho livre: procura chão até um degrau abaixo (descer rampa colada).
    for (let d = 0; d <= DEGRAU + 1e-9; d += PASSO_SONDA) {
      const ny = w.y - d;
      if (colide(terreno, nx, ny)) break;
      if (apoiada(terreno, nx, ny)) {
        w.x = nx;
        w.y = ny;
        return true;
      }
    }
    // Nada embaixo: andou para fora da beirada e cai.
    w.x = nx;
    w.estado = 'voando';
    w.vx = dir * 1.1;
    w.vy = 0;
    w.quedaMaxima = 0;
    return true;
  }

  // Bloqueado: tenta subir um degrau.
  for (let h = PASSO_SONDA; h <= DEGRAU + 1e-9; h += PASSO_SONDA) {
    const ny = w.y + h;
    if (!colide(terreno, nx, ny)) {
      w.x = nx;
      w.y = ny;
      return true;
    }
  }
  return false;
}

/**
 * Anda enquanto o comando estiver pressionado. `dir` é -1 ou 1.
 *
 * Cada passo move um pixel inteiro, mas um quadro quase nunca vale um número
 * redondo de pixels: a sobra fica guardada em `restoDoPasso`. Sem isso, um
 * quadro de 1/120 s pediria 2 cm e andaria 5, e o soldado sairia correndo
 * duas vezes e meia mais rápido do que a velocidade configurada.
 */
export function andar(w, terreno, dir, dt) {
  if (!w.vivo || w.estado === 'voando' || w.estado === 'corda') return;
  if (dir !== w.direcao) w.restoDoPasso = 0;
  w.direcao = dir;
  w.estado = 'andando';

  w.restoDoPasso += VELOCIDADE * dt;
  while (w.restoDoPasso >= PASSO_SONDA) {
    w.restoDoPasso -= PASSO_SONDA;
    if (!passoHorizontal(terreno, w, dir) || w.estado === 'voando') {
      w.restoDoPasso = 0;
      break;
    }
  }
}

/** Pulo curto para frente ou cambalhota para trás. */
export function pular(w, terreno, tipo = 'frente') {
  if (!w.vivo || w.estado === 'voando' || w.estado === 'corda') return false;
  if (!apoiada(terreno, w.x, w.y)) return false;
  const p = PULOS[tipo] ?? PULOS.frente;
  w.restoDoPasso = 0;
  w.vx = p.vx * w.direcao;
  w.vy = p.vy;
  w.estado = 'voando';
  w.quedaMaxima = 0;
  return true;
}

/** Empurrão de explosão: joga o soldado no ar. */
export function empurrar(w, ix, iy) {
  if (!w.vivo) return;
  w.restoDoPasso = 0;
  w.vx += ix;
  w.vy += iy;
  w.estado = 'voando';
  w.quedaMaxima = 0;
}

/**
 * Um passo de física. Só o soldado no ar integra de verdade; no chão ele
 * apenas confere se o terreno sumiu debaixo dele (uma cratera, por exemplo).
 *
 * @returns {{dano:number, causa:string}|null} dano de queda, se houve
 */
export function atualizar(w, terreno, dt, env) {
  if (!w.vivo) return null;

  // O estado 'corda' nunca é alcançado nesta versão — não há corda de gancho
  // no arsenal (ver weapons.js). Fica guardado por compatibilidade com o
  // resto do código original, caso a mecânica volte no futuro.
  if (w.estado === 'corda') return null;

  if (w.estado !== 'voando') {
    w.vx = 0;
    w.vy = 0;
    w.travada = false;
    if (!apoiada(terreno, w.x, w.y)) {
      w.estado = 'voando';
      w.quedaMaxima = 0;
    } else if (colide(terreno, w.x, w.y)) {
      // O terreno cresceu por baixo (ou ele nasceu meio enterrado): sobe.
      for (let h = PASSO_SONDA; h <= 1.2; h += PASSO_SONDA) {
        if (!colide(terreno, w.x, w.y + h)) {
          w.y += h;
          break;
        }
      }
    }
    w.tempoNoAr = 0;
    return null;
  }

  w.tempoNoAr += dt;
  const xInicio = w.x;
  const yInicio = w.y;
  const semVento = { ...env, vento: 0 }; // soldado não é levado pelo vento
  const r = avancar(w, dt, semVento, (x, y) => colide(terreno, x, y));

  w.quedaMaxima = Math.min(w.quedaMaxima, r.estado.vy);

  if (!r.impacto) {
    w.x = r.estado.x;
    w.y = r.estado.y;
    w.vx = r.estado.vx;
    w.vy = r.estado.vy;
    w.quadrosResvalandoSemMover = 0;
    w.travada = false;
    return null;
  }

  // Bateu: volta ao último ponto livre e decide entre parar ou resvalar.
  w.x = r.impacto.livreX;
  w.y = r.impacto.livreY;

  const velocidade = Math.hypot(r.estado.vx, r.estado.vy);
  const queda = w.quedaMaxima;

  if (apoiada(terreno, w.x, w.y) || (velocidade < PARADA && tocaPeloFundo(terreno, w.x, w.y))) {
    w.vx = 0;
    w.vy = 0;
    w.estado = 'parada';
    w.tempoNoAr = 0;
    w.quadrosResvalandoSemMover = 0;
    w.travada = false;
    const dano = danoDeQueda(queda);
    w.quedaMaxima = 0;
    return dano > 0 ? { dano, causa: 'queda' } : null;
  }

  // Rede de segurança: quando o quadro inteiro de movimento cabe dentro de
  // uma única amostra de colisão (`avancar()` testa só o PONTO FINAL, sem
  // fração livre nenhuma) e esse ponto já está encostado em terreno, a
  // soldado fica na mesma posição, quadro após quadro — e para certos
  // ângulos de normal (uma quina a 45°, por exemplo) a reflexão devolve de
  // volta EXATAMENTE a energia que a gravidade acrescentou naquele quadro,
  // sem nunca decair. É um ponto fixo de verdade da física (`refletir()` com
  // os coeficientes usados aqui não garante perda de energia para toda
  // normal possível), não um bug de estado — então não adianta forçar
  // `estado = 'parada'` aqui: no quadro seguinte a checagem lá em cima
  // (`!apoiada(...)`) devolveria o soldado pra 'voando' de novo, porque de
  // fato não há chão de verdade sob ele (é uma fresta, não um pouso), e o
  // turno voltaria a travar — só que agora balançando entre 'parada' e
  // 'voando' em vez de ficar preso só em 'voando'. Foi assim que o teste de
  // estresse (fuzz.test.js) achou uma SEGUNDO soldado presa numa fresta
  // diferente, oscilando exatamente fora de fase com a primeira: nunca as
  // duas ficavam "paradas" no mesmo quadro, e o turno nunca conseguia
  // avançar mesmo com as duas se debatendo.
  //
  // A saída é não mexer no estado: `travada` deixa o turno seguir em frente
  // (via `estaParada()`) sem fingir que o soldado pousou de verdade — ele
  // continua balançando na fresta, visualmente, até algo a tire de lá.
  const semProgresso = w.x === xInicio && w.y === yInicio;
  w.quadrosResvalandoSemMover = semProgresso ? w.quadrosResvalandoSemMover + 1 : 0;
  w.travada = w.quadrosResvalandoSemMover >= 3;

  // Resvalo em parede ou teto: perde bastante energia, sem quicar como bola.
  const n = terreno.normalEm(w.x, w.y, 0.3);
  const v = refletir(r.estado, n, 0.15, 0.45);
  w.vx = v.vx;
  w.vy = v.vy;

  // Empurrão para fora, ao longo da normal, só quando a normal é
  // predominantemente HORIZONTAL (parede, não chão/teto): contra uma
  // parede quase vertical com velocidade quase só vertical (uma cratera
  // cavada rente à borda do mapa, por exemplo), refletir troca de
  // velocidade mas quase não muda a posição — a componente normal da
  // velocidade é minúscula, então quase nada é revertido, e no próximo
  // quadro a queda esbarra exatamente no mesmo pixel de novo, com a mesma
  // reflexão, para sempre. Sem sair do lugar, o soldado nunca escapa desse
  // ponto fixo. 1 cm é imperceptível no jogo e o bastante para o próximo
  // passo já testar colisão alhures.
  //
  // Numa normal predominantemente VERTICAL (chão/teto) este empurrão é
  // ativamente prejudicial: ele reinicia a queda livre sempre da mesma
  // altura artificial (1 cm) a cada quadro, o que produz sempre a mesma
  // velocidade de impacto — se essa velocidade calhar de ficar acima do
  // limiar de pouso (`PARADA`), o soldado ricocheteia para sempre com
  // amplitude constante em vez de perder energia a cada quique e assentar,
  // como o teste de estresse (fuzz.test.js) achou.
  if (Math.abs(n.x) > Math.abs(n.y)) {
    w.x += n.x * 0.01;
    w.y += n.y * 0.01;
  }
  return null;
}

/** Está em repouso o bastante para o turno poder virar? */
export function estaParada(w) {
  return (
    !w.vivo ||
    w.travada ||
    (w.estado !== 'voando' && Math.abs(w.vx) < 0.05 && Math.abs(w.vy) < 0.05)
  );
}

/** Ponta do cano da arma, de onde o projétil sai. */
export function bocaDaArma(w, distancia = 0.75) {
  const cy = w.y + ALTURA * 0.55;
  return {
    x: w.x + Math.cos(w.angulo) * w.direcao * distancia,
    y: cy + Math.sin(w.angulo) * distancia,
    cx: w.x,
    cy,
  };
}

// ----------------------------------------------------------------- desenho

// Farda em tons militares por equipe (não mais cores vivas de time esportivo):
// verde-oliva para "sua unidade", cinza-urbano para o inimigo, e mais duas
// variações (deserto, floresta) para partidas com mais de dois lados.
const CORES_EQUIPE = [
  { corpo: '#5b6b45', escuro: '#3a4530', capacete: '#4a5535' },
  { corpo: '#5c6670', escuro: '#3b434a', capacete: '#2f363c' },
  { corpo: '#a68a5b', escuro: '#7a6440', capacete: '#8a7248' },
  { corpo: '#4a5c4f', escuro: '#303e34', capacete: '#3a4a3e' },
];

export function coresDaEquipe(indice) {
  return CORES_EQUIPE[indice % CORES_EQUIPE.length];
}

/**
 * Desenha o soldado em vetor — sem sprite, como todo o resto do projeto.
 */
export function desenharSoldado(ctx, w, camera, { ativa = false, cores } = {}) {
  if (!w.vivo) return;
  const c = cores ?? coresDaEquipe(w.equipe);
  const p = camera.toScreen(w.x, w.y);
  const e = camera.scale; // pixels por metro

  // Pisca quando acabou de tomar dano.
  if (w.piscar > 0 && Math.floor(w.piscar * 12) % 2 === 0) return;

  const alturaPx = ALTURA * e;
  const larguraPx = LARGURA * e;
  const cx = p.x;
  const base = p.y;

  ctx.save();

  // Sombra no chão.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, base, larguraPx * 0.55, larguraPx * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Corpo: cápsula levemente inclinada para a direção do olhar.
  const topo = base - alturaPx;
  const raio = larguraPx * 0.5;
  const gradiente = ctx.createLinearGradient(cx - raio, topo, cx + raio, base);
  gradiente.addColorStop(0, c.corpo);
  gradiente.addColorStop(1, c.escuro);

  ctx.fillStyle = gradiente;
  ctx.beginPath();
  ctx.moveTo(cx - raio, base - raio * 0.6);
  ctx.quadraticCurveTo(cx - raio, topo + raio, cx, topo + raio * 0.55);
  ctx.quadraticCurveTo(cx + raio, topo + raio, cx + raio, base - raio * 0.6);
  ctx.quadraticCurveTo(cx + raio, base, cx, base);
  ctx.quadraticCurveTo(cx - raio, base, cx - raio, base - raio * 0.6);
  ctx.fill();

  // Capacete de combate (mais achatado e reto que o boné arredondado
  // original — é o que lê como "militar" em vez de "personagem de desenho").
  ctx.fillStyle = c.capacete;
  ctx.beginPath();
  ctx.arc(cx, topo + raio * 0.8, raio * 0.85, Math.PI * 1.0, Math.PI * 2.0);
  ctx.fill();
  ctx.fillRect(cx - raio * 0.95, topo + raio * 0.72, raio * 1.9, raio * 0.16);

  // Uma faixa escura no lugar do rosto — de propósito sem olhos nem rosto
  // desenhado: não é mais uma criatura de desenho animado, é uma silhueta.
  ctx.fillStyle = c.escuro;
  ctx.beginPath();
  ctx.ellipse(cx + w.direcao * raio * 0.05, topo + raio * 1.15, raio * 0.42, raio * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Fuzil apontado na direção da mira — é o que dá leitura de "para onde ele
  // está mirando" agora que não há olhos para cumprir esse papel.
  const boca = bocaDaArma(w, 0.62);
  const cano = camera.toScreen(boca.cx, boca.cy);
  const ponta = camera.toScreen(boca.x, boca.y);
  ctx.save();
  ctx.strokeStyle = '#20241f';
  ctx.lineWidth = Math.max(1.5, e * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cano.x, cano.y);
  ctx.lineTo(ponta.x, ponta.y);
  ctx.stroke();
  ctx.restore();

  // Nome e vida flutuando acima.
  desenharPlaca(ctx, w, c, cx, base - alturaPx - e * 0.45, e, ativa);
}

function desenharPlaca(ctx, w, cores, cx, cy, escala, ativa) {
  const fonte = Math.max(10, Math.min(16, escala * 0.42));
  ctx.save();
  ctx.font = `600 ${fonte}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const texto = `${w.nome}  ${Math.max(0, Math.round(w.vida))}`;
  const largura = ctx.measureText(texto).width + fonte * 0.9;
  const altura = fonte * 1.5;

  ctx.fillStyle = 'rgba(9, 16, 26, 0.62)';
  ctx.beginPath();
  ctx.roundRect(cx - largura / 2, cy - altura, largura, altura, fonte * 0.4);
  ctx.fill();

  if (ativa) {
    ctx.strokeStyle = cores.capacete;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.fillStyle = cores.corpo;
  ctx.fillText(texto, cx, cy - fonte * 0.28);
  ctx.restore();

  // Seta indicando de quem é a vez.
  if (ativa) {
    const t = Date.now() / 300;
    const oscila = Math.sin(t) * escala * 0.12;
    ctx.fillStyle = cores.capacete;
    ctx.beginPath();
    ctx.moveTo(cx, cy - altura - escala * 0.18 + oscila);
    ctx.lineTo(cx - escala * 0.2, cy - altura - escala * 0.5 + oscila);
    ctx.lineTo(cx + escala * 0.2, cy - altura - escala * 0.5 + oscila);
    ctx.closePath();
    ctx.fill();
  }
}
