/**
 * instagramService — publicação via API oficial do Instagram (Graph API).
 *
 * Variáveis de ambiente:
 *   IG_USER_ID       id da conta profissional do Instagram
 *   IG_ACCESS_TOKEN  token de acesso (expira! tokens de longa duração valem ~60 dias)
 *   IG_GRAPH_BASE    (opcional) padrão https://graph.facebook.com
 *                    — se o token veio do "Instagram Login", use https://graph.instagram.com
 *   IG_GRAPH_VERSION (opcional) padrão v21.0
 *
 * Fluxo oficial de foto: 1) POST /{ig-id}/media (image_url, caption) cria um
 * "container"; 2) aguarda status FINISHED; 3) POST /{ig-id}/media_publish.
 * Só é considerado publicado se a Meta devolver o id da mídia — nunca
 * assumimos sucesso.
 */

const TIMEOUT_MS = 20000;

export function isConfigured() {
  return Boolean(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN);
}

function base() {
  // Tokens do "Instagram Login" começam com "IG" e só funcionam em graph.instagram.com.
  const auto = /^IG/.test(process.env.IG_ACCESS_TOKEN || "") ? "https://graph.instagram.com" : "https://graph.facebook.com";
  const root = (process.env.IG_GRAPH_BASE || auto).replace(/\/$/, "");
  const version = process.env.IG_GRAPH_VERSION || "v21.0";
  return `${root}/${version}`;
}

async function graph(path, { method = "GET", params = {} } = {}) {
  const token = process.env.IG_ACCESS_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res;
    if (method === "GET") {
      const qs = new URLSearchParams({ ...params, access_token: token });
      res = await fetch(`${base()}${path}?${qs}`, { signal: controller.signal });
    } else {
      const body = new URLSearchParams({ ...params, access_token: token });
      res = await fetch(`${base()}${path}`, { method, body, signal: controller.signal });
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.error) {
      const e = json?.error || {};
      const err = new Error(explain(e, res.status));
      err.code = e.code;
      throw err;
    }
    return json;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("O Instagram demorou demais para responder.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function explain(e, status) {
  if (e.code === 190) return "Token do Instagram inválido ou expirado — gere um novo token e atualize IG_ACCESS_TOKEN no Render.";
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return "A Meta limitou temporariamente as chamadas (rate limit). Tente mais tarde.";
  if (e.code === 9004 || e.code === 9007 || e.error_subcode === 2207052) return `A Meta não conseguiu baixar a imagem: ${e.message}`;
  return e.message ? `Instagram: ${e.message}` : `Erro ${status} ao falar com o Instagram.`;
}

/** Dados básicos da conta — serve para confirmar que o token funciona. */
export async function getAccountStatus() {
  const data = await graph(`/${process.env.IG_USER_ID}`, { params: { fields: "username" } });
  return { username: data.username || null };
}

/** Cota REAL de publicações da API (autoridade final, independe dos nossos registros). */
export async function getPublishingQuota() {
  const data = await graph(`/${process.env.IG_USER_ID}/content_publishing_limit`, {
    params: { fields: "quota_usage,config" },
  });
  const row = data?.data?.[0] || {};
  return { used: row.quota_usage ?? null, total: row.config?.quota_total ?? null };
}

/**
 * Posts recentes da conta (mais novo primeiro), com horário e legenda.
 * @returns {Promise<Array<{id:string, timestamp:number, caption:string}>>}
 */
export async function listRecentMedia({ max = 100 } = {}) {
  const out = [];
  let after = null;
  for (let page = 0; page < 4 && out.length < max; page++) {
    const params = { fields: "id,timestamp,caption", limit: String(Math.min(50, max - out.length)) };
    if (after) params.after = after;
    const data = await graph(`/${process.env.IG_USER_ID}/media`, { params });
    for (const m of data?.data || []) {
      out.push({ id: m.id, timestamp: new Date(m.timestamp).getTime(), caption: m.caption || "" });
    }
    after = data?.paging?.cursors?.after;
    if (!data?.paging?.next || !after) break;
  }
  return out;
}

/** O token veio do "Instagram Login" (graph.instagram.com)? Só esse tipo é renovável por API. */
export function usesInstagramLogin() {
  return /graph\.instagram\.com/.test(process.env.IG_GRAPH_BASE || "") || /^IG/.test(process.env.IG_ACCESS_TOKEN || "");
}

/**
 * Renova um token de longa duração do Instagram Login (+60 dias).
 * Documentação: GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
 * @returns {{token:string, expiresInSec:number|null}}
 */
export async function refreshLongLivedToken() {
  const qs = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: process.env.IG_ACCESS_TOKEN || "" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://graph.instagram.com/refresh_access_token?${qs}`, { signal: controller.signal });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.access_token) throw new Error(explain(json?.error || {}, res.status));
    return { token: json.access_token, expiresInSec: json.expires_in ?? null };
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntilReady(containerId) {
  for (let i = 0; i < 20; i++) {
    const s = await graph(`/${containerId}`, { params: { fields: "status_code" } });
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new Error(`O Instagram não conseguiu processar a imagem (status ${s.status_code}).`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("O Instagram demorou demais para processar a imagem.");
}

/** Publica uma foto de feed. @returns {{mediaId:string, permalink:string|null}} */
export async function publishPhoto({ imageUrl, caption }) {
  if (!isConfigured()) throw new Error("Instagram não configurado (faltam IG_USER_ID / IG_ACCESS_TOKEN).");
  return publishMedia({ imageUrl, params: { caption } });
}

/**
 * Publica um story de imagem (media_type=STORIES). Story não tem legenda nem
 * link clicável pela API — o texto/preço já vai na própria arte.
 * @returns {{mediaId:string}}
 */
export async function publishStory({ imageUrl }) {
  if (!isConfigured()) throw new Error("Instagram não configurado (faltam IG_USER_ID / IG_ACCESS_TOKEN).");
  const { mediaId } = await publishMedia({ imageUrl, params: { media_type: "STORIES" }, withPermalink: false });
  return { mediaId };
}

async function publishMedia({ imageUrl, params, withPermalink = true }) {
  const id = process.env.IG_USER_ID;
  const container = await graph(`/${id}/media`, { method: "POST", params: { image_url: imageUrl, ...params } });
  await waitUntilReady(container.id);
  const published = await graph(`/${id}/media_publish`, { method: "POST", params: { creation_id: container.id } });
  if (!published?.id) throw new Error("O Instagram não confirmou a publicação.");

  let permalink = null;
  if (withPermalink) try {
    const m = await graph(`/${published.id}`, { params: { fields: "permalink" } });
    permalink = m.permalink || null;
  } catch {
    /* permalink é opcional */
  }
  return { mediaId: published.id, permalink };
}
