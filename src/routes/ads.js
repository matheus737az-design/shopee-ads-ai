import { Router } from "express";
import { createAd, updateAd, listAds, getAdById, registerPublication } from "../db/adRepository.js";
import { PLATFORMS, buildShareUrl } from "../services/publishService.js";

const router = Router();

/** GET /api/ads — histórico ("Meus anúncios") */
router.get("/", (req, res) => {
  res.json(listAds());
});

/** POST /api/ads — salva um anúncio gerado (vira "rascunho") */
router.post("/", (req, res) => {
  const { productId, style, template, text, affiliateLink } = req.body || {};
  if (!productId || !text) return res.status(400).json({ error: "Dados incompletos." });
  const ad = createAd({ productId, style, template, text, affiliateLink });
  res.status(201).json(ad);
});

/** PATCH /api/ads/:id — editar texto/estilo/template de um anúncio salvo */
router.patch("/:id", (req, res) => {
  const ad = updateAd(req.params.id, req.body || {});
  if (!ad) return res.status(404).json({ error: "Anúncio não encontrado." });
  res.json(ad);
});

/** GET /api/ads/:id */
router.get("/:id", (req, res) => {
  const ad = getAdById(req.params.id);
  if (!ad) return res.status(404).json({ error: "Anúncio não encontrado." });
  res.json(ad);
});

/** GET /api/ads/publish/platforms — quais plataformas estão disponíveis */
router.get("/publish/platforms", (req, res) => {
  res.json(PLATFORMS);
});

/** POST /api/ads/:id/publish — body: { platform } */
router.post("/:id/publish", (req, res) => {
  const { platform } = req.body || {};
  const ad = getAdById(req.params.id);
  if (!ad) return res.status(404).json({ error: "Anúncio não encontrado." });

  const platformInfo = PLATFORMS.find((p) => p.key === platform);
  if (!platformInfo) return res.status(400).json({ error: "Plataforma desconhecida." });
  if (!platformInfo.ready) return res.status(400).json({ error: `${platformInfo.label} ainda não está disponível nesta versão.` });

  const shareUrl = buildShareUrl(platform, ad.text, ad.affiliateLink);
  registerPublication(ad.id, platform);
  res.json({ shareUrl });
});

export default router;
