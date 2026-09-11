# Shopee Ads AI (v2 — scraping real de produto)

App completo rodando localmente: backend em Node.js + Express, front em
`public/index.html` (React já pré-compilado, sem build step nem Babel no
navegador), servidos juntos no mesmo endereço.

## Novidade desta versão

`productService.fetchProduct` agora tenta buscar o produto de verdade
fazendo scraping da página pública da Shopee (título, imagem, descrição via
tags Open Graph / JSON-LD; preço via heurística no HTML). **Isso é
melhor-esforço**: a Shopee pode bloquear acessos automatizados, exigir
captcha, ou mudar a estrutura da página a qualquer momento. Quando isso
acontece, o backend devolve um erro claro (aparece na tela) em vez de fingir
que funcionou.

O texto de IA e o link de afiliado **continuam mockados**.

## Como rodar

```bash
cd backend
copy .env.example .env      # no Mac/Linux use: cp .env.example .env
npm install
npm run dev
```

Abra **http://localhost:3333** numa aba normal do navegador.

## Testando o scraping

Cole um link real de produto da Shopee (não um link de busca, tem que ser a
página de um produto específico) e clique em "Gerar anúncio". Três cenários
possíveis:

1. **Funcionou** — o título, imagem e preço batem com o produto real. 🎉
2. **Erro claro na tela** (ex: "A Shopee bloqueou esta tentativa...") — a
   proteção antibot da Shopee entrou em ação. Me avise qual mensagem
   apareceu para ajustarmos.
3. **Dados incompletos** (ex: preço não aparece, mas título e imagem sim) —
   a heurística de preço não encontrou o padrão esperado nesse layout de
   página. Também me avise para eu ajustar a extração.

Se quiser voltar a usar dados mockados enquanto ajustamos o scraping, troque
`fetchProduct` por `fetchProductMock` dentro de
`src/routes/generate.js` e `src/routes/ads.js` temporariamente (ainda não
temos uma variável de ambiente pra isso — é código, não configuração).

## Estrutura

```
public/
  index.html            # front completo (React pré-compilado)
src/
  server.js              # Express: serve a API em /api/* e o front estático
  db/                     # armazenamento em arquivos .json
  services/
    productService.js    # SCRAPING real (novo) + mock + stub da API oficial
    aiService.js         # MOCK — troque por chamada a um LLM real
    affiliateService.js  # MOCK — troque pela API do programa de afiliados
    publishService.js    # WhatsApp/Telegram/Facebook reais; IG/TikTok pendentes
  routes/
    generate.js
    ads.js
    dashboard.js
```

## Sobre a API oficial de afiliados da Shopee

Já implementado (`services/affiliateService.js`): quando `SHOPEE_AFFILIATE_APP_ID`
e `SHOPEE_AFFILIATE_SECRET` estiverem preenchidos no `.env`, o backend gera
links de afiliado de verdade via API oficial (GraphQL, autenticado com
HMAC-SHA256). Sem essas credenciais, continua usando o mock.

Essas credenciais ficam disponíveis na seção "Open API" dentro do painel de
afiliados (https://affiliate.shopee.com.br), depois de aprovado no programa.

**Atenção:** eu não consegui testar essa integração contra a API real (sem
acesso à internet no meu ambiente). Se a primeira chamada real der erro, me
manda a mensagem exata que a API da Shopee devolver — ela costuma indicar
qual campo está incorreto, e ajusto rapidinho.

Para busca de produto (`productService`), o scraping continua sendo o
caminho ativo por enquanto — a mesma API de afiliados também expõe consultas
de catálogo (`productOfferV2`), mas elas parecem funcionar por busca de
palavra-chave, não por link direto de um produto específico. Vale
investigar quando tivermos as credenciais reais em mãos para testar.

## Endpoints principais

| Método | Rota                        | Descrição                                   |
|--------|-----------------------------|----------------------------------------------|
| POST   | /api/generate               | Gera produto + texto + link de afiliado      |
| POST   | /api/generate/text          | Regenera só o texto com outro estilo         |
| GET    | /api/ads                    | Lista o histórico ("Meus anúncios")          |
| POST   | /api/ads                    | Salva um anúncio gerado                      |
| PATCH  | /api/ads/:id                | Edita texto/estilo/template de um anúncio    |
| GET    | /api/ads/publish/platforms  | Lista plataformas e quais já funcionam       |
| POST   | /api/ads/:id/publish        | Registra publicação e devolve link de share  |
| GET    | /api/dashboard              | Métricas reais (nada inventado)              |

## Próximos passos

1. Testar o scraping contra links reais e ajustar a extração conforme o que
   a Shopee devolver de fato (isso eu não consigo simular no meu ambiente —
   preciso do seu retorno).
2. Trocar `aiService.generateCopy` por uma chamada a um provedor de IA real.
3. Implementar `fetchProductViaApi` quando você tiver as credenciais do
   programa de afiliados.
4. Implementar `affiliateService` real.
