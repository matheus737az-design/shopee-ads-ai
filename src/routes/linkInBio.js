import { Router } from "express";
import sharp from "sharp";
import { resolveProductPhoto } from "../services/imageService.js";
import { renderArtJpeg } from "../services/artRenderService.js";
import * as instagram from "../services/instagramService.js";
import { getRecentPosts, productCode } from "../services/igHistory.js";
import { getTrendingProducts } from "../services/trendingService.js";
import { hasCredentials } from "../services/shopeeAffiliateClient.js";

/**
 * Página "link na bio" — /achados
 *
 * Vitrine pública com os produtos já postados no Instagram, cada um com o
 * botão de compra pelo link de afiliado. Os dados vêm da PRÓPRIA conta do
 * Instagram (arte + link que está na legenda), então a página nunca fica
 * vazia depois de um deploy no Render grátis e não precisa de banco.
 */

const BRAND = () => ({
  name: process.env.BRAND_NAME || "Maaz Shopp",
  handle: process.env.BRAND_HANDLE || "maazshopp",
  tagline: process.env.BRAND_TAGLINE || "Achadinhos da Shopee com desconto de verdade",
});

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Primeiro link da legenda que não seja do próprio Instagram. Links da Shopee têm preferência. */
export function extractLink(caption) {
  const urls = String(caption || "").match(/https?:\/\/[^\s)]+/g) || [];
  const clean = urls.map((u) => u.replace(/[.,;!]+$/, "")).filter((u) => !/instagram\.com/i.test(u));
  return clean.find((u) => /shopee|shp\.ee|shope\.ee/i.test(u)) || clean[0] || null;
}

/** Linha da legenda que melhor descreve o produto (pula a chamada inicial com emoji). */
export function extractTitle(caption) {
  const lines = String(caption || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const candidate = lines.find((l, i) => i > 0 && !/^https?:|^#|^c[óo]d\.|link|💰|👉|🔗/i.test(l) && l.length > 12);
  return (candidate || lines[0] || "Oferta").replace(/\s+/g, " ").slice(0, 90);
}

export function productsFromPosts(posts) {
  return posts
    .filter((p) => /C[óo]d\.\s*\w+/i.test(p.caption || "")) // só posts de produto (gerados pelo sistema)
    .map((p) => ({
      id: p.id,
      link: extractLink(p.caption),
      title: extractTitle(p.caption),
      // A CDN do Instagram bloqueia imagens em outros sites (e as URLs expiram):
      // a capa é servida pelo nosso servidor em /achados/img/:id
      image: (p.mediaType === "VIDEO" ? p.thumbnailUrl : p.mediaUrl) ? `/achados/img/${encodeURIComponent(p.id)}?v=2` : null,
      code: (p.caption || "").match(/C[óo]d\.\s*(\w+)/i)?.[1] || null,
      permalink: p.permalink,
      timestamp: p.timestamp,
    }))
    .filter((p) => p.link && p.image)
    .filter((p, i, all) => !p.code || all.findIndex((q) => q.code === p.code) === i); // mesmo produto 1x (o mais recente)
}

const money = (v) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** Produtos em alta (ainda não postados) com link de afiliado e foto. */
export function trendingCards(products, postedCodes = new Set()) {
  const seen = new Set();
  return products
    .filter((p) => p.offerLink && p.images?.[0] && p.price != null)
    .filter((p) => {
      const code = productCode(p);
      if (!code || postedCodes.has(code) || seen.has(code)) return false;
      seen.add(code);
      return true;
    })
    .map((p) => ({
      link: p.offerLink,
      image: p.images[0],
      title: String(p.title || "Produto").replace(/\s+/g, " ").slice(0, 80),
      price: p.price,
      originalPrice: p.originalPrice,
      discount: p.discountPercentage ? Math.round(p.discountPercentage) : null,
    }));
}

// Cache dos mais vendidos: evita consultar a Shopee a cada visita.
const TRENDING_TTL_MS = 30 * 60 * 1000;
let trendingCache = { at: 0, items: [] };
async function cachedTrending() {
  if (Date.now() - trendingCache.at < TRENDING_TTL_MS && trendingCache.items.length) return trendingCache.items;
  const pages = await Promise.all([1, 2].map((page) => getTrendingProducts({ limit: 30, page }).catch(() => [])));
  const items = pages.flat();
  if (items.length) trendingCache = { at: Date.now(), items };
  return items.length ? items : trendingCache.items;
}

export function page({ items, more = [], brand = BRAND(), error = null }) {
  const moreCards = more
    .map(
      (p) => `
      <li class="card">
        <a class="img sq" href="${esc(p.link)}" rel="sponsored noopener" target="_blank">
          <img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" referrerpolicy="no-referrer" width="500" height="500">
          ${p.discount ? `<span class="off">-${p.discount}%</span>` : ""}
        </a>
        <div class="info">
          <p class="t">${esc(p.title)}</p>
          <p class="pr">${p.originalPrice ? `<s>${esc(money(p.originalPrice))}</s>` : ""}<b>${esc(money(p.price))}</b></p>
        </div>
        <a class="buy" href="${esc(p.link)}" rel="sponsored noopener" target="_blank">Ver oferta</a>
      </li>`
    )
    .join("");

  const cards = items
    .map(
      (p, i) => `
      <li class="card">
        <a class="img" href="${esc(p.link)}" rel="sponsored noopener" target="_blank">
          <img src="${esc(p.image)}" alt="${esc(p.title)}" loading="${i < 4 ? "eager" : "lazy"}" referrerpolicy="no-referrer" width="1080" height="1350">
          ${i === 0 ? '<span class="new">NOVO</span>' : ""}
        </a>
        <a class="buy" href="${esc(p.link)}" rel="sponsored noopener" target="_blank">Ver oferta</a>
      </li>`
    )
    .join("");

  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(brand.name)} · Achadinhos</title>
<meta name="description" content="${esc(brand.tagline)}">
<meta name="theme-color" content="#FFD23F">
<link rel="icon" href="/brand/avatar.png">
<style>
  :root{--y:#FFD23F;--r:#FF4B3E;--n:#1A1A2E;--bg:#FFF8E1}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--n);font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  header{background:var(--y);padding:28px 16px 22px;text-align:center}
  header img{width:92px;height:92px;border-radius:50%;border:4px solid #fff;box-shadow:0 4px 14px #0002}
  h1{margin:10px 0 2px;font-size:24px;font-weight:900;letter-spacing:-.5px}
  header p{margin:0 auto;max-width:420px;font-size:15px}
  .ig{display:inline-block;margin-top:12px;padding:8px 16px;border-radius:999px;background:var(--n);color:#fff;text-decoration:none;font-weight:700;font-size:14px}
  main{max-width:720px;margin:0 auto;padding:18px 16px 40px}
  .hint{font-size:14px;text-align:center;margin:0 0 16px;opacity:.75}
  ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px #0001;display:flex;flex-direction:column}
  .img{position:relative;display:block;aspect-ratio:4/5;background:#eee}
  .img img{width:100%;height:100%;object-fit:cover;display:block}
  .new{position:absolute;bottom:8px;left:8px;background:var(--r);color:#fff;font-weight:900;font-size:12px;padding:4px 8px;border-radius:6px}
  .buy{display:block;margin:10px;padding:12px 8px;border-radius:12px;background:var(--r);color:#fff;text-align:center;text-decoration:none;font-weight:800;font-size:15px}
  .buy:active{transform:scale(.98)}
  .empty{text-align:center;padding:40px 0}
  h2{font-size:20px;font-weight:900;margin:28px 0 4px;letter-spacing:-.3px}
  h2+.sub{margin:0 0 14px;font-size:14px;opacity:.7}
  .sq{aspect-ratio:1/1;background:#fff}
  .off{position:absolute;top:8px;right:8px;background:var(--y);color:var(--n);font-weight:900;font-size:13px;padding:4px 8px;border-radius:6px}
  .info{padding:10px 10px 0}
  .t{margin:0;font-size:13px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:34px}
  .pr{margin:6px 0 0;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px}
  .pr s{font-size:12px;opacity:.55}
  .pr b{font-size:18px;color:var(--r);font-weight:900}
  footer{text-align:center;font-size:12px;opacity:.6;padding:0 16px 28px;line-height:1.5}
  @media (min-width:640px){ul{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style></head>
<body>
<header>
  <img src="/brand/avatar.png" alt="${esc(brand.name)}">
  <h1>${esc(brand.name)}</h1>
  <p>${esc(brand.tagline)}</p>
  <a class="ig" href="https://www.instagram.com/${esc(brand.handle)}/" rel="noopener">@${esc(brand.handle)}</a>
</header>
<main>
  ${items.length ? `<h2>📸 Postados no Instagram</h2><p class="sub">As ofertas que saíram no perfil. Toque para comprar 👇</p><ul>${cards}</ul>` : ""}
  ${more.length ? `<h2>🔥 Mais vendidos agora</h2><p class="sub">Produtos em alta na Shopee, atualizados ao longo do dia.</p><ul>${moreCards}</ul>` : ""}
  ${!items.length && !more.length ? `<p class="empty">${error ? "Não consegui carregar as ofertas agora. Tente de novo em instantes." : "As primeiras ofertas chegam em breve!"}</p>` : ""}
</main>
<footer>Links de afiliado: posso receber comissão pelas compras, sem custo extra para você.<br>Preços e estoque podem mudar na Shopee.</footer>
</body></html>`;
}

const router = Router();

// Capas dos posts: baixadas da CDN do Instagram pelo servidor, reduzidas e
// guardadas em memória (até 80 imagens, 6h). Só busca URLs que vieram da
// própria API (pelo id do post), nunca uma URL qualquer.
const IMG_TTL_MS = 6 * 3600 * 1000;
const imgCache = new Map(); // id -> { buf, at }
const IG_CDN = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

/** Arte 4:5 do produto (como os posts de foto), achado pelo "Cód." da legenda. */
async function productCover(caption) {
  const code = (caption || "").match(/C[óo]d\.\s*(\d+)/i)?.[1];
  if (!code || !hasCredentials()) return null;
  let product = (await cachedTrending()).find((p) => String(p.id).endsWith(`_${code}`));
  for (let page = 3; !product && page <= 6; page++) {
    const items = await getTrendingProducts({ limit: 50, page }).catch(() => []);
    product = items.find((p) => String(p.id).endsWith(`_${code}`));
    if (!items.length) break;
  }
  if (!product) return null;
  const photo = await resolveProductPhoto(product, null);
  if (!photo.buffer) return null;
  const { buffer } = await renderArtJpeg({ product, photoBuffer: photo.buffer, photoContentType: photo.contentType, templateKey: "OFERTA", formatKey: "feed" });
  return sharp(buffer).resize({ width: 540 }).jpeg({ quality: 82 }).toBuffer();
}

router.get("/img/:id", async (req, res) => {
  const id = String(req.params.id).replace(/[^0-9_]/g, "");
  const hit = imgCache.get(id);
  if (hit && Date.now() - hit.at < IMG_TTL_MS) {
    return res.set("Content-Type", "image/jpeg").set("Cache-Control", "public, max-age=21600").send(hit.buf);
  }
  try {
    if (!instagram.isConfigured()) return res.status(404).end();
    const post = (await getRecentPosts()).find((p) => p.id === id);
    if (!post) return res.status(404).end();
    // Reel: a capa do Instagram pode ser o 1º quadro (vazio). Monta a capa a
    // partir do produto (mesma arte dos posts de foto); se não achar, usa a do Instagram.
    if (post.mediaType === "VIDEO") {
      const cover = await productCover(post.caption).catch((e) => {
        console.warn("[achados] capa do produto falhou:", e.message);
        return null;
      });
      if (cover) {
        imgCache.set(id, { buf: cover, at: Date.now() });
        while (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value);
        return res.set("Content-Type", "image/jpeg").set("Cache-Control", "public, max-age=21600").send(cover);
      }
    }
    const url = post.mediaType === "VIDEO" ? post.thumbnailUrl : post.mediaUrl;
    if (!url || !IG_CDN.test(new URL(url).hostname)) return res.status(404).end();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!r.ok) return res.status(502).end();
    const buf = await sharp(Buffer.from(await r.arrayBuffer())).resize({ width: 540, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    imgCache.set(id, { buf, at: Date.now() });
    while (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value);
    res.set("Content-Type", "image/jpeg").set("Cache-Control", "public, max-age=21600").send(buf);
  } catch (e) {
    console.warn("[achados] capa falhou:", e.message);
    res.status(502).end();
  }
});

router.get("/", async (req, res) => {
  const brand = BRAND();
  let items = [];
  let posts = [];
  let error = null;
  if (instagram.isConfigured()) {
    try {
      posts = await getRecentPosts();
      items = productsFromPosts(posts).slice(0, 30);
    } catch (e) {
      error = e.message;
      console.warn("[achados] falha ao ler posts:", e.message);
    }
  }
  let more = [];
  if (hasCredentials()) {
    try {
      const postedCodes = new Set(
        posts.map((p) => (p.caption || "").match(/C[óo]d\.\s*(\w+)/i)?.[1]).filter(Boolean)
      );
      more = trendingCards(await cachedTrending(), postedCodes).slice(0, 40);
    } catch (e) {
      console.warn("[achados] falha ao buscar mais vendidos:", e.message);
    }
  }
  res.set("Cache-Control", "public, max-age=120").type("html").send(page({ items, more, brand, error }));
});

export default router;
