import crypto from "node:crypto";
import { adminFailLimiter } from "./rateLimit.js";

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Painel de automação: protegido por ADMIN_PASSWORD (header x-admin-password).
 * Sem a variável configurada o painel fica DESLIGADO (503) — nunca aberto.
 */
export function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res.status(503).json({ error: "Painel desativado: defina ADMIN_PASSWORD no Render." });
  }
  const given = req.get("x-admin-password") || "";
  if (given && safeEqual(given, expected)) return next();
  // só conta tentativa como "falha" quando a senha está errada
  return adminFailLimiter(req, res, () => res.status(401).json({ error: "Senha incorreta." }));
}

/** Rota chamada pelo agendador externo (cron): aceita CRON_SECRET ou a senha de admin. */
export function requireCronOrAdmin(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const given = req.get("x-cron-secret") || "";
  if (secret && given && safeEqual(given, secret)) return next();
  return requireAdmin(req, res, next);
}
