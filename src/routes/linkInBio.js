import { Router } from "express";
import * as instagram from "../services/instagramService.js";
import { getRecentPosts } from "../services/igHistory.js";

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
      image: p.mediaType === "VIDEO" ? null : p.mediaUrl,
      permalink: p.permalink,
      timestamp: p.timestamp,
    }))
    .filter((p) => p.link && p.image);
}

export function page({ items, brand = BRAND(), error = null }) {
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
  ${items.length ? `<p class="hint">Toque na oferta para comprar direto no app da Shopee 👇</p><ul>${cards}</ul>` : `<p class="empty">${error ? "Não consegui carregar as ofertas agora. Tente de novo em instantes." : "As primeiras ofertas chegam em breve!"}</p>`}
</main>
<footer>Links de afiliado: posso receber comissão pelas compras, sem custo extra para você.<br>Preços e estoque podem mudar na Shopee.</footer>
</body></html>`;
}

const router = Router();

router.get("/", async (req, res) => {
  const brand = BRAND();
  let items = [];
  let error = null;
  if (instagram.isConfigured()) {
    try {
      items = productsFromPosts(await getRecentPosts()).slice(0, 30);
    } catch (e) {
      error = e.message;
      console.warn("[achados] falha ao ler posts:", e.message);
    }
  }
  res.set("Cache-Control", "public, max-age=120").type("html").send(page({ items, brand, error }));
});

export default router;
