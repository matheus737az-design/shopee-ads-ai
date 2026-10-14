import { Router } from "express";
import { requireAdmin, requireCronOrAdmin } from "../middleware/adminAuth.js";
import { trendingLimiter } from "../middleware/rateLimit.js";
import { getSettings, updateSettings } from "../db/settingsRepository.js";
import { listQueue, getQueueItem, updateQueueItem } from "../db/queueRepository.js";
import { getTrendingProducts } from "../services/trendingService.js";
import { getStatus, publishItem, enqueueFromUrl } from "../services/automationService.js";
import { isValidShopeeUrl } from "../services/productService.js";
import { resolveProductPhoto } from "../services/imageService.js";
import { renderArt } from "../services/artRenderService.js";
import { getPublicMedia } from "../services/publicImageStore.js";
import { tickNow, health, schedulerState, maybeRefreshToken } from "../services/scheduler.js";

export function baseUrlFrom(req) {
  const fixed = process.env.PUBLIC_BASE_URL;
  if (fixed) return fixed.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error("[automação]", err.message);
    res.status(502).json({ error: err.message || "Falha na automação." });
  });

/** Imagem pública temporária (a Meta baixa daqui). Token aleatório, expira em 15 min. */
export const publicImageRouter = Router();
publicImageRouter.get("/:file", (req, res) => {
  const token = String(req.params.file).replace(/\.(jpg|mp4)$/, "");
  const media = /^[a-f0-9]{48}$/.test(token) ? getPublicMedia(token) : null;
  if (!media) return res.status(404).json({ error: "Arquivo expirado ou inexistente." });
  res.set("Content-Type", media.contentType).set("Cache-Control", "no-store").set("Accept-Ranges", "bytes").send(media.buffer);
});

const router = Router();

router.get("/trending", requireAdmin, trendingLimiter, wrap(async (req, res) => {
  const items = await getTrendingProducts({ limit: Math.min(Number(req.query.limit) || 20, 50), page: Number(req.query.page) || 1 });
  res.json({ items });
}));

router.get("/automation/status", requireAdmin, wrap(async (req, res) => {
  const { lastResult, ...sched } = schedulerState();
  res.json({ ...(await getStatus()), scheduler: { ...sched, lastActions: lastResult?.actions || [] } });
}));

// Público e sem dados sensíveis: só diz se o piloto automático está saudável.
// 503 quando há problema — o alarme do GitHub Actions falha e você recebe e-mail.
router.get("/automation/heartbeat", (req, res) => {
  const h = health();
  res.status(h.ok ? 200 : 503).set("Cache-Control", "no-store").json(h);
});

router.post("/automation/refresh-token", requireAdmin, wrap(async (req, res) => {
  await maybeRefreshToken({ force: true });
  const s = schedulerState();
  res.json({ refreshedAt: s.tokenRefreshedAt, expiresAt: s.tokenExpiresAt, persisted: s.tokenPersisted, error: s.tokenError });
}));

router.put("/automation/settings", requireAdmin, wrap(async (req, res) => res.json(updateSettings(req.body || {}))));

router.post("/automation/tick", requireCronOrAdmin, wrap(async (req, res) => {
  res.json(await tickNow());
}));

router.get("/queue", requireAdmin, (req, res) => res.json({ items: listQueue() }));

router.post("/queue", requireAdmin, wrap(async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!isValidShopeeUrl(url)) return res.status(400).json({ error: "Link da Shopee inválido." });
  const item = await enqueueFromUrl(url, { status: "pending" }); // manual sempre espera sua aprovação
  res.json({ item });
}));

router.patch("/queue/:id", requireAdmin, (req, res) => {
  const item = getQueueItem(req.params.id);
  if (!item) return res.status(404).json({ error: "Item não encontrado." });
  if (["publishing", "published"].includes(item.status)) return res.status(409).json({ error: "Este item já foi/está sendo publicado." });
  const caption = String(req.body?.caption || "").slice(0, 2200);
  if (!caption.trim()) return res.status(400).json({ error: "Legenda vazia." });
  res.json({ item: updateQueueItem(item.id, { caption }) });
});

function setStatus(allowedFrom, to) {
  return (req, res) => {
    const item = getQueueItem(req.params.id);
    if (!item) return res.status(404).json({ error: "Item não encontrado." });
    if (!allowedFrom.includes(item.status)) return res.status(409).json({ error: `Não é possível passar de "${item.status}" para "${to}".` });
    res.json({ item: updateQueueItem(item.id, { status: to, error: null }) });
  };
}
router.post("/queue/:id/approve", requireAdmin, setStatus(["pending", "rejected", "failed"], "approved"));
router.post("/queue/:id/reject", requireAdmin, setStatus(["pending", "approved", "failed"], "rejected"));

// "Publicar agora": as regras de quantidade/horário continuam valendo.
router.post("/queue/:id/publish", requireAdmin, wrap(async (req, res) => {
  const item = getQueueItem(req.params.id);
  if (!item) return res.status(404).json({ error: "Item não encontrado." });
  if (item.status === "pending") updateQueueItem(item.id, { status: "approved" }); // clicar em publicar = aprovar
  const r = await publishItem(item.id, { baseUrl: baseUrlFrom(req) });
  res.status(r.published ? 200 : 409).json(r.published ? { item: r.item } : { error: r.reason, item: r.item || getQueueItem(item.id) });
}));

router.get("/queue/:id/preview", requireAdmin, wrap(async (req, res) => {
  const item = getQueueItem(req.params.id);
  if (!item) return res.status(404).json({ error: "Item não encontrado." });
  const photo = await resolveProductPhoto(item.product, null);
  const { buffer } = await renderArt({
    product: item.product, photoBuffer: photo.buffer, photoContentType: photo.contentType,
    templateKey: item.template, formatKey: getSettings().format,
  });
  res.set("Content-Type", "image/png").set("Cache-Control", "no-store").send(buffer);
}));

export default router;
