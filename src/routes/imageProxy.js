import { Router } from "express";

const router = Router();

/**
 * GET /api/image-proxy?url=<imagem da Shopee>
 *
 * Busca a imagem no servidor (sem restrição de CORS, porque é o backend
 * quem faz a requisição, não o navegador) e devolve pela nossa própria
 * origem. Isso é necessário porque a imagem original da Shopee não libera
 * uso em <canvas> (o que impede baixar/compartilhar a arte final com a
 * foto real embutida).
 *
 * Restrito a domínios da própria Shopee para não virar um proxy aberto.
 */
router.get("/", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Parâmetro url ausente.");

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return res.status(400).send("URL inválida.");
  }
  if (!hostname.includes("shopee") && !hostname.includes("susercontent")) {
    return res.status(403).send("Domínio de imagem não permitido.");
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(502).send("Não foi possível buscar a imagem.");
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch {
    res.status(502).send("Erro ao buscar a imagem.");
  }
});

export default router;
