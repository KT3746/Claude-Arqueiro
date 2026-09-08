# Linha de Frente

Artilharia militar por turnos: você contra a IA, num terreno que se destrói a
cada tiro, até uma unidade ficar em pé. Port sério e reduzido do jogo
**Minhocas** (repositório `Claude`, `js/minhocas/`) — mesmo motor de terreno,
física e turnos, soldados no lugar de minhocas de capacete, um arsenal
enxuto de armas de verdade, e uma IA que decide sozinha o tiro.

Mesma casca do Arqueiro: **HTML5 Canvas, ES modules, sem build, sem
dependências e sem um único arquivo de imagem ou de som.**

## Como jogar

Sirva a pasta do repositório (o jogo usa módulos ES) e abra
`/linha-de-frente/`:

```bash
python3 -m http.server 8000   # depois: http://localhost:8000/linha-de-frente/
```

No celular, uma barra de botões aparece na tela (andar, pular, mirar, trocar
de arma, atirar) — ela só some com um mouse de verdade. No teclado:

| Ação | Tecla |
| --- | --- |
| Andar | ← → |
| Mirar | ↑ ↓ |
| Ajuste fino da mira | Shift + ↑ ↓ |
| Força do tiro | segure **Espaço** e solte (ou toque em qualquer ponto do campo) |
| Pular | Enter |
| Cambalhota para trás | Backspace |
| Trocar de arma | `[` e `]` percorrem o arsenal |
| Pavio da granada | 1 a 5, com uma granada na mão |
| Pausar | P |

### O arsenal

Um recorte sério do arsenal completo do Minhocas (14 armas) — ficaram de fora
a ovelha, a escopeta, a corda ninja, o jetpack e o teleporte.

| Arma | Tipo | O que faz |
| --- | --- | --- |
| Bazuca | projétil | sofre vento |
| Morteiro | projétil | mais lento, estrago maior |
| Granada | granada | quica, pavio ajustável |
| Granada de fragmentação | granada | explode e espalha 5 pedaços menores |
| Dinamite | soltável | larga no pé, pavio de 5 s |
| Mina terrestre | soltável | não explode ao tocar o chão — arma sozinha e detona por proximidade |
| Rifle de precisão | hitscan | 1 tiro instantâneo, longo alcance |
| Míssil guiado | dirigível | voo reto na mira, ignora vento e gravidade |
| Sacos de areia | soltável | larga no pé e vira barreira sólida de terreno |

### As regras

- **45 segundos** por turno (ou 30, ou 60 — dá para escolher no menu). O
  relógio congela enquanto o tiro está no ar.
- Depois do tiro sobram **3 segundos para correr**. Aproveite.
- O **vento** entorta a bazuca e o morteiro. O resto do arsenal ignora vento.
- Cair de muito alto machuca. A **água mata na hora**.
- Um soldado que chega a zero **explode**, e a explosão pode derrubar quem
  estiver por perto. Mortes em cadeia são parte do jogo.
- Depois de **10 rodadas** entra a morte súbita: a água começa a subir a cada
  turno.
- Escolha a **dificuldade da IA** no menu (fácil, médio, difícil) e quantos
  **soldados por unidade** (1 a 3).

### Semente do mapa

Todo mapa nasce de uma semente. Digitar a mesma semente no menu gera
exatamente o mesmo terreno, em qualquer máquina.

## A IA

A IA nunca lê nenhum atalho do jogo: ela recebe a mesma informação que você
vê (posição de cada soldado, vida, vento) e decide um ângulo, uma força e uma
arma — depois aperta os mesmos "botões" que você apertaria (`comandos`), com
uma pausa "pensando" antes de agir.

A solução do tiro é uma **busca em duas fases** sobre a física de verdade do
jogo: uma varredura grossa de ângulo × força, depois um refinamento local em
rodadas cada vez mais finas. Como a busca já simula contra o terreno real,
uma colina no caminho reprova sozinha os tiros que bateriam nela — não há
regra escrita à mão de "se bloqueado, use o morteiro". A dificuldade não
piora a busca: ela soma um erro angular aleatório *depois* de achar a melhor
solução (`js/frente/ai.js`).

**A IA ainda não anda até o alvo** — ela mira e atira de onde nasceu. É por
isso que o mapa deste jogo é mais estreito (85 m) que o do Minhocas original
(160 m, pensado para equipes que se aproximam andando ao longo de várias
rodadas): a 160 m de distância, nenhuma arma do arsenal alcança, e a IA
atiraria para o vazio a partida inteira. Ensinar a IA a andar até ficar a
uma distância boa é o próximo passo natural.

## Como funciona

Compartilha com o Minhocas o terreno em máscara de bits, a física de projétil
com colisão varrida, a curva de dano e a máquina de turnos — nada disso foi
reescrito, só reduzido e adaptado. O que é novo:

- **`js/frente/ai.js`** — a IA descrita acima (puro, testado).
- **`js/frente/soldado.js`** — o mesmo movimento do `worm.js` original
  (andar com degrau, pulo, queda, colisão por sonda de 5 pontos), com o
  desenho trocado de minhoca para soldado.
- **A barra de controles de toque** (`#battle-controls`, em
  `css/style.css`) — o Minhocas original só tinha teclado para andar, pular
  e trocar de arma; no toque só dava para carregar e soltar o tiro.

```
linha-de-frente/index.html   página e canvas
linha-de-frente/css/style.css  controles de toque + o que o Arqueiro não tem
js/engine/                   COMPARTILHADO com o Arqueiro e o Minhocas
js/frente/mask.js            máscara do terreno            (puro, testado)
js/frente/terrain-gen.js     geração por semente           (puro, testado)
js/frente/terrain.js         mundo em metros + render em blocos
js/frente/ballistics.js      integração e colisão varrida  (puro, testado)
js/frente/damage.js          dano e empurrão               (puro, testado)
js/frente/soldado.js         estados e desenho do soldado  (movimento testado)
js/frente/turn.js            máquina de turnos             (puro, testado)
js/frente/weapons.js         a tabela de armas             (dados, testado)
js/frente/ai.js              decisão de tiro da IA         (puro, testado)
js/frente/projectile.js      execução dos tipos de arma
js/frente/match.js           junta tudo: mundo, equipes, turnos, IA
js/frente/ui/                HUD no canvas, telas no DOM
```

## Testes

```bash
node --test        # ou: npm test
```

Cobrem o gerador com semente, as primitivas da máscara, a geração do mapa, a
balística, a curva de dano, a tabela de armas, o movimento do soldado, a
máquina de turnos e a IA — tanto em terreno sintético (`ai.test.js`) quanto
dentro de uma partida de verdade (`ia-integracao.test.js`, que teria pegado
o bug do mapa largo descrito acima).

## O que ainda não existe

A IA não anda até o alvo. Faltam também o restante do arsenal do Minhocas
(ataque aéreo, caixas de paraquedas, corda ninja, jetpack, teleporte) e
replays. O desenho original de tudo isso está em
[`docs/PLANO-TRINCHEIRA.md`](https://github.com/KT3746/Claude/blob/main/docs/PLANO-TRINCHEIRA.md)
no repositório `Claude`, de onde este jogo foi portado.
