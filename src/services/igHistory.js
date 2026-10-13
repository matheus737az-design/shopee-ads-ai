import * as instagram from "./instagramService.js";

/**
 * igHistory — o histórico de posts vem da PRÓPRIA conta do Instagram.
 *
 * Por quê: no Render grátis o disco é apagado a cada deploy/reinício, então a
 * fila salva em arquivo não é confiável para saber "quantos posts saíram nas
 * últimas 24h" ou "esse produto já foi postado". A conta do Instagram é a
 * única fonte que nunca se perde. Cada legenda gerada leva um código do
 * produto (ver `productMarker`), o que permite evitar repetições mesmo depois
 * de o servidor perder tudo.
 *
 * Se a consulta falhar, quem chama deve NÃO publicar (falha segura).
 */

const CACHE_MS = 3 * 60 * 1000;
let cache = null; // { at, posts }

/** Código curto e estável do produto, escrito na legenda. Ex.: "Cód. 23456789012". */
export function productCode(product) {
  const raw = String(product?.id || "");
  const digits = raw.match(/(\d{5,})(?!.*\d{5,})/); // último bloco numérico = itemId
  return digits ? digits[1] : raw.replace(/[^a-z0-9]/gi, "").slice(-16) || null;
}

export function productMarker(product) {
  const code = productCode(product);
  return code ? `Cód. ${code}` : "";
}

/** Últimos posts da conta: [{ id, timestamp(ms), caption }]. Usa cache curto. */
export async function getRecentPosts({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.posts;
  const posts = await instagram.listRecentMedia({ max: 100 });
  cache = { at: Date.now(), posts };
  return posts;
}

/** Chamado depois de publicar, para a próxima checagem já enxergar o post novo. */
export function rememberPost({ id, caption }) {
  const post = { id, timestamp: Date.now(), caption: caption || "" };
  if (cache) cache.posts = [post, ...cache.posts.filter((p) => p.id !== id)];
}

export function clearHistoryCache() {
  cache = null;
}

/**
 * Junta o histórico local com os posts do Instagram, sem contar o mesmo post
 * duas vezes (casamento exato pelo id da mídia).
 * @param {Array<{t:number, mediaId:string|null}>} local
 * @param {Array<{id:string, timestamp:number}>} remote
 */
export function mergeTimestamps(local, remote) {
  const ids = new Set(remote.map((p) => p.id));
  const all = remote.map((p) => p.timestamp);
  for (const e of local) if (!e.mediaId || !ids.has(e.mediaId)) all.push(e.t);
  return all.sort((a, b) => a - b);
}

/** Post gerado pelo sistema (tem o código do produto na legenda)? */
export function isProductPost(caption) {
  return /C[óo]d\.\s*\w+/i.test(caption || "");
}

/** O produto já aparece em algum post recente da conta (dentro de `days`)? */
export function postedOnInstagram(product, posts, days) {
  const code = productCode(product);
  if (!code) return false;
  const since = days ? Date.now() - days * 24 * 3600 * 1000 : 0;
  const re = new RegExp(`C[óo]d\\.?\\s*${code}\\b`, "i");
  return posts.some((p) => p.timestamp >= since && re.test(p.caption || ""));
}
