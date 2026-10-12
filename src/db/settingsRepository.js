import { readCollection, writeCollection } from "./jsonStore.js";

/**
 * Configurações da automação. Valores padrão vêm das variáveis de ambiente
 * (que sobrevivem a redeploys); o que for alterado na tela fica salvo em
 * arquivo e sobrepõe os padrões — mas no plano gratuito do Render esse
 * arquivo é apagado a cada deploy/restart, voltando aos padrões do ambiente.
 */

// Teto absoluto, bem abaixo do limite da própria API do Instagram (50-100/24h).
// Mesmo que alguém configure um número maior, o sistema nunca passa disso.
export const HARD_MAX_POSTS_PER_DAY = 25;

function envNumber(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
}

function defaults() {
  return {
    mode: process.env.AUTOMATION_MODE === "auto" ? "auto" : "approval", // approval = só publica o que você aprovar
    autoFill: process.env.AUTOMATION_AUTOFILL === "true", // busca sozinho produtos em alta e enfileira
    maxPostsPerDay: envNumber("IG_MAX_POSTS_PER_DAY", 3),
    minHoursBetweenPosts: envNumber("IG_MIN_HOURS_BETWEEN_POSTS", 4),
    windowStartHour: envNumber("IG_POST_WINDOW_START", 8),
    windowEndHour: envNumber("IG_POST_WINDOW_END", 22),
    timeZone: process.env.IG_TIMEZONE || "America/Sao_Paulo",
    queueTarget: envNumber("AUTOMATION_QUEUE_TARGET", 2),
    dedupeDays: envNumber("AUTOMATION_DEDUPE_DAYS", 30),
    format: "feed",
  };
}

function sanitize(s) {
  const out = { ...s };
  out.mode = out.mode === "auto" ? "auto" : "approval";
  out.autoFill = Boolean(out.autoFill);
  out.maxPostsPerDay = Math.min(Math.max(Math.floor(Number(out.maxPostsPerDay) || 1), 1), HARD_MAX_POSTS_PER_DAY);
  out.minHoursBetweenPosts = Math.min(Math.max(Number(out.minHoursBetweenPosts) || 0, 0), 24);
  out.windowStartHour = Math.min(Math.max(Math.floor(Number(out.windowStartHour) || 0), 0), 23);
  out.windowEndHour = Math.min(Math.max(Math.floor(Number(out.windowEndHour) || 24), 1), 24);
  out.queueTarget = Math.min(Math.max(Math.floor(Number(out.queueTarget) || 1), 1), 10);
  out.dedupeDays = Math.min(Math.max(Math.floor(Number(out.dedupeDays) || 0), 0), 365);
  out.format = "feed"; // posts de feed 4:5 — formato aceito pela API do Instagram
  return out;
}

export function getSettings() {
  const saved = readCollection("settings")[0] || {};
  return sanitize({ ...defaults(), ...saved });
}

export function updateSettings(partial) {
  const allowed = ["mode", "autoFill", "maxPostsPerDay", "minHoursBetweenPosts", "windowStartHour", "windowEndHour", "queueTarget", "dedupeDays"];
  const current = readCollection("settings")[0] || {};
  const next = { ...current };
  for (const k of allowed) if (partial && k in partial) next[k] = partial[k];
  writeCollection("settings", [next]);
  return getSettings();
}
