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
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Referer: "https://shopee.com.br/",
        Accept: "image/avif,image/webp,image/*,*/*",
      },
    });
    if (!upstream.ok) {
      console.warn(`[imageProxy] Shopee respondeu ${upstream.status} para ${url}`);
      return res.status(502).send("Não foi possível buscar a imagem.");
    }
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    console.warn("[imageProxy] Erro ao buscar imagem:", err.message);
    res.status(502).send("Erro ao buscar imagem.");
  }
});

export default router;
