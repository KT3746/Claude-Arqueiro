/**
 * A partida: mundo, equipes, ordem de jogo, vento, água e regras.
 *
 * É aqui que os módulos puros se encontram com a câmera, as partículas e o
 * som. A lógica que dá para testar sem navegador mora nos outros arquivos —
 * este é o fio que costura tudo.
 */

import { createRng, randomSeed } from '../engine/rng.js';
import { sfx } from '../engine/audio.js';

import { gerarTerreno } from './terrain-gen.js';
import { createTerrain } from './terrain.js';
import { createTurnMachine, FASE } from './turn.js';
import { ARMAS, MINI_FRAGMENTO, armaPorId, armaSeguinte } from './weapons.js';
import { createProjectile, atualizarProjetil, projetilParado, desenharProjetil } from './projectile.js';
import { explosao } from './damage.js';
import { GRAVIDADE, ARRASTO, interseccaoSegmentoCirculo } from './ballistics.js';
import { planejarTiro } from './ai.js';
import * as Soldado from './soldado.js';

/**
 * Callsigns no alfabeto fonético militar — em vez dos nomes fofos do jogo
 * Minhocas (Tico, Bala, Pipa…), de onde este arquivo é um port adaptado.
 */
const NOMES = [
  'Alfa', 'Bravo', 'Charlie', 'Delta', 'Eco', 'Fox', 'Golfe', 'Hotel',
  'Índia', 'Juliet', 'Kilo', 'Lima', 'Mike', 'Novembro', 'Óscar', 'Papa',
];

/** Explosão de quem morre — é o que encadeia mortes. */
const EXPLOSAO_DE_MORTE = { raio: 1.9, dano: 28, impulso: 8 };

/** A água sobe isto por turno depois da morte súbita. */
const SUBIDA_AGUA = 0.22;

/** Forma de uma nuvem: deslocamento e raio de cada bolha, em unidades de escala. */
const BOLHAS_DE_NUVEM = [
  [-1.6, 0.15, 0.85],
  [-0.6, -0.25, 1.15],
  [0.6, -0.1, 1.0],
  [1.7, 0.2, 0.75],
];

/** Armas que a IA sabe usar: as três de arco padrão (mirar, carregar, soltar). */
const ARMAS_DA_IA = ['bazuca', 'morteiro', 'granada'].map(armaPorId);

/** Pausa "pensando" antes da IA decidir o tiro — dá tempo da câmera assentar. */
const TEMPO_PENSANDO = 0.9;

/**
 * Largura do mapa, em pixels de máscara (a 20 px/m, ver `terrain-gen.js`).
 *
 * O padrão do Minhocas (3200 px = 160 m) é pensado para até 4 equipes de
 * vários soldados cada, que se espalham e se aproximam andando ao longo de
 * várias rodadas. Num duelo de 1 contra 1 os dois nascimentos tendem a cair
 * nos dois extremos do mapa (`escolherNascimentos` maximiza a distância de
 * propósito) — e a 160 m de distância, NENHUMA arma do arsenal alcança
 * (a bazuca, a mais forte, chega a uns 64 m na força máxima): a IA, que
 * ainda não anda até o alvo, atiraria pro nada o jogo inteiro. Um mapa mais
 * estreito é o que mantém os dois dentro do alcance de alguma arma desde o
 * primeiro turno, sem precisar ensinar a IA a andar.
 */
const LARGURA_MAPA_DUELO = 1700; // 85 m

export function createMatch({
  semente = randomSeed(),
  equipes = [
    { nome: 'Sua unidade', soldados: 1 },
    { nome: 'Inimigo', soldados: 1, ia: { dificuldade: 'medio' } },
  ],
  camera,
  particles,
  motionEnabled = true,
  tempoTurno = 45,
} = {}) {
  const rng = createRng(semente);
  const dados = gerarTerreno({ rng, largura: LARGURA_MAPA_DUELO });
  const terreno = createTerrain(dados);
  terreno.repintarTudo(); // ainda na tela de carregamento: nenhum quadro de jogo paga por isto

  camera.setBounds({ minX: 0, maxX: terreno.largura, minY: 0, maxY: terreno.altura });

  // ---------------------------------------------------------- equipes

  const nomesDisponiveis = rng.shuffle([...NOMES]);
  let contadorNomes = 0;

  const pontos = escolherNascimentos(
    terreno.nascimentos,
    equipes.reduce((n, e) => n + e.soldados, 0),
    rng,
  );

  let p = 0;
  const times = equipes.map((cfg, indice) => {
    const soldados = [];
    for (let i = 0; i < cfg.soldados; i += 1) {
      const ponto = pontos[p] ?? terreno.nascimentos[0];
      p += 1;
      soldados.push(Soldado.createSoldado({
        nome: nomesDisponiveis[contadorNomes++ % nomesDisponiveis.length],
        equipe: indice,
        x: ponto.x,
        y: ponto.y + 0.1,
      }));
    }
    return {
      nome: cfg.nome,
      indice,
      cores: Soldado.coresDaEquipe(indice),
      /** null = time humano. {dificuldade} = time controlado pela IA. */
      ia: cfg.ia ?? null,
      soldados,
      atual: -1,
      get vida() {
        return soldados.reduce((s, w) => s + (w.vivo ? Math.max(0, w.vida) : 0), 0);
      },
      get viva() {
        return soldados.some((w) => w.vivo);
      },
    };
  });

  const todas = times.flatMap((t) => t.soldados);

  // ------------------------------------------------------------ estado

  const estado = {
    semente,
    terreno,
    times,
    todas,
    projeteis: [],
    tracos: [],     // traços visuais de tiros instantâneos (rifle de precisão)
    vento: 0,
    nivelAgua: terreno.nivelAgua,
    ativa: null,
    equipeDaVez: -1,
    arma: ARMAS[0],
    pavio: 3,
    carga: 0,
    carregando: false,
    mensagem: '',
    tempoMensagem: 0,
    motionEnabled,
    slowmo: 1,
    tempoAgua: 0,
    fimDeJogo: false,
    vencedor: null,
    /** Estado do "condutor" da IA durante o turno dela — null fora dele. */
    ia: null,
  };

  const ambiente = () => ({ gravidade: GRAVIDADE, arrasto: ARRASTO, vento: estado.vento });

  // ------------------------------------------------------- turnos

  const turnos = createTurnMachine({
    tempoTurno,
    equipes: times.length,
    hooks: {
      aoPreparar() {
        estado.carga = 0;
        estado.carregando = false;
        estado.arma = ARMAS[0];
        estado.pavio = ARMAS[1].pavio;
        estado.vento = Math.round(rng.range(-9, 9) * 10) / 10;
        estado.ativa = proximoSoldado();
        estado.ia = null;
        if (estado.ativa) {
          camera.lookAt(estado.ativa.x, estado.ativa.y + 1, 26);
          sfx.vez();
          const time = times[estado.equipeDaVez];
          if (time.ia) iniciarTurnoDaIA(time.ia);
        }
      },
      aoDisparar() {
        estado.carregando = false;
      },
      aoResolver: resolverConsequencias,
      aoMorteSubita() {
        anunciar('Morte súbita! A água está subindo.');
        sfx.sirene();
      },
      aoSubirAgua() {
        estado.nivelAgua += SUBIDA_AGUA;
      },
      aoFim(vencedor) {
        estado.fimDeJogo = true;
        estado.vencedor = vencedor;
      },
    },
  });

  function proximoSoldado() {
    for (let salto = 1; salto <= times.length; salto += 1) {
      const idx = (estado.equipeDaVez + salto) % times.length;
      const time = times[idx];
      if (!time.viva) continue;
      estado.equipeDaVez = idx;
      for (let k = 1; k <= time.soldados.length; k += 1) {
        const j = (time.atual + k) % time.soldados.length;
        if (time.soldados[j].vivo) {
          time.atual = j;
          return time.soldados[j];
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- IA
  //
  // O condutor da IA aperta os mesmos "botões" (`comandos`) que um jogador
  // apertaria — ele nunca dispara nada por fora do fluxo normal do jogo.
  // Fases: pensando (pausa + `planejarTiro`) → virando/mirando (gira o
  // corpo e nudga o ângulo com `comandos.mirar`, igual ao toque do jogador
  // no botão de mira) → carregando (seta a arma e segura a força até bater
  // no alvo) → feito (não faz mais nada até o próximo turno).
  //
  // A IA não anda: ela atira de onde nasceu. É a limitação mais visível
  // desta primeira versão — decidir PARA ONDE andar, num terreno que muda a
  // cada tiro, é um problema por si só, deixado para depois.

  function iniciarTurnoDaIA(configIA) {
    estado.ia = {
      dificuldade: configIA.dificuldade,
      fase: 'pensando',
      tempo: TEMPO_PENSANDO,
      decisao: null,
    };
  }

  function alvoDaIA() {
    // Mira em quem estiver vivo e mais perto — sem atalho: é a mesma
    // informação (posição, vida) que o HUD mostra ao jogador humano.
    let melhor = null;
    let menorDistancia = Infinity;
    for (const w of todas) {
      if (!w.vivo || w.equipe === estado.equipeDaVez) continue;
      const distancia = Math.abs(w.x - estado.ativa.x);
      if (distancia < menorDistancia) {
        menorDistancia = distancia;
        melhor = w;
      }
    }
    return melhor;
  }

  function atualizarIA(dt) {
    const ia = estado.ia;
    if (!ia || !turnos.podeAtirar || !estado.ativa?.vivo) return;

    if (ia.fase === 'pensando') {
      ia.tempo -= dt;
      if (ia.tempo > 0) return;
      const alvo = alvoDaIA();
      if (!alvo) {
        turnos.forcarFimDeTurno();
        return;
      }
      ia.decisao = planejarTiro({
        atirador: estado.ativa,
        alvo,
        armas: ARMAS_DA_IA,
        vento: estado.vento,
        solido: (x, y) => terreno.solidoEm(x, y),
        dificuldade: ia.dificuldade,
        rng,
      });
      comandos.trocarArma(ia.decisao.arma.id);
      comandos.virar(ia.decisao.direcao);
      ia.fase = 'mirando';
      return;
    }

    if (ia.fase === 'mirando') {
      const diferenca = ia.decisao.angulo - estado.ativa.angulo;
      const passo = Math.sign(diferenca) * Math.min(Math.abs(diferenca), 1.4 * dt);
      comandos.mirar(passo);
      if (Math.abs(diferenca) < 0.01) {
        comandos.carregar();
        ia.fase = 'carregando';
      }
      return;
    }

    if (ia.fase === 'carregando') {
      if (!estado.carregando) {
        // Arma sem carga (rifle, por exemplo) já disparou sozinha ao "carregar".
        ia.fase = 'feito';
        return;
      }
      if (estado.carga >= ia.decisao.forca) {
        comandos.disparar();
        ia.fase = 'feito';
      }
    }
  }

  function anunciar(texto, segundos = 2.6) {
    estado.mensagem = texto;
    estado.tempoMensagem = segundos;
  }

  // ---------------------------------------------------- consequências

  /**
   * Roda entre o "tudo parou" e o próximo turno: mata quem chegou a zero,
   * afoga quem passou da linha d'água e devolve `true` se algo aconteceu —
   * o que faz a máquina esperar tudo assentar de novo (mortes em cadeia).
   */
  function resolverConsequencias() {
    let houve = false;

    for (const w of todas) {
      if (!w.vivo) continue;

      if (w.y < estado.nivelAgua) {
        w.vivo = false;
        respingar(w.x, estado.nivelAgua);
        sfx.respingo();
        anunciar(`${w.nome} se afogou.`);
        houve = true;
        continue;
      }

      if (w.vida <= 0) {
        w.vivo = false;
        w.vida = 0;
        detonar(w.x, w.y + Soldado.ALTURA * 0.4, EXPLOSAO_DE_MORTE);
        anunciar(`${w.nome} explodiu.`);
        houve = true;
      }
    }

    return houve;
  }

  /**
   * Uma mina assentada (`apoiado`) já não está "em jogo" para efeito de
   * turno — ela é uma armadilha que fica no mapa por rodadas, esperando
   * alguém chegar perto. Contá-la como projétil ativo travaria o turno para
   * sempre, já que nada garante que ela vá explodir logo.
   */
  function bloqueiaTurno(p) {
    return !(p.arma.assentaSemExplodir && p.apoiado);
  }

  function contexto() {
    const vivas = times.filter((t) => t.viva);
    const emJogo = estado.projeteis.filter(bloqueiaTurno);
    return {
      tudoParado: todas.every(Soldado.estaParada) && estado.projeteis.every(projetilParado),
      projeteisAtivos: emJogo.length,
      equipesVivas: vivas.length,
      equipeVencedora: vivas.length === 1 ? vivas[0] : null,
    };
  }

  // ------------------------------------------------------- explosões

  function detonar(x, y, arma) {
    terreno.explodir(x, y, arma.raio);

    for (const efeito of explosao(todas, x, y, arma)) {
      const w = efeito.corpo;
      w.vida -= efeito.dano;
      w.piscar = 0.45;

      Soldado.empurrar(w, efeito.impulso.x, efeito.impulso.y);
      if (efeito.dano > 4) sfx.ai();
    }

    // Detritos com a cor de quem foi atingido, fumaça e clarão.
    const quantidade = Math.round(24 + arma.raio * 12);
    for (let i = 0; i < quantidade; i += 1) {
      const a = rng.range(0, Math.PI * 2);
      const v = rng.range(2, 4 + arma.raio * 2.2);
      particles.spawn({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + 2,
        life: rng.range(0.5, 1.4),
        size: rng.range(0.05, 0.16),
        color: i % 4 === 0 ? '#6aa84f' : '#96653e',
        gravity: 11,
        drag: 0.5,
      });
    }
    for (let i = 0; i < 14; i += 1) {
      particles.spawn({
        x: x + rng.range(-arma.raio, arma.raio) * 0.5,
        y: y + rng.range(-arma.raio, arma.raio) * 0.5,
        vx: rng.range(-1.2, 1.2),
        vy: rng.range(0.6, 2.4),
        life: rng.range(0.7, 1.6),
        size: rng.range(0.2, 0.5),
        color: 'rgba(226, 226, 226, 0.45)',
        gravity: -1.2,
        drag: 1.6,
      });
    }

    camera.addShake(Math.min(1, arma.raio * 0.22));
    sfx.explosao(arma.raio);

    // Granada de fragmentação: a explosão principal acontece igual à de
    // qualquer outra granada, e além dela nascem pedaços menores que se
    // espalham e explodem sozinhos pouco depois.
    if (arma.cacho) {
      for (let i = 0; i < arma.cacho.quantidade; i += 1) {
        const angulo = rng.range(0, Math.PI * 2);
        const velocidade = rng.range(arma.cacho.velocidadeMin, arma.cacho.velocidadeMax);
        estado.projeteis.push(createProjectile({
          arma: MINI_FRAGMENTO,
          x,
          y,
          vx: Math.cos(angulo) * velocidade,
          vy: Math.abs(Math.sin(angulo)) * velocidade + 1.5, // sempre espalha para cima
          pavio: arma.cacho.pavio,
        }));
      }
    }
  }

  function respingar(x, y) {
    for (let i = 0; i < 26; i += 1) {
      particles.spawn({
        x: x + rng.range(-0.4, 0.4),
        y,
        vx: rng.range(-2.4, 2.4),
        vy: rng.range(2.5, 6.5),
        life: rng.range(0.4, 1),
        size: rng.range(0.05, 0.13),
        color: '#7fc4e8',
        gravity: 12,
        drag: 0.6,
      });
    }
  }

  // ---------------------------------------------------------- comandos

  const comandos = {
    andar(dir, dt) {
      if (!podeAgir()) return;
      Soldado.andar(estado.ativa, terreno, dir, dt);
    },

    mirar(delta) {
      if (!podeAgir()) return;
      const w = estado.ativa;
      w.angulo = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, w.angulo + delta));
    },

    virar(dir) {
      if (!podeAgir()) return;
      estado.ativa.direcao = dir;
    },

    pular(tipo) {
      if (!podeAgir()) return;
      Soldado.pular(estado.ativa, terreno, tipo);
    },

    trocarArma(id) {
      if (!turnos.podeAtirar || estado.carregando) return;
      estado.arma = armaPorId(id);
    },

    /** Percorre o arsenal com `[` `]`. Não pula para a arma oculta do cacho. */
    trocarArmaRelativa(direcao) {
      if (!turnos.podeAtirar || estado.carregando) return;
      let proxima = estado.arma;
      do {
        proxima = armaSeguinte(proxima, direcao);
      } while (proxima.oculta && proxima !== estado.arma);
      estado.arma = proxima;
    },

    ajustarPavio(segundos) {
      if (!turnos.podeAtirar) return;
      estado.pavio = Math.max(1, Math.min(5, segundos));
    },

    /** Começa a carregar a força do tiro (ou dispara na hora, para quem não carrega). */
    carregar() {
      if (!turnos.podeAtirar || !estado.ativa) return;
      const arma = estado.arma;

      // Soltável e hitscan não têm força para acumular: disparam no toque.
      if (arma.tipo === 'soltavel' || arma.tipo === 'hitscan') {
        soltar();
        return;
      }
      estado.carregando = true;
      estado.carga = 0;
    },

    /** Solta e dispara com a força acumulada. */
    disparar() {
      if (!estado.carregando) return;
      soltar();
    },
  };

  function podeAgir() {
    return turnos.podeControlar && estado.ativa?.vivo && !estado.fimDeJogo;
  }

  function soltar() {
    const w = estado.ativa;
    if (!w || !turnos.podeAtirar) return;
    const arma = estado.arma;

    estado.carregando = false;

    if (arma.tipo === 'hitscan') {
      disparoHitscan(w, arma);
    } else {
      const boca = Soldado.bocaDaArma(w);
      const carga = Math.max(0.12, estado.carga);
      const solta = arma.tipo === 'soltavel';

      estado.projeteis.push(createProjectile({
        arma,
        x: solta ? w.x + w.direcao * 0.35 : boca.x,
        y: solta ? w.y + 0.25 : boca.y,
        vx: solta ? 0 : Math.cos(w.angulo) * w.direcao * arma.velocidadeMax * carga,
        vy: solta ? 0 : Math.sin(w.angulo) * arma.velocidadeMax * carga,
        dono: w,
        pavio: arma.tipo === 'granada' ? estado.pavio : arma.pavio,
      }));
      if (!solta) sfx.disparo();
    }

    estado.carga = 0;
    turnos.disparou(arma);
  }

  /**
   * Escopeta e sniper: sem tempo de voo, resolvidos no mesmo quadro do
   * disparo. O terreno já sabe achar o primeiro ponto sólido no caminho
   * (`terreno.raio`); falta só testar os soldados no meio do caminho, porque
   * a máscara não sabe nada sobre corpos.
   */
  function disparoHitscan(w, arma) {
    const boca = Soldado.bocaDaArma(w, 0.4);
    const alcance = arma.alcanceMax ?? 40;

    for (let i = 0; i < (arma.disparos ?? 1); i += 1) {
      const desvio = arma.espalhamento ? rng.range(-arma.espalhamento, arma.espalhamento) : 0;
      const angulo = w.angulo + desvio;
      const destino = {
        x: boca.x + Math.cos(angulo) * w.direcao * alcance,
        y: boca.y + Math.sin(angulo) * alcance,
      };

      const impactoTerreno = terreno.raio(boca.x, boca.y, destino.x, destino.y);
      let melhorT = impactoTerreno ? impactoTerreno.t : 1;
      let alvo = null;

      for (const outra of todas) {
        if (!outra.vivo || outra === w) continue;
        const centro = { x: outra.x, y: outra.y + Soldado.ALTURA * 0.5 };
        const t = interseccaoSegmentoCirculo(boca, destino, centro, Soldado.LARGURA * 0.65);
        if (t !== null && t < melhorT) {
          melhorT = t;
          alvo = outra;
        }
      }

      const pontoFinal = {
        x: boca.x + (destino.x - boca.x) * melhorT,
        y: boca.y + (destino.y - boca.y) * melhorT,
      };

      estado.tracos.push({ x0: boca.x, y0: boca.y, x1: pontoFinal.x, y1: pontoFinal.y, vida: 0.12 });

      if (alvo) {
        alvo.vida -= arma.dano;
        alvo.piscar = 0.4;
        const dx = alvo.x - w.x || w.direcao;
        Soldado.empurrar(alvo, Math.sign(dx) * (arma.impulso ?? 0), (arma.impulso ?? 0) * 0.3);
      }
      if (arma.furoRaio) terreno.explodir(pontoFinal.x, pontoFinal.y, arma.furoRaio);
    }

    sfx.disparo();
  }

  // ------------------------------------------------------------ update

  function update(dt) {
    estado.tempoAgua += dt;
    if (estado.tempoMensagem > 0) estado.tempoMensagem -= dt;

    atualizarIA(dt);

    for (const w of todas) {
      if (w.piscar > 0) w.piscar -= dt;
      const queda = Soldado.atualizar(w, terreno, dt, ambiente());
      if (queda) {
        w.vida -= queda.dano;
        w.piscar = 0.4;
        sfx.ai();
      }
      // Passou da linha d'água: some na hora, o resto resolve na fase certa.
      if (w.vivo && w.y < estado.nivelAgua - 0.6) {
        w.vy = Math.max(w.vy, -1.5);
      }
    }

    if (estado.carregando) {
      estado.carga = Math.min(1, estado.carga + dt * 1.35);
      if (estado.carga >= 1) soltar();
    }

    atualizarProjeteis(dt);
    particles.update(dt);

    for (let i = estado.tracos.length - 1; i >= 0; i -= 1) {
      estado.tracos[i].vida -= dt;
      if (estado.tracos[i].vida <= 0) estado.tracos.splice(i, 1);
    }

    // Uma mina armada em outro turno (ou qualquer perigo persistente) pode
    // matar alguém enquanto o jogador da vez ainda não atirou nada — e
    // `resolverConsequencias()` só roda de novo em RESOLVENDO, que só chega
    // depois de um disparo de verdade. Sem isto, essa morte ficaria com
    // vida negativa mas `vivo` ainda true, parada em pé, por até os 45 s
    // inteiros do turno. Só durante JOGANDO: nas outras fases o disparo do
    // próprio jogador já vai levar a uma RESOLVENDO em poucos segundos.
    //
    // E se algo morreu, força o fim do turno na hora — sem isso a morte
    // fica correta (`vivo=false`), mas o jogo só checa vitória/derrota
    // dentro de RESOLVENDO, que nunca é alcançado enquanto ninguém dispara;
    // as duas últimas equipes podiam se eliminar mutuamente e a partida
    // continuar rodando, sem declarar fim, até o relógio do turno zerar.
    if (turnos.fase === FASE.JOGANDO && resolverConsequencias()) {
      turnos.forcarFimDeTurno();
    }

    turnos.update(dt, contexto());
    seguirCamera(dt);

    // Câmera lenta no instante em que um tiro decide a partida.
    estado.slowmo = 1;
    camera.update(dt);
  }

  function atualizarProjeteis(dt) {
    for (let i = estado.projeteis.length - 1; i >= 0; i -= 1) {
      const p = estado.projeteis[i];
      const antes = Math.hypot(p.vx, p.vy);
      const r = atualizarProjetil(p, terreno, dt, ambiente());

      // A mina não explode ao tocar — só quando algo vivo chega perto, e só
      // depois do atraso de armar (senão explode em quem acabou de largá-la).
      let explodiu = r === 'explodir';
      if (!explodiu && p.arma.proximidade && p.tempoVivo > (p.arma.atraso ?? 0)) {
        for (const w of todas) {
          if (!w.vivo) continue;
          if (Math.hypot(w.x - p.x, w.y - p.y) < p.arma.proximidade) {
            explodiu = true;
            break;
          }
        }
      }

      // Quem "explode ao encostar em qualquer coisa" (bazuca, morteiro,
      // míssil) só testava contato com o TERRENO — um soldado no ar não é
      // terreno, e sem gravidade o míssil atravessaria um alvo elevado para
      // sempre. Aqui o corpo de um soldado também conta como "qualquer coisa".
      if (!explodiu && !p.arma.pavio && !p.arma.assentaSemExplodir) {
        for (const w of todas) {
          if (!w.vivo || w === p.dono) continue;
          const centro = { x: w.x, y: w.y + Soldado.ALTURA * 0.5 };
          if (Math.hypot(p.x - centro.x, p.y - centro.y) < Soldado.LARGURA * 0.6) {
            explodiu = true;
            break;
          }
        }
      }

      // Rastro de fumaça do foguete (e do míssil guiado, que usa o mesmo desenho).
      p.fumaca -= dt;
      const ehFoguete = p.arma.tipo === 'projetil' || (p.arma.tipo === 'dirigivel' && p.arma.modo === 'reto');
      if (ehFoguete && p.fumaca <= 0) {
        p.fumaca = 0.02;
        particles.spawn({
          x: p.x,
          y: p.y,
          vx: rng.range(-0.3, 0.3),
          vy: rng.range(0, 0.6),
          life: rng.range(0.4, 0.9),
          size: rng.range(0.08, 0.2),
          color: 'rgba(220, 220, 220, 0.5)',
          gravity: -0.8,
          drag: 1.8,
        });
      }
      if (antes > 2 && Math.hypot(p.vx, p.vy) < antes * 0.7 && p.arma.pavio) sfx.quique();

      // Caiu na água: apaga sem explodir.
      if (p.y < estado.nivelAgua) {
        respingar(p.x, estado.nivelAgua);
        sfx.respingo();
        estado.projeteis.splice(i, 1);
        continue;
      }

      // A viga não explode nem espera gatilho: assentou, vira terreno.
      if (p.arma.construir && p.apoiado) {
        const { largura, altura } = p.arma.construir;
        terreno.construir(p.x, p.y, largura, altura);
        camera.addShake(0.12);
        sfx.quique();
        estado.projeteis.splice(i, 1);
        continue;
      }

      if (explodiu) {
        detonar(p.x, p.y, p.arma);
        estado.projeteis.splice(i, 1);
      }
    }
  }

  /** Câmera segue o projétil em voo, ou o soldado da vez quando não há nenhum. */
  function seguirCamera(dt) {
    // Uma mina já assentada não puxa mais a câmera: ela fica no mapa como
    // uma armadilha silenciosa, e o jogo segue acompanhando quem está jogando.
    const emVoo = estado.projeteis.filter(bloqueiaTurno);
    if (emVoo.length > 0) {
      // Segue o projétil mais alto — é o que o jogador está acompanhando.
      const alvo = emVoo.reduce((a, b) => (b.y > a.y ? b : a));
      camera.lookAt(alvo.x, alvo.y, 24);
      return;
    }
    if (estado.ativa?.vivo) {
      camera.lookAt(estado.ativa.x, estado.ativa.y + 1.2, 26);
    }
  }

  // ------------------------------------------------------------ desenho

  function desenhar(ctx) {
    desenharCeu(ctx);
    terreno.repintar(2);
    terreno.desenhar(ctx, camera);
    desenharAgua(ctx);

    for (const time of times) {
      for (const w of time.soldados) {
        Soldado.desenharSoldado(ctx, w, camera, {
          ativa: w === estado.ativa && turnos.podeControlar,
          cores: time.cores,
        });
      }
    }

    if (podeAgir() && estado.ativa) desenharMira(ctx);

    particles.draw(ctx, camera);

    for (const p of estado.projeteis) desenharProjetil(ctx, p, camera);
    for (const t of estado.tracos) desenharTraco(ctx, t, camera);
  }

  /** O traço luminoso de um tiro instantâneo, sumindo em poucos quadros. */
  function desenharTraco(ctx, t, camera) {
    const a = camera.toScreen(t.x0, t.y0);
    const b = camera.toScreen(t.x1, t.y1);
    ctx.save();
    ctx.globalAlpha = Math.max(0, t.vida / 0.12);
    ctx.strokeStyle = '#fff6c9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function desenharCeu(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, camera.height);
    g.addColorStop(0, '#1d3c63');
    g.addColorStop(0.55, '#4d7ea8');
    g.addColorStop(1, '#9dbfc9');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, camera.width, camera.height);

    // Nuvens em parallax: cada uma é um punhado de bolhas sobrepostas, porque
    // uma elipse sozinha lê como mancha de interface, não como nuvem.
    for (let i = 0; i < 10; i += 1) {
      const base = (i * 31.7) % terreno.largura;
      const camadaY = terreno.altura * (0.74 + (i % 3) * 0.08);
      const fator = 0.2 + (i % 3) * 0.14;   // camadas mais distantes andam menos
      const x = base - camera.x * fator + camera.x;
      const centro = camera.toScreen(x, camadaY);
      if (centro.x < -300 || centro.x > camera.width + 300) continue;

      const escala = camera.scale * (1.1 + (i % 4) * 0.3);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + (i % 3) * 0.035})`;
      ctx.beginPath();
      for (const [dx, dy, r] of BOLHAS_DE_NUVEM) {
        ctx.ellipse(centro.x + dx * escala, centro.y + dy * escala, r * escala, r * escala * 0.62, 0, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  function desenharAgua(ctx) {
    const topo = camera.toScreen(0, estado.nivelAgua).y;
    if (topo > camera.height) return;

    const g = ctx.createLinearGradient(0, topo, 0, camera.height);
    g.addColorStop(0, 'rgba(64, 150, 196, 0.62)');
    g.addColorStop(1, 'rgba(16, 52, 92, 0.92)');
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(0, camera.height);
    ctx.lineTo(0, topo);
    // Duas senoides somadas dão uma ondulação que não parece um metrônomo.
    for (let x = 0; x <= camera.width; x += 8) {
      const onda =
        Math.sin(x * 0.018 + estado.tempoAgua * 1.6) * 3 +
        Math.sin(x * 0.007 - estado.tempoAgua * 0.9) * 5;
      ctx.lineTo(x, topo + onda);
    }
    ctx.lineTo(camera.width, camera.height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(226, 245, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= camera.width; x += 8) {
      const onda =
        Math.sin(x * 0.018 + estado.tempoAgua * 1.6) * 3 +
        Math.sin(x * 0.007 - estado.tempoAgua * 0.9) * 5;
      if (x === 0) ctx.moveTo(x, topo + onda);
      else ctx.lineTo(x, topo + onda);
    }
    ctx.stroke();
  }

  /**
   * Mira: uma cruz na direção apontada e a barra de força carregando.
   * De propósito NÃO existe linha de trajetória — adivinhar o arco é o jogo.
   */
  function desenharMira(ctx) {
    const w = estado.ativa;
    if (!estado.arma.miravel) return;

    const boca = Soldado.bocaDaArma(w, 0);
    const alcance = 2.6;
    const alvoX = boca.x + Math.cos(w.angulo) * w.direcao * alcance;
    const alvoY = boca.y + Math.sin(w.angulo) * alcance;
    const origem = camera.toScreen(boca.x, boca.y);
    const ponta = camera.toScreen(alvoX, alvoY);

    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(origem.x, origem.y);
    ctx.lineTo(ponta.x, ponta.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ponta.x, ponta.y, 7, 0, Math.PI * 2);
    ctx.moveTo(ponta.x - 11, ponta.y);
    ctx.lineTo(ponta.x - 3, ponta.y);
    ctx.moveTo(ponta.x + 3, ponta.y);
    ctx.lineTo(ponta.x + 11, ponta.y);
    ctx.stroke();

    if (estado.carregando) {
      const largura = camera.scale * 1.8;
      const altura = 7;
      const x = origem.x - largura / 2;
      const y = camera.toScreen(w.x, w.y + Soldado.ALTURA + 1.4).y;
      ctx.fillStyle = 'rgba(9, 16, 26, 0.6)';
      ctx.fillRect(x - 1, y - 1, largura + 2, altura + 2);
      const cor = estado.carga < 0.45 ? '#7bc65f' : estado.carga < 0.8 ? '#ffd24a' : '#e2453c';
      ctx.fillStyle = cor;
      ctx.fillRect(x, y, largura * estado.carga, altura);
    }

    ctx.restore();
  }

  return {
    estado,
    turnos,
    terreno,
    comandos,
    times,
    update,
    desenhar,
    get FASE() {
      return FASE;
    },
    get fase() {
      return turnos.fase;
    },
    get relogio() {
      return turnos.relogio;
    },
    get fimDeJogo() {
      return estado.fimDeJogo;
    },
  };
}

/**
 * Escolhe pontos de nascimento espalhados: pega o candidato mais distante de
 * todos os já escolhidos, para nenhuma equipe começar encurralada num canto.
 */
function escolherNascimentos(candidatos, quantos, rng) {
  if (candidatos.length === 0) return [];
  const restantes = [...candidatos];
  const escolhidos = [restantes.splice(rng.int(0, restantes.length), 1)[0]];

  while (escolhidos.length < quantos && restantes.length > 0) {
    let melhor = 0;
    let melhorDistancia = -1;
    for (let i = 0; i < restantes.length; i += 1) {
      let perto = Infinity;
      for (const e of escolhidos) {
        perto = Math.min(perto, Math.abs(restantes[i].x - e.x));
      }
      if (perto > melhorDistancia) {
        melhorDistancia = perto;
        melhor = i;
      }
    }
    escolhidos.push(restantes.splice(melhor, 1)[0]);
  }

  // Alterna a ordem para as equipes ficarem intercaladas no mapa.
  return rng.shuffle(escolhidos);
}
