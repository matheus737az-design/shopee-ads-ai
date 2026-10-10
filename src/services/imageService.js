import * as cheerio from "cheerio";
import { assertSafeUrl } from "./ssrfGuard.js";

/**
 * imageService
 *
 * Responsável por conseguir a FOTO REAL do produto, com esta prioridade:
 *   1. A imagem que a API oficial de afiliados da Shopee devolveu
 *      (product.images[0], já populado por productService.js).
 *   2. Metadado Open Graph (og:image) da própria página pública do produto,
 *      como reserva, se a API não trouxe foto.
 *   3. Upload manual feito pela pessoa na tela de resultado.
 *
 * Nunca inventa nem usa um emoji/imagem genérica fingindo ser a foto real —
 * quando nenhuma das três fontes acima funciona, o chamador (artRenderService)
 * desenha um layout sem foto, deixando isso explícito.
 *
 * Toda busca de URL passa por validação SSRF (ssrfGuard.js) e por validação
 * de redirecionamento (cada hop é revalidado), MIME e tamanho.
 */

const REQUEST_TIMEOUT_MS = 10000;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_REDIRECTS = 5;
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/*,*/*",
};

/**
 * Busca uma imagem de qualquer URL http(s) com proteção SSRF completa:
 * - valida o host antes de cada requisição E antes de seguir cada redirect
 *   (evita que um domínio público redirecione para a rede interna).
 * - não usa `redirect: "follow"` do fetch (que não revalida); segue os
 *   redirects manualmente.
 * - limita tamanho e exige Content-Type image/*.
 *
 * Retorna { buffer, contentType } ou lança um erro com mensagem em pt-BR.
 */
export async function fetchImageSafely(rawUrl, { referer } = {}) {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = await assertSafeUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          ...BROWSER_HEADERS,
          Referer: referer || `${parsed.protocol}//${parsed.hostname}/`,
        },
      });
    } catch (err) {
      if (err.name === "AbortError") throw new Error("A busca da imagem demorou demais e foi cancelada.");
      throw new Error("Não foi possível buscar essa imagem.");
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) throw new Error("Redirecionamento inválido ao buscar a imagem.");
      currentUrl = new URL(location, currentUrl).toString();
      continue; // próximo laço revalida o novo host contra SSRF antes de seguir
    }

    if (!res.ok) {
      throw new Error(`Não foi possível buscar a imagem (status ${res.status}).`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      throw new Error("O link informado não aponta para uma imagem.");
    }

    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_BYTES) {
      throw new Error("Imagem muito grande (limite de 8 MB).");
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      throw new Error("Imagem muito grande (limite de 8 MB).");
    }
    return { buffer: buf, contentType };
  }
  throw new Error("Muitos redirecionamentos ao buscar a imagem.");
}

/**
 * Tenta achar uma foto pública na própria página do produto (og:image),
 * usada apenas como reserva quando a API de afiliados não trouxe imagem.
 */
export async function fetchOpenGraphImage(productUrl) {
  const parsed = await assertSafeUrl(productUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(productUrl, {
      redirect: "follow", // página HTML pública, sem o mesmo risco de a resposta final ser consumida como recurso binário
      signal: controller.signal,
      headers: { ...BROWSER_HEADERS, "Accept-Language": "pt-BR,pt;q=0.9", Accept: "text/html" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const og = $('meta[property="og:image"]').attr("content");
    return og ? og.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve a foto a ser usada no anúncio, nesta ordem de prioridade, e diz
 * explicitamente de onde veio (para nunca fingir que uma foto é "a foto
 * real do produto" quando não é):
 *   1. manualOverride (upload ou link que a pessoa colou na tela de resultado)
 *   2. product.images[0] (API oficial de afiliados)
 *   3. og:image da própria página pública do produto
 *
 * Retorna { buffer, contentType, source } ou { buffer: null, source: "none" }
 * quando nenhuma fonte funcionou — nesse caso o layout é desenhado sem foto.
 */
export async function resolveProductPhoto(product, manualOverride) {
  // 1. Upload manual em base64 (data:image/...;base64,....)
  if (manualOverride && typeof manualOverride === "string" && manualOverride.startsWith("data:image")) {
    const match = manualOverride.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error("Arquivo de imagem enviado em formato inválido.");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > MAX_BYTES) throw new Error("Imagem enviada é grande demais (limite de 8 MB).");
    return { buffer, contentType: match[1], source: "upload" };
  }

  // 2. Link manual (URL colada pela pessoa)
  if (manualOverride && typeof manualOverride === "string" && manualOverride.startsWith("http")) {
    const { buffer, contentType } = await fetchImageSafely(manualOverride);
    return { buffer, contentType, source: "manual-url" };
  }

  // 3. Foto que a API de afiliados devolveu
  const apiImage = product?.images?.[0];
  if (apiImage && typeof apiImage === "string" && apiImage.startsWith("http")) {
    try {
      const { buffer, contentType } = await fetchImageSafely(apiImage);
      return { buffer, contentType, source: "affiliate-api" };
    } catch (err) {
      console.warn("[imageService] Falha ao baixar foto da API de afiliados:", err.message);
    }
  }

  // 4. og:image da página pública, como última tentativa automática
  if (product?.url) {
    try {
      const og = await fetchOpenGraphImage(product.url);
      if (og) {
        const { buffer, contentType } = await fetchImageSafely(og);
        return { buffer, contentType, source: "open-graph" };
      }
    } catch (err) {
      console.warn("[imageService] Falha ao buscar og:image:", err.message);
    }
  }

  return { buffer: null, contentType: null, source: "none" };
}
