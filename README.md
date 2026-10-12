# Shopee Ads AI

App que transforma o link de um produto da Shopee numa publicação pronta
para redes sociais: texto persuasivo (título, legenda WhatsApp, legenda
Instagram, CTA, versão alternativa) + arte promocional com a foto real do
produto, em 3 formatos, com link de afiliado.

Backend em Node.js + Express. Frontend em `public/index.html` (React
pré-compilado, sem build step nem Babel no navegador — servidos juntos no
mesmo endereço, sem CORS).

---

## Diagnóstico desta rodada (antes de mexer em qualquer coisa)

O que já estava funcionando de verdade:
- Busca de produto real via API oficial de afiliados da Shopee (GraphQL +
  HMAC-SHA256), com scraping como reserva.
- Histórico e dashboard (dados reais, em arquivos `.json`).
- Compartilhamento real para WhatsApp/Telegram/Facebook.

O que estava mockado:
- Todo o texto gerado (`aiService.js` era 100% template fixo).
- Link de afiliado (mock `?af_id=MOCK123` quando sem credenciais).

**A causa raiz de "a imagem não aparece automaticamente"**: a arte era só um
`<svg>` montado e renderizado **no navegador da pessoa**, que tentava
carregar a foto do produto via um proxy de imagem restrito a domínios
`shopee`/`susercontent`. Quando a foto não carregava (CDN bloqueando,
domínio diferente, link manual colado de outro lugar), a arte ficava sem
foto nenhuma e sem aviso — e em pelo menos um caso observado, a própria API
de afiliados devolveu uma foto genérica de catálogo (não há nada a corrigir
no código nesse caso específico: é limitação de dado da Shopee para aquele
produto).

## O que foi corrigido/implementado nesta rodada

1. **Geração de arte agora é 100% no servidor** (`src/services/artRenderService.js`,
   usando [Sharp](https://sharp.pixelplumbing.com/)). O backend monta a arte
   (SVG com preço/título/desconto exatos, sem IA "desenhando" números) e
   embute a foto real já nos bytes do PNG final, em memória (nenhum arquivo
   fica salvo em disco). O frontend só exibe/baixa o PNG pronto — isso
   elimina de vez o problema de "a foto não carrega depois", porque ela já
   está dentro da imagem quando chega ao navegador.
2. **3 formatos**: Stories (1080×1920), Feed vertical (1080×1350), Quadrado
   (1080×1080) — selecionáveis antes/depois de gerar, sem precisar colar o
   link de novo.
3. **4 templates renomeados** conforme pedido: `OFERTA`, `ELEGANTE`,
   `MODERNO`, `VIRAL`.
4. **Busca de foto real com prioridade e fallback honesto**
   (`src/services/imageService.js`): 1) imagem da API de afiliados → 2)
   `og:image` da página pública do produto → 3) upload/link manual da
   pessoa. Quando nenhuma das três funciona, a arte é desenhada **sem foto**,
   com um aviso visual — nunca uma imagem genérica fingindo ser a do
   produto.
5. **Proteção SSRF real** (`src/services/ssrfGuard.js`): qualquer URL de
   imagem (da API, da página, ou colada manualmente) tem o protocolo e o
   IP resolvido validados antes de qualquer requisição, bloqueando
   localhost/rede interna/metadados de nuvem — inclusive revalidando a
   cada redirecionamento (contra DNS rebinding). `/api/image-proxy` deixou
   de restringir por lista de domínios (o que quebrava a função de colar
   foto manual de outro lugar) e passou a usar essa validação de verdade.
6. **Textos completos** (`src/services/aiService.js`): título curto, legenda
   WhatsApp, legenda Instagram, CTA e versão alternativa — nunca inventando
   desconto/estoque/"menor preço do Brasil" além do que veio nos dados reais
   do produto. Se `ANTHROPIC_API_KEY` estiver configurada, usa IA real
   (Claude); sem ela, usa um gerador por template, sempre identificado como
   tal (campo `source: "mock"` na resposta, mostrado também na tela).
7. **Link de afiliado**: nunca mais sobrescrito silenciosamente. Se o link
   colado já parecer de afiliado, é preservado; senão, tenta gerar um real
   (com credenciais); sem credenciais, devolve o link original **com aviso
   explícito** de que pode não gerar comissão.
8. **Segurança/robustez do backend**: rate limiting (sem dependência
   externa — `src/middleware/rateLimit.js`), limite de tamanho de
   upload/JSON (12 MB), tratamento de erro global + 404 de API, timeouts em
   todas as chamadas externas, CORS configurável via `ALLOWED_ORIGIN`.
9. **Frontend atualizado** (`app-src.tsx`, compilado para `public/index.html`):
   seletor de formato e template, preview da arte vinda do backend, campos
   de legenda (WhatsApp/Instagram/Alternativa) com cópia individual, botão
   de WhatsApp direto, botão de copiar link de afiliado, aviso de link não
   confirmado como afiliado, loading com etapas reais (ligadas às respostas
   de rede, não mais um timer simulado).
10. Removido o arquivo `productService.js` duplicado que estava solto na raiz
    do repositório (sobra de um upload anterior para a pasta errada do
    GitHub) — o arquivo correto é só `src/services/productService.js`.

## O que continua precisando de você / de credenciais externas

- **Texto com IA real**: funciona assim que `ANTHROPIC_API_KEY` for
  preenchida no Render. Sem ela, os textos continuam sendo gerados por
  template (claramente identificado na tela, nunca passado como IA real).
- **Produto/foto real via API oficial**: já implementado e, segundo seu
  retorno anterior, já funcionou com suas credenciais (`SHOPEE_AFFILIATE_APP_ID`/
  `SHOPEE_AFFILIATE_SECRET`). Quando a própria Shopee não tem foto real
  cadastrada para um produto no catálogo de afiliados, nenhum código
  resolve isso — use o upload manual ou o link de outra foto.
- **Persistência de dados no Render free tier**: o disco do plano free
  **não é permanente** — ele é recriado a cada deploy/restart, então
  `data/*.json` (histórico, dashboard) pode ser perdido nesses momentos.
  Isso não foi alterado nesta rodada porque corrigir de verdade exige um
  banco externo (ex.: um Postgres gratuito no próprio Render, ou Supabase) —
  decisão que vale conversarmos antes de eu trocar a camada de dados.
- **Multi-afiliado (vender a ferramenta pra outras pessoas usarem o próprio
  ID)**: segue como estava, fora do escopo desta rodada (conversa anterior
  ficou em aberto).

## Publicação automática no Instagram

O site agora pode buscar produtos em alta na Shopee, montar a arte + legenda com seu link de afiliado e publicar no Instagram pela **API oficial da Meta**, respeitando limites de quantidade.

### Regras de quantidade (todas valem ao mesmo tempo)
1. Máximo de posts em 24h (janela móvel) — padrão 3, teto fixo de 25.
2. Intervalo mínimo entre posts — padrão 4h.
3. Só posta dentro do horário permitido — padrão 8h às 22h (fuso de São Paulo).
4. Antes de cada post consulta a **cota real da Meta** (`content_publishing_limit`); se não conseguir consultar, não posta.
5. Nunca posta sem foto real do produto nem sem link de afiliado confirmado.
6. Por padrão (`AUTOMATION_MODE=approval`) só sai o que você **aprovar** na aba Instagram. Para postar 100% sozinho, mude para `auto`.

### O que você precisa configurar (uma vez)
1. **Conta**: Instagram profissional (Comercial ou Criador), ligada a uma Página do Facebook (se usar Facebook Login).
2. **App na Meta**: em developers.facebook.com crie um app, adicione o produto "Instagram" e as permissões `instagram_basic`, `instagram_content_publish` e `pages_read_engagement` (ou `instagram_business_basic` + `instagram_business_content_publish` com Instagram Login). Enquanto o app está em modo desenvolvimento, funciona para contas que são administradoras/testadoras do app.
3. **Token de longa duração** e o **IG_USER_ID** (id numérico da conta profissional). Coloque em `IG_ACCESS_TOKEN` e `IG_USER_ID` no Render (Environment). **O token expira (~60 dias)** — quando o painel mostrar "Token expirado", gere outro e atualize.
4. No Render, defina também `ADMIN_PASSWORD` (escolha uma senha forte), `CRON_SECRET` (um texto aleatório longo) e `PUBLIC_BASE_URL` (ex.: `https://shopee-ads-ai.onrender.com`).
5. **Agendador**: o plano grátis do Render dorme sem visitas. Crie uma tarefa em cron-job.org que a cada 30 min faça `POST https://SEU-SITE.onrender.com/api/automation/tick` com o header `x-cron-secret: SEU_CRON_SECRET`. Cada chamada publica no máximo 1 post.

### Limitações importantes
- **Link na legenda do Instagram não é clicável.** A legenda avisa isso; coloque seu link de afiliado na bio.
- **Render grátis apaga os arquivos** a cada deploy/restart: fila, ajustes salvos na tela e histórico de posts somem. A cota real da Meta continua sendo consultada, então o limite não é burlado, mas para guardar a fila é preciso um banco externo (não implementado).
- A consulta de "produtos em alta" usa campos da API de afiliados da Shopee que **não foram confirmados com credenciais reais**; se a Shopee recusar, o erro aparece no painel e o log do servidor mostra os argumentos aceitos.
- A integração com a Meta foi testada apenas com respostas simuladas; o primeiro post real deve ser feito manualmente pelo botão "Publicar agora" para conferir.
- Publicar automaticamente em conta de afiliado deve seguir as regras da Shopee e da Meta (identificação de publicidade). Revise as políticas antes de ligar o modo `auto`.

### Rotas (todas exigem `x-admin-password`, exceto `tick` com `x-cron-secret` e a imagem temporária)
`GET /api/trending`, `GET /api/automation/status`, `PUT /api/automation/settings`, `POST /api/automation/tick`, `GET/POST /api/queue`, `PATCH /api/queue/:id`, `POST /api/queue/:id/approve|reject|publish`, `GET /api/queue/:id/preview`, `GET /api/public-image/:token.jpg`.

### Testes
`npm test` (Node 22+): regras de quantidade, publicação com Graph API simulada, autenticação.

## Como rodar localmente

```bash
cd shopee-ads-ai
copy .env.example .env      # no Mac/Linux use: cp .env.example .env
npm install
npm run dev
```

Abra **http://localhost:3333** numa aba normal do navegador.

## Variáveis de ambiente (`.env`)

| Variável | Obrigatória? | O que faz |
|---|---|---|
| `PORT` | não (padrão 3333) | porta do servidor — no Render é definida automaticamente, não mexa |
| `DATA_DIR` | não (padrão `./data`) | pasta onde ficam os arquivos `.json` de histórico/dashboard |
| `SHOPEE_AFFILIATE_APP_ID` / `SHOPEE_AFFILIATE_SECRET` | não | credenciais da API oficial de afiliados — sem elas, cai para scraping público e link original |
| `ANTHROPIC_API_KEY` | não | ativa textos gerados por IA real — sem ela, usa gerador por template |
| `ALLOWED_ORIGIN` | não | restringe CORS a um domínio específico; vazio = aceita qualquer origem |

## Configuração no Render

1. **Build command**: `npm install`
2. **Start command**: `npm start`
3. Em "Environment", adicione as variáveis da tabela acima que você tiver
   (todas são opcionais — o app funciona em modo mock sem nenhuma delas,
   só com menos coisas reais).
4. O servidor já usa `process.env.PORT` e faz bind em todas as interfaces
   por padrão do Express — compatível com o Render sem ajuste nenhum.
5. Nenhuma dependência de navegador headless (Playwright/Puppeteer) é usada
   — só `fetch` nativo do Node e `sharp` (que instala binários próprios
   automaticamente durante o `npm install`, sem precisar de nada extra no
   Render).

## Estrutura

```
public/
  index.html               # frontend completo (React pré-compilado)
app-src.tsx                # fonte editável do frontend (compile com tsc, ver abaixo)
src/
  server.js                # Express: API em /api/* + frontend estático
  middleware/
    rateLimit.js            # rate limiting simples, sem dependência externa
  db/                       # armazenamento em arquivos .json
  services/
    productService.js       # API oficial de afiliados + scraping (reserva)
    aiService.js             # textos completos — IA real (opcional) ou template
    affiliateService.js      # preserva/gera/avisa sobre o link de afiliado
    shopeeAffiliateClient.js # cliente HMAC-SHA256 compartilhado da API Shopee
    imageService.js          # busca da foto real (API -> og:image -> manual), com SSRF guard
    ssrfGuard.js              # validação de URL/IP contra SSRF
    artRenderService.js       # composição da arte final em PNG (Sharp), 4 templates x 3 formatos
    publishService.js         # WhatsApp/Telegram/Facebook reais; IG via navegador; TikTok pendente
  routes/
    generate.js               # /api/generate, /api/generate/text, /api/generate/art
    ads.js
    dashboard.js
    imageProxy.js              # proxy de imagem para o frontend (com SSRF guard)
```

### Editando o frontend

O HTML final (`public/index.html`) tem o React já compilado embutido. Para
alterar a interface, edite `app-src.tsx` e recompile:

```bash
npx tsc app-src.tsx --jsx react --target es2018 --lib dom,es2018,dom.iterable --outDir build --skipLibCheck
```

Isso gera `build/app-src.js` — copie o conteúdo para dentro da tag
`<script>` em `public/index.html` (substituindo o script atual).

## Testes realizados nesta rodada

Como este ambiente não tem acesso à internet da Shopee (nem a nenhum site
externo arbitrário), os testes abaixo foram feitos com o **servidor real
rodando** (`node src/server.js`) e produtos de exemplo — não foi possível
testar contra a Shopee ao vivo nem contra a API da Anthropic (sem chave
configurada aqui). Tudo que segue foi de fato executado, não é só leitura
de código:

| Item do checklist | Resultado |
|---|---|
| Backend sobe sem erro (`npm run dev`) | ✅ testado |
| `/api/health` responde | ✅ testado |
| Validação de link inválido | ✅ testado (`400` com mensagem clara) |
| Geração de arte nos 3 formatos | ✅ testado — PNG real conferido visualmente (1080×1080, 1080×1350, 1080×1920) |
| Geração de arte nos 4 templates | ✅ testado — OFERTA, ELEGANTE, MODERNO, VIRAL, conferidos visualmente |
| Upload manual de foto (base64) → aparece na arte | ✅ testado |
| Produto sem foto nenhuma → desenha sem foto, não finge | ✅ testado |
| Proteção SSRF (link apontando pra rede interna) | ✅ testado — bloqueado com erro claro, tanto no `/api/generate/art` quanto no `/api/image-proxy` |
| Geração de texto (mock) nos 5 estilos | ✅ testado |
| Salvar anúncio / editar / publicar (WhatsApp) | ✅ testado |
| Publicar em plataforma indisponível (TikTok) | ✅ testado — erro claro, não finge sucesso |
| Dashboard reflete dados reais salvos | ✅ testado |
| Rate limiting | ✅ testado — `429` após o limite |
| Integração real com a Shopee (produto/afiliado) | ⏳ não testável aqui — depende das suas credenciais reais e de acesso à internet da Shopee. Já funcionou antes segundo seu retorno; a lógica não mudou, só a foto/link ganharam mais fallback |
| Integração real com IA (Anthropic) | ⏳ não testável aqui — sem `ANTHROPIC_API_KEY` configurada neste ambiente. O código está pronto; preencha a chave no Render e teste |
| Compartilhamento nativo no celular (Instagram) | ⏳ depende de testar num celular de verdade — a lógica é a mesma de antes (Web Share API), só passou a usar o PNG que já vem pronto do servidor em vez de montado no navegador |

## Endpoints principais

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | status do backend |
| POST | `/api/generate` | busca produto real + gera texto + trata link de afiliado |
| POST | `/api/generate/text` | regenera só o texto, com outro estilo |
| POST | `/api/generate/art` | gera a arte final (PNG) — template, formato e foto manual opcional |
| GET | `/api/ads` | histórico ("Meus anúncios") |
| POST | `/api/ads` | salva um anúncio gerado |
| PATCH | `/api/ads/:id` | edita um anúncio salvo |
| GET | `/api/ads/publish/platforms` | lista plataformas e quais já funcionam |
| POST | `/api/ads/:id/publish` | registra publicação e devolve link de compartilhamento |
| GET | `/api/dashboard` | métricas reais (nada inventado) |
| GET | `/api/image-proxy?url=` | busca uma imagem com proteção SSRF (usado pelo preview do frontend) |

## Próximos passos sugeridos

1. Preencher `ANTHROPIC_API_KEY` no Render para ativar textos com IA real.
2. Testar o fluxo completo com um link real da Shopee (produto + foto +
   link de afiliado) e me mandar o resultado — principalmente se a foto
   real aparecer agora nos casos em que antes vinha genérica.
3. Decidir sobre persistência de dados (manter como está, sabendo do risco
   no plano free, ou migrar para um banco externo).
4. Testar o compartilhamento nativo (Instagram) num celular de verdade.
