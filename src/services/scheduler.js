import { runTick } from "./automationService.js";
import * as instagram from "./instagramService.js";
import { maybePublishWelcome } from "./welcomeService.js";

/**
 * scheduler — o piloto automático roda DENTRO do servidor, sem depender de
 * cron-job.org nem de nenhuma conta externa.
 *
 *  - A cada AUTOMATION_TICK_MINUTES (padrão 20) roda um ciclo (runTick).
 *    As regras de quantidade/horário decidem se algo sai ou não.
 *  - Mantém o Render grátis acordado chamando o próprio /api/health a cada
 *    10 min (o Render dorme após 15 min sem tráfego). Um serviço sempre
 *    ligado usa ~744h/mês, dentro das 750h grátis do Render.
 *  - Renova o token do Instagram Login a cada 7 dias e, se RENDER_API_KEY
 *    estiver configurada, grava o token novo no Render e faz redeploy —
 *    assim o token nunca chega a expirar.
 *
 * Desligue com AUTOMATION_SCHEDULER=off (ex.: rodando localmente).
 */

const state = {
  enabled: false,
  startedAt: Date.now(),
  lastTickAt: null,
  lastTickOkAt: null,
  lastResult: null,
  lastError: null,
  lastPublishedAt: null,
  tokenRefreshedAt: null,
  tokenExpiresAt: null,
  tokenPersisted: null,
  tokenError: null,
  running: false,
};

const TOKEN_REFRESH_EVERY_MS = 7 * 24 * 3600 * 1000;
const TOKEN_FIRST_REFRESH_AFTER_MS = 24 * 3600 * 1000; // a Meta só renova tokens com 24h+ de idade

export function schedulerState() {
  return { ...state };
}

function baseUrl() {
  const fixed = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  return fixed ? fixed.replace(/\/$/, "") : `http://localhost:${process.env.PORT || 3333}`;
}

export async function tickNow() {
  if (state.running) return { actions: ["ciclo anterior ainda em andamento"], published: false };
  state.running = true;
  state.lastTickAt = Date.now();
  try {
    await maybeRefreshToken();
    const r = await runTick({ baseUrl: baseUrl() });
    state.lastResult = r;
    state.lastError = r.error || null;
    if (!r.error) state.lastTickOkAt = Date.now();
    if (r.published) state.lastPublishedAt = Date.now();
    console.log("[piloto automático]", r.actions.join(" | "));
    return r;
  } catch (e) {
    state.lastError = e.message;
    console.error("[piloto automático] erro:", e.message);
    return { actions: [`erro: ${e.message}`], published: false, error: e.message };
  } finally {
    state.running = false;
  }
}

async function renderApi(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Render API ${res.status}`);
  return res.json().catch(() => null);
}

/** Renova o token do Instagram Login quando estiver na hora. Nunca derruba o ciclo. */
export async function maybeRefreshToken({ force = false } = {}) {
  if (!instagram.isConfigured() || !instagram.usesInstagramLogin()) return;
  const now = Date.now();
  const last = state.tokenRefreshedAt || state.startedAt;
  const wait = state.tokenRefreshedAt ? TOKEN_REFRESH_EVERY_MS : TOKEN_FIRST_REFRESH_AFTER_MS;
  if (!force && now - last < wait) return;
  try {
    const { token, expiresInSec } = await instagram.refreshLongLivedToken();
    process.env.IG_ACCESS_TOKEN = token;
    state.tokenRefreshedAt = now;
    state.tokenExpiresAt = expiresInSec ? now + expiresInSec * 1000 : null;
    state.tokenError = null;
    const serviceId = process.env.RENDER_SERVICE_ID;
    if (process.env.RENDER_API_KEY && serviceId) {
      await renderApi(`/services/${serviceId}/env-vars/IG_ACCESS_TOKEN`, { method: "PUT", body: { value: token } });
      // O Render só aplica variáveis novas num deploy; o token antigo continua válido até lá.
      await renderApi(`/services/${serviceId}/deploys`, { method: "POST", body: {} });
      state.tokenPersisted = true;
      console.log("[token] renovado e salvo no Render (redeploy iniciado).");
    } else {
      state.tokenPersisted = false;
      console.warn("[token] renovado só em memória — defina RENDER_API_KEY para salvar no Render automaticamente.");
    }
  } catch (e) {
    state.tokenError = e.message;
    console.error("[token] falha ao renovar:", e.message);
  }
}

/**
 * Resumo de saúde, sem dados sensíveis. Usado pelo /api/automation/heartbeat,
 * que o alarme do GitHub consulta (falha => o GitHub manda e-mail).
 */
export function health() {
  const problems = [];
  if (state.enabled && instagram.isConfigured()) {
    const err = state.lastError || "";
    if (/token/i.test(err)) problems.push("token_instagram");
    else if (err) problems.push("erro_no_ultimo_ciclo");
    if (state.lastTickOkAt == null && Date.now() - state.startedAt > 3 * 3600 * 1000) problems.push("sem_ciclo_ok_ha_3h");
    if (state.lastTickOkAt != null && Date.now() - state.lastTickOkAt > 3 * 3600 * 1000) problems.push("sem_ciclo_ok_ha_3h");
    if (state.tokenExpiresAt && state.tokenExpiresAt - Date.now() < 7 * 24 * 3600 * 1000) problems.push("token_expira_em_breve");
  }
  return {
    ok: problems.length === 0,
    problems,
    scheduler: state.enabled,
    instagramConfigured: instagram.isConfigured(),
    lastTickAt: state.lastTickAt ? new Date(state.lastTickAt).toISOString() : null,
    lastPublishedAt: state.lastPublishedAt ? new Date(state.lastPublishedAt).toISOString() : null,
  };
}

/** Ao subir, confere no log se Shopee e Instagram respondem (sem expor segredos). */
async function selfCheck() {
  try {
    const { getTrendingProducts } = await import("./trendingService.js");
    const items = await getTrendingProducts({ limit: 5 });
    const ex = items[0];
    console.log(`[diagnóstico] Shopee em alta: OK, ${items.length} produtos${ex ? ` (ex.: "${ex.title.slice(0, 50)}", foto: ${ex.images.length ? "sim" : "não"}, link afiliado: ${ex.offerLink ? "sim" : "não"})` : ""}.`);
  } catch (e) {
    console.warn(`[diagnóstico] Shopee em alta: FALHOU — ${e.message}`);
  }
  if (instagram.isConfigured()) {
    try {
      const { username } = await instagram.getAccountStatus();
      const posts = await instagram.listRecentMedia({ max: 5 });
      console.log(`[diagnóstico] Instagram: OK, conta @${username}, ${posts.length} posts recentes lidos.`);
    } catch (e) {
      console.warn(`[diagnóstico] Instagram: FALHOU — ${e.message}`);
    }
  } else {
    console.log("[diagnóstico] Instagram: ainda não configurado (IG_USER_ID / IG_ACCESS_TOKEN).");
  }
}

export function startScheduler() {
  if (process.env.AUTOMATION_SCHEDULER === "off") {
    console.log("[piloto automático] agendador interno desligado (AUTOMATION_SCHEDULER=off).");
    return;
  }
  state.enabled = true;
  const minutes = Math.min(Math.max(Number(process.env.AUTOMATION_TICK_MINUTES) || 20, 5), 120);

  setTimeout(() => selfCheck(), 20 * 1000).unref?.(); // autodiagnóstico no log
  // primeiro ciclo 1 min após subir (antes, se pedido, os posts de boas-vindas — em sequência, sem concorrer)
  setTimeout(async () => {
    await maybePublishWelcome({ baseUrl: baseUrl() });
    tickNow();
  }, 60 * 1000).unref?.();
  setInterval(() => tickNow(), minutes * 60 * 1000).unref?.();

  const keepAwake = process.env.KEEP_AWAKE !== "false" && (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL);
  if (keepAwake) {
    setInterval(() => {
      fetch(`${baseUrl()}/api/health`).catch(() => {});
    }, 10 * 60 * 1000).unref?.();
  }
  console.log(`[piloto automático] agendador interno ligado: ciclo a cada ${minutes} min${keepAwake ? ", mantendo o serviço acordado" : ""}.`);
}
