# Arqueiro — contexto do projeto

Dois jogos em HTML5 Canvas, em português, compartilhando o motor em
`js/engine/`. Estático: **sem build, sem dependências, sem `npm install`**.
Publicado no GitHub Pages via GitHub Actions.

- **Arqueiro** (raiz, `/`) — arco e flecha, 12 níveis. O jogo original deste
  repositório; a seção "Arquitetura" abaixo é sobre ele.
- **Linha de Frente** (`/linha-de-frente/`) — artilharia militar por turnos
  contra uma IA, terreno destrutível de verdade. Ver a seção própria mais
  abaixo, e `linha-de-frente/README.md` para detalhes de jogo.

Os dois têm um link um para o outro no respectivo menu principal.

**Atenção: o usuário renomeia e transfere o repositório com frequência.** O
jogo já viveu em `desktop-tutorial`, depois `Arco-e-Flecha`, depois `Claude`
(id interno **1342942892**, onde ele dividia espaço com o jogo Minhocas em
`/minhocas/`). Em 2026-09-08 o Arqueiro foi extraído para este repositório
dedicado, **`Claude-Arqueiro`** (id interno **1361028025**), deixando para
trás o código do Minhocas e o `docs/PLANO-TRINCHEIRA.md`. Renomear ou trocar
de repositório muda o endereço do jogo (`https://kt3746.github.io/<nome-atual>/`)
e derruba o link antigo — se ele disser que o jogo abre mas não responde a
cliques, **a primeira suspeita é que ele está num link antigo**, com o
navegador mostrando uma cópia em cache da tela sem o JavaScript. Confirme o
nome atual antes de passar qualquer link, e pegue o endereço real do último
deploy em `GET /repos/{owner}/{repo}/deployments/{id}/statuses` →
`environment_url`.

O usuário é **iniciante em programação e usa celular Android**. Explique em
português, sem jargão, e prefira fazer a ação a mandar ele fazer — só peça
quando for algo que exige o painel web do GitHub (configurações do
repositório), que nenhuma ferramenta alcança.

## Como rodar e testar

```bash
python3 -m http.server 8000   # abre em http://localhost:8000, ou /linha-de-frente/
node --test                   # 132 testes, runner nativo do Node, sem instalar nada
```

Os módulos de física/pontuação (Arqueiro) e terreno/balística/turnos/IA
(Linha de Frente) são funções puras sem DOM — por isso dá para testá-los no
runner nativo. O resto se testa dirigindo o jogo num navegador real.

**Chromium para testes de navegador**: já instalado em
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Instale o Playwright no
diretório de rascunho (`npm install playwright --no-save`) e passe
`executablePath` apontando para esse caminho — não rode `playwright install`.

**Lição aprendida, importante**: testes com clique de *mouse* NÃO pegam bugs de
*toque*. Um bug real (nenhum botão respondia no celular) passou por vários
testes de mouse. Para qualquer coisa de interface, teste com toque de verdade:
`browser.newPage({ ...devices['Pixel 5'] })` e `page.touchscreen.tap()`, ou
eventos de toque de baixo nível via `Input.dispatchTouchEvent` (CDP) para
arrastar.

## Arquitetura

```
index.html            página e canvas
css/style.css         casca e telas de interface
js/main.js            liga tudo: canvas, entrada, loop, telas; expõe window.__game (depuração)
js/engine/loop.js     loop de passo fixo (beginFrame → step* → render → endFrame)
js/engine/input.js    mouse/toque/teclado unificados num "pointer" + ações
js/engine/camera.js   mundo (metros, y para cima) ↔ tela (pixels, y para baixo)
js/engine/{audio,particles,storage}.js
js/game/physics.js    integração da flecha (gravidade, arrasto, vento)   [PURO, testado]
js/game/scoring.js    anéis, X, combo, estrelas                          [PURO, testado]
js/game/level.js      máquina de estados: aiming → flying → settling → finished
js/game/levels.js     os 12 níveis, em tabela declarativa
js/game/{arrow,bow,target,scenery}.js
js/ui/hud.js          HUD desenhado no canvas (pontos, vento, luneta)
js/ui/screens.js      menus como elementos do DOM (acessíveis por teclado)
tests/                testes do runner nativo do Node
```

Decisões que não são óbvias:

- **Velocidade da flecha 16–46 m/s** (`bow.js`), não os ~60 m/s reais: na
  velocidade real a trajetória fica quase reta nessas distâncias e a mira perde
  a graça.
- **Colisão testa o segmento percorrido no passo**, não a posição final — sem
  isso a flecha atravessa o alvo entre dois quadros.
- **O vento age sobre a velocidade relativa ao ar**, então vento de cauda e de
  frente saem do mesmo cálculo, sem regra extra.
- `arrow.stop()` zera `vx`/`vy`, então o ângulo do impacto é congelado em
  `finalHeading` antes disso — o getter `heading` leria `atan2(0,0) = 0`.
- Em `input.js`, `onUp` só chama `preventDefault()` quando encerra um arrasto
  **nosso** (`pointer.down` era true). Cancelar um `touchend` qualquer suprime o
  `click` sintético do navegador e mata todos os botões da interface no celular.
- **O arrasto ancora onde o dedo tocou** (`bow.dragOrigin`), não na posição do
  arco. Ancorar no arco obrigava a tocar atrás do arqueiro — no celular quase
  não há espaço ali, e a mão tapava o que precisava ser visto.
- A âncora vem de `input.pointer.start` (onde o toque começou), não da posição
  atual: quem começa a puxar enquanto a flecha anterior ainda voa perderia o
  caminho já percorrido, e o puxão sairia mais fraco que o gesto.
- A distância de força máxima acompanha a tela (`fullDrawPx`, 34% do menor
  lado, entre 92 e 190 px). Fixo em 190 px, um celular em pé não alcançava a
  força total. Puxar **além** do anel não aumenta a força, mas afina o ângulo
  (1 px de dedo vale menos grau quanto mais longe) — é o modo de mira fina.
- Soltar sem ter passado da folga de 12 px **não dispara**: é como desistir do
  tiro sem gastar flecha.
- A janela de acerto é estreita por física: a 30 m, meio grau já joga a flecha
  para fora do alvo (é o arrasto forte que faz a altura mudar ~0,5 m por grau).
  Daí os botões de ajuste fino (`#aim-pad`, meio grau e 2% por toque) e a
  leitura de ângulo/força junto ao arco — sem eles, não dá para repetir um
  tiro que deu certo.
- Elementos do DOM ficam por cima do canvas: `drawHint` reserva a coluna da
  luneta à esquerda (`SCOPE_SPACE`) e a do botão de pausa à direita
  (`PAUSE_SPACE`), e quebra o texto em linhas — sem isso as dicas longas saíam
  cortadas dos dois lados no celular em pé.

## Linha de Frente — arquitetura

Port sério e reduzido do jogo **Minhocas**, que ficou no repositório `Claude`
(`js/minhocas/`, `docs/PLANO-TRINCHEIRA.md`) quando o Arqueiro foi extraído.
Trazido para cá em 2026-09-08, a pedido do usuário ("gostei desse tipo de
jogo... tipo canhão, com 2 adversários, sendo um IA... mais sério, com armas
militares").

```
linha-de-frente/index.html    página, canvas e a barra de controles de toque
linha-de-frente/css/style.css controles de toque + o que o Arqueiro não tem (seletor, campo, tabela, placar)
js/frente/mask.js             máscara do terreno (1 byte/pixel)          [PURO, testado]
js/frente/terrain-gen.js      geração do mapa por semente                [PURO, testado]
js/frente/terrain.js          mundo em metros + render em blocos sujos
js/frente/ballistics.js       integração e colisão varrida               [PURO, testado]
js/frente/damage.js           curva de dano e empurrão                   [PURO, testado]
js/frente/turn.js             máquina de turnos                          [PURO, testado]
js/frente/weapons.js          a tabela de armas (9, ver README do jogo)  [dados, testado]
js/frente/soldado.js          movimento (andar/pular/queda) + desenho    [movimento testado]
js/frente/ai.js               decisão de tiro da IA                      [PURO, testado]
js/frente/projectile.js       execução dos tipos de arma
js/frente/match.js            junta tudo: mundo, equipes, turnos, IA
js/frente/ui/                 HUD no canvas, telas no DOM
```

O que veio **verbatim** do Minhocas (mesma lógica, sem alteração): mask.js,
terrain-gen.js, terrain.js, ballistics.js, damage.js, turn.js,
`js/engine/{rng,chunks}.js` (novos no motor compartilhado). `soldado.js` é
`worm.js` com o desenho trocado (farda + capacete militar em vez de olhos e
capacete arredondado); as funções de movimento/colisão são idênticas e
continuam cobertas por `tests/soldado-move.test.js` (port de
`worm-move.test.js`).

O que foi **cortado** do arsenal original (14 armas → 9) por não ser sério o
bastante para um confronto militar: ovelha, escopeta, corda ninja, jetpack,
teleporte. Cortar os quatro últimos também tirou de `match.js` toda a lógica
de utilitário (~150 linhas) — nenhuma perda funcional, só simplificação.

O que é **novo**, sem equivalente no Minhocas:

- **`js/frente/ai.js`** — a IA não existia no jogo original (ele só tinha
  "2 jogadores no mesmo teclado"). Ela nunca lê atalho nenhum do estado:
  recebe a mesma informação que o HUD mostra (posição, vida, vento) e
  devolve uma decisão (ângulo, força, arma) via busca em duas fases —
  varredura grossa + refinamento local — sobre a física de verdade do jogo
  (`avancar`, de `ballistics.js`). Como a busca já simula contra o terreno,
  uma colina bloqueando a linha reta reprova sozinha as armas que bateriam
  nela; não há regra escrita à mão de "se bloqueado, use o morteiro". A
  dificuldade soma um erro angular *depois* da busca, não piora a busca.
- **`estado.ia` em `match.js`** (`iniciarTurnoDaIA`/`atualizarIA`) — o
  "condutor" que aperta os mesmos `comandos` que um humano apertaria
  (virar, mirar aos poucos, carregar, disparar quando a carga bate no alvo),
  turno a turno. Nunca dispara nada por fora do fluxo normal.
- **A barra de controles de toque** (`#battle-controls`) — o Minhocas
  original só tinha teclado para andar, pular e trocar de arma; no toque só
  dava para carregar/soltar o tiro (igual ao bug do Arqueiro antes da mira
  ser refeita). Só aparece com `pointer: coarse` — some sozinha com mouse.

Decisões que não são óbvias:

- **`LARGURA_MAPA_DUELO = 1700` px (85 m)**, não os 3200 px (160 m) do
  Minhocas original — achado testando de verdade, não no papel: o mapa do
  Minhocas é pensado para várias equipes que se aproximam ANDANDO ao longo
  de várias rodadas. Num duelo 1×1, `escolherNascimentos` (que maximiza a
  distância entre nascimentos de propósito) colocava os dois lados a
  80–150 m um do outro — e a bazuca, a arma de maior alcance do arsenal, não
  passa de ~64 m na força máxima. Como a IA ainda não anda até o alvo
  (abaixo), ela atirava para o vazio a partida inteira, sempre. Um fuzz de
  12 sementes no mapa largo deu **0/12 acertos** da IA em dificuldade
  difícil (erro de mira quase zero); encolhendo o mapa, **10/12**. É
  exatamente o tipo de bug que só aparece jogando, não lendo o código — daí
  `tests/ia-integracao.test.js` existir: ele roda `match.js` de ponta a
  ponta (mapa gerado de verdade, não terreno sintético) e teria pego isso.
- **A IA não anda até o alvo.** É a limitação mais visível desta primeira
  versão — decidir para onde andar, num terreno que muda a cada tiro, é um
  problema por si só. O mapa estreito acima é o que torna essa limitação
  jogável em vez de quebrada.
- **`atualizarIA` é chamado de dentro de `update(dt)`**, incondicionalmente
  a cada quadro, e ele mesmo decide se há algo a fazer (`estado.ia` só existe
  no turno de um time com `ia` configurada). `main.js` só evita que o
  **humano** controle o soldado errado (`emTurnoHumano()` antes de ler
  teclado/toque) — a IA nunca precisa dessa guarda porque só age quando é
  literalmente a vez dela.
- **`RESERVA_CONTROLES = 190` em `hud.js`** — a barra de controles de toque
  fica por cima do canvas; sem essa reserva de espaço, os blocos de
  vento/arma e o rodapé de dicas (que na tela estreita descem para o
  rodapé, decisão herdada do Minhocas) ficavam ilegíveis atrás dos botões.
- Assim como no Arqueiro, `#pause-button` precisou descer (`top: 96px` em
  `linha-de-frente/css/style.css`) para não brigar com a caixa do relógio,
  que aqui ocupa o canto superior direito.

## Fluxo de trabalho

- Desenvolva numa branch `claude/...`, abra PR, espere o CI (`node --test`)
  ficar verde, e mergeie. O usuário já autorizou esse fluxo várias vezes.
- Todo push na `main` publica no GitHub Pages automaticamente.
- `.github/workflows/pages.yml` verifica se o Pages está habilitado antes de
  tentar publicar, e sai com sucesso (deixando um `::notice`) se não estiver —
  o token do workflow não tem permissão para habilitar o Pages sozinho.
- Verifique de verdade antes de afirmar que funciona: rode os testes, dirija o
  jogo no navegador, confira o resultado real do deploy pela API do GitHub.
  A rede desta sandbox **bloqueia `github.io`**, então não dá para abrir o site
  publicado daqui — confirme pelo `deployments/{id}/statuses` da API.

## Estado atual

Jogo completo: 12 níveis, modo prática, progresso salvo, vento, alvos
móveis, obstáculos, balões de bônus, luneta, som sintetizado. Código e
histórico de decisões trazidos do repositório `Claude` sem alterações de
lógica — só a extração para este repositório dedicado.

Em 2026-09-08 o controle de mira foi refeito, depois de o usuário dizer que
"tá difícil de puxar a flecha e mirar" no celular: arrasto ancorado no dedo
(em qualquer ponto da tela), distância de força máxima proporcional à tela,
guia do puxão desenhada sob o dedo, cancelamento do tiro, botões de ajuste
fino e leitura de ângulo/força. Verificado com toque real (Pixel 5, CDP):
força total alcançável, cancelamento sem gastar flecha, botões de interface
ainda respondendo e alvo acertado usando só os botões de ajuste.

Bugs já corrigidos (no repositório anterior): ângulo da flecha cravada,
arrasto perdido ao segurar o clique entre estados, botão errado na vitória do
último nível, e o toque que não respondia em nenhum botão.

**GitHub Pages habilitado em 2026-09-08.** O usuário habilitou manualmente
(`Settings → Pages → Build and deployment → Source → GitHub Actions`) e o
workflow `pages.yml` já publicou com sucesso — jogo em
`https://kt3746.github.io/Claude-Arqueiro/`. Confirmado pelo log do job
"Publicar" (run 34198118365): passou pelo `actions/deploy-pages@v4` de
verdade, com "Reported success!" e `environment_url` batendo com esse
endereço — não é mais o caso de saída antecipada por Pages desabilitado.
Não há pendência aberta no momento; a próxima sessão deve tratar isto como
"jogo publicado e funcionando" e só reabrir a suspeita de link antigo/cache
se o usuário disser que o jogo não responde.

**Linha de Frente, adicionado em 2026-09-08** (mesma sessão): artilharia
militar por turnos, 1×1 contra a IA (extensível a 2×2/3×3 via "soldados por
unidade"), terreno destrutível de verdade (máscara de bits, port do
Minhocas), 9 armas, água e morte súbita, dificuldade da IA selecionável.
Verificado de ponta a ponta com toque real (Pixel 5, CDP): andar, pular,
mirar, trocar de arma e atirar pelos botões em tela; um turno completo da
IA (pensa → mira → carrega → dispara) observado ao vivo; tela de vitória
correta; os dois links do saguão (Arqueiro ↔ Linha de Frente) navegando nos
dois sentidos. 132 testes (`node --test`) passando, incluindo um teste de
integração que roda a partida inteira (não só a IA em terreno sintético) —
foi ele (bem, a versão manual dele, rodada antes de virar teste) que achou o
bug do mapa largo descrito acima.

**Pendência real, não de escopo:** a IA não anda até o alvo — só mira e
atira de onde nasce. Funciona bem no mapa estreito atual (85 m, dentro do
alcance do arsenal), mas é a limitação mais visível do jogo. Também ficaram
de fora, por corte deliberado de escopo (não são bug): o restante do
arsenal do Minhocas (corda ninja, jetpack, teleporte, ovelha, escopeta,
ataque aéreo, caixas de paraquedas) e replays.
