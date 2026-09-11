import { Router } from "express";
import { isValidShopeeUrl, fetchProduct } from "../services/productService.js";
import { generateCopy } from "../services/aiService.js";
import { toAffiliateLink } from "../services/affiliateService.js";
import { saveProduct } from "../db/productRepository.js";

const router = Router();

/**
 * POST /api/generate
 * body: { url, style }
 * Orquestra: valida link -> busca produto -> gera texto -> gera link de afiliado.
 * Não salva no histórico ainda (isso só acontece quando o usuário salva/publica).
 */
router.post("/", async (req, res) => {
  const { url, style = "oferta" } = req.body || {};

  if (!isValidShopeeUrl(url)) {
    return res.status(400).json({ error: "Insira um link válido de produto da Shopee." });
  }

  try {
    const product = await fetchProduct(url);
    saveProduct(product);
    const text = await generateCopy(product, style);
    const affiliateLink = await toAffiliateLink(product.url);

    res.json({ product, text, affiliateLink });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message || "Erro ao gerar o anúncio. Tente novamente." });
  }
});

/** POST /api/generate/text — regenerar só o texto, com outro estilo */
router.post("/text", async (req, res) => {
  const { product, style } = req.body || {};
  if (!product) return res.status(400).json({ error: "Produto ausente." });
  const text = await generateCopy(product, style);
  res.json({ text });
});

export default router;
