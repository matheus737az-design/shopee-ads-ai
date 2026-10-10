import { Router } from "express";
import { fetchImageSafely } from "../services/imageService.js";

const router = Router();

/**
 * GET /api/image-proxy?url=<qualquer imagem http(s)>
 *
 * Usado pelo frontend para:
 *  - mostrar no <canvas>/preview uma imagem de outro domínio sem problema de
 *    CORS/"tainted canvas" (porque quem busca é o nosso servidor, não o navegador).
 *  - a pessoa poder colar o link de QUALQUER imagem (não só da Shopee) na tela
 *    de resultado e ver se funciona antes de gerar a arte final.
 *
 * Antes isso era restrito a domínios "shopee"/"susercontent" — removido
 * porque bloqueava a própria funcionalidade de colar uma foto manual de
 * outro lugar. A segurança agora vem de fetchImageSafely (SSRF guard real:
 * valida protocolo, resolve e bloqueia IP privado/interno, revalida cada
 * redirecionamento, exige Content-Type image/* e limita tamanho) em vez de
 * uma lista de domínios permitidos.
 */
router.get("/", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") return res.status(400).send("Parâmetro url ausente.");

  try {
    const { buffer, contentType } = await fetchImageSafely(url);
    res.setHeader("Content-Type", contentType || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (err) {
    console.warn("[imageProxy] Erro ao buscar imagem:", err.message);
    res.status(502).send(err.message || "Erro ao buscar imagem.");
  }
});

export default router;
