import * as instagram from "./instagramService.js";
import { getRecentPosts, rememberPost, clearHistoryCache } from "./igHistory.js";

/**
 * Posts de boas-vindas (fixados no topo do perfil).
 *
 * Publicados UMA vez quando WELCOME_POSTS=publish. É idempotente: antes de
 * publicar, confere nas legendas do próprio Instagram se cada um já existe,
 * então reinícios/deploys nunca duplicam. Não têm "Cód." na legenda, logo
 * não contam para o limite diário de posts de produto.
 *
 * Ordem de publicação 3 → 2 → 1, para o "Bem-vindo" ficar à esquerda na grade.
 */

const handle = () => (process.env.BRAND_HANDLE || "maazshopp").replace(/^@/, "");

export function welcomePosts() {
  const h = handle();
  return [
    {
      key: "ofertas-todo-dia",
      image: "welcome-3.jpg",
      firstLine: "🔥 Ofertas novas todo dia!",
      caption: `🔥 Ofertas novas todo dia!

Todos os dias postamos aqui e nos stories os produtos mais vendidos da Shopee que estão com desconto: casa, beleza, moda, eletrônicos e utilidades.

🔔 Ative as notificações pra não perder nenhum achadinho.
👉 Todas as ofertas ficam no link da bio.

Perfil de afiliado: podemos receber comissão pelas compras, sem custo extra pra você.
#publi #achadinhos #shopee #ofertas #achadinhosdashopee`,
    },
    {
      key: "como-comprar",
      image: "welcome-2.jpg",
      firstLine: "🛒 Como comprar os achadinhos",
      caption: `🛒 Como comprar os achadinhos

1️⃣ Gostou de uma oferta? Salve o post
2️⃣ Toque no link da bio (@${h})
3️⃣ Escolha o produto e toque em "Ver oferta"
4️⃣ Finalize no app da Shopee, com a garantia e o frete dela

Você compra direto na Shopee, com toda a segurança de lá. 😉
#publi #achadinhos #shopee #comprasonline`,
    },
    {
      key: "bem-vindo",
      image: "welcome-1.jpg",
      firstLine: "🛍️ Bem-vindo(a) à Maaz Shopp!",
      caption: `🛍️ Bem-vindo(a) à Maaz Shopp!

Aqui a gente garimpa os achadinhos da Shopee com desconto de verdade, pra você não perder tempo nem dinheiro.

✅ Ofertas novas todo dia
✅ Só produtos bem vendidos e com foto real
✅ Link direto pra comprar na Shopee

Siga @${h} e ative o 🔔
#publi #achadinhos #shopee #ofertas #achadinhosdashopee`,
    },
  ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Publica os que ainda não existem na conta. @returns {{published:string[], skipped:string[]}} */
export async function publishWelcomePosts({ baseUrl, delayMs = 15000 } = {}) {
  if (!instagram.isConfigured()) throw new Error("Instagram não configurado.");
  clearHistoryCache();
  const posts = await getRecentPosts({ force: true });
  const published = [];
  const skipped = [];
  for (const w of welcomePosts()) {
    if (posts.some((p) => (p.caption || "").startsWith(w.firstLine))) {
      skipped.push(w.key);
      continue;
    }
    const imageUrl = `${baseUrl}/brand/${w.image}`;
    const { mediaId } = await instagram.publishPhoto({ imageUrl, caption: w.caption });
    rememberPost({ id: mediaId, caption: w.caption });
    published.push(w.key);
    console.log(`[boas-vindas] publicado: ${w.key} (${mediaId})`);
    if (delayMs) await sleep(delayMs); // ordem garantida na grade
  }
  return { published, skipped };
}

/** Chamado ao subir o servidor. */
export async function maybePublishWelcome({ baseUrl }) {
  if (process.env.WELCOME_POSTS !== "publish") return;
  try {
    const r = await publishWelcomePosts({ baseUrl });
    console.log(`[boas-vindas] concluído. publicados: ${r.published.join(", ") || "nenhum"}; já existiam: ${r.skipped.join(", ") || "nenhum"}`);
  } catch (e) {
    console.error("[boas-vindas] falhou:", e.message);
  }
}
