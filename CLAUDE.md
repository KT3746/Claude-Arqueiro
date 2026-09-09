# Arqueiro — contexto do projeto

Jogo de arco e flecha em HTML5 Canvas, em português. Estático: **sem build, sem
dependências, sem `npm install`**. Publicado no GitHub Pages via GitHub Actions.

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
python3 -m http.server 8000   # abre em http://localhost:8000
node --test                   # 22 testes, runner nativo do Node, sem instalar nada
```

`js/game/physics.js` e `js/game/scoring.js` são funções puras sem DOM — por isso
dá para testá-las no runner nativo. O resto se testa dirigindo o jogo num
navegador real.

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

**Um segundo jogo (Linha de Frente) foi tentado e removido em 2026-09-09.**
Era um port do jogo Minhocas (artilharia por turnos, terreno destrutível,
IA própria) para `/linha-de-frente/`, com link no menu do Arqueiro. O
usuário jogou o Worms de verdade, achou que era "uma cópia mal feita dele"
com bugs (times sem cores distintas o bastante, força do tiro difícil de
controlar, tiros acertando o próprio jogador — provavelmente o soldado
nascendo com a direção sempre voltada para a direita, `direcao: 1` fixo em
`createSoldado`, sem virar automaticamente para o lado do inimigo), e pediu
para não manter dois jogos pela metade — só o Arqueiro, funcionando bem.
**Não tente reintroduzir isso** a menos que o usuário peça de novo
explicitamente; se pedir, o código-fonte original (motor completo e
testado) continua disponível no repositório `Claude`, em `js/minhocas/`.
