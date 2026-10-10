import { Router } from "express";
import { isValidShopeeUrl, fetchProduct } from "../services/productService.js";
import { generateCopy } from "../services/aiService.js";
import { toAffiliateLink } from "../services/affiliateService.js";
import { resolveProductPhoto } from "../services/imageService.js";
import { renderArt, FORMATS, TEMPLATES } from "../services/artRenderService.js";
import { saveProduct } from "../db/productRepository.js";
import { generateLimiter, artLimiter } from "../middleware/rateLimit.js";

const router = Router();

/**
 * POST /api/generate
 * body: { url, style }
 *
 * Orquestra: valida link -> busca produto -> resolve foto real (API ->
 * og:image) -> gera texto -> trata link de afiliado (preserva/gera/avisa).
 *
 * Não gera a arte final aqui — isso é feito em /api/generate/art, chamado
 * separadamente pelo frontend, para permitir trocar template/formato sem
 * precisar colar o link de novo nem rebuscar o produto.
 */
router.post("/", generateLimiter, async (req, res) => {
  const { url, style = "oferta" } = req.body || {};

  if (!isValidShopeeUrl(url)) {
    return res.status(400).json({ error: "Insira um link válido de produto da Shopee." });
  }

  try {
    const product = await fetchProduct(url);
    saveProduct(product);

    const [copy, affiliate, photo] = await Promise.all([
      generateCopy(product, style),
      toAffiliateLink(product.url),
      resolveProductPhoto(product, null).catch((err) => {
        console.warn("[generate] Falha ao resolver foto:", err.message);
        return { buffer: null, source: "none" };
      }),
    ]);

    res.json({
      product,
      copy,
      text: copy.whatsapp, // compatibilidade com a caixa de texto editável principal
      affiliateLink: affiliate.link,
      isAffiliate: affiliate.isAffiliate,
      affiliateWarning: affiliate.warning,
      photoSource: photo.source, // "affiliate-api" | "open-graph" | "none" — nunca finge ter achado foto
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message || "Erro ao gerar o anúncio. Tente novamente." });
  }
});

/** POST /api/generate/text — regenerar só o texto, com outro estilo (sem rebuscar o produto) */
router.post("/text", generateLimiter, async (req, res) => {
  const { product, style } = req.body || {};
  if (!product) return res.status(400).json({ error: "Produto ausente." });
  try {
    const copy = await generateCopy(product, style);
    res.json({ copy, text: copy.whatsapp });
  } catch (err) {
    res.status(502).json({ error: err.message || "Erro ao gerar o texto." });
  }
});

/**
 * POST /api/generate/art
 * body: { product, template, format, manualPhoto? }
 *
 * Gera a arte final (PNG real, em memória) no servidor — a correção do
 * problema "a imagem não aparece automaticamente". `manualPhoto` pode ser
 * um link http(s) ou um data:image/... (upload) colado pela pessoa; se
 * ausente, usa a foto que a API/og:image já encontrou.
 *
 * Responde a imagem diretamente (Content-Type: image/png) para o frontend
 * exibir num <img>/baixar sem nenhum processamento client-side.
 */
router.post("/art", artLimiter, async (req, res) => {
  const { product, template, format, manualPhoto } = req.body || {};
  if (!product) return res.status(400).json({ error: "Produto ausente." });
  if (!TEMPLATES.includes(template)) {
    return res.status(400).json({ error: `Template inválido. Use um de: ${TEMPLATES.join(", ")}.` });
  }
  if (!FORMATS[format]) {
    return res.status(400).json({ error: `Formato inválido. Use um de: ${Object.keys(FORMATS).join(", ")}.` });
  }

  try {
    const photo = await resolveProductPhoto(product, manualPhoto || null);
    const { buffer } = await renderArt({
      product,
      photoBuffer: photo.buffer,
      photoContentType: photo.contentType,
      templateKey: template,
      formatKey: format,
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Photo-Source", photo.source);
    res.send(buffer);
  } catch (err) {
    console.error("[generate/art]", err);
    res.status(502).json({ error: err.message || "Erro ao gerar a arte. Tente novamente." });
  }
});

export default router;
