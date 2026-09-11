import { nanoid } from "nanoid";
import * as cheerio from "cheerio";

/**
 * productService
 *
 * v2: tenta buscar o produto de verdade fazendo scraping da página pública
 * da Shopee (sem login, sem API paga). Isso é um "melhor esforço": a Shopee
 * pode bloquear acessos automatizados, exigir captcha, ou mudar a estrutura
 * da página sem aviso — quando isso acontece, lançamos um erro claro em vez
 * de fingir que funcionou.
 *
 * Quando o programa de afiliados oficial da Shopee estiver configurado
 * (variável SHOPEE_API_KEY no .env), a busca passa a usar a API oficial em
 * vez de scraping — ver fetchProductViaApi() abaixo (ainda não implementada).
 */

const REQUEST_TIMEOUT_MS = 12000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function isValidShopeeUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /shopee\.[a-z.]+\//i.test(url.trim()) || /^https?:\/\/(s\.)?shopee/i.test(url.trim());
}

/** Ponto de entrada usado pelo resto do app — decide a fonte dos dados. */
export async function fetchProduct(url) {
  if (process.env.SHOPEE_API_KEY) {
    return fetchProductViaApi(url);
  }
  return fetchProductViaScraping(url);
}

/**
 * MOCK — mantido só para testes/desenvolvimento. Ative com
 * PRODUCT_SOURCE=mock no .env caso o scraping esteja instável durante o
 * desenvolvimento do resto do app.
 */
const MOCK_PRODUCTS = [
  {
    title: "Organizador de Gavetas 6 Divisórias Multiuso",
    images: ["🗄️"],
    price: 39.9,
    originalPrice: 59.9,
    discountPercentage: 33,
    description: "Organizador plástico com divisórias ajustáveis para gavetas de cozinha, banheiro ou quarto.",
    features: ["6 divisórias ajustáveis", "Fácil de montar, sem parafusos", "Material resistente e lavável"],
  },
];

export async function fetchProductMock(url) {
  const hash = hashString(url);
  const base = MOCK_PRODUCTS[hash % MOCK_PRODUCTS.length];
  return { id: `mock_${hash}_${nanoid(6)}`, url, ...base };
}

/** Ainda não implementada — entra quando SHOPEE_API_KEY estiver configurada. */
async function fetchProductViaApi(url) {
  throw new Error(
    "A API oficial de afiliados da Shopee ainda não foi integrada. Remova SHOPEE_API_KEY do .env para usar o scraping, ou implemente fetchProductViaApi em productService.js."
  );
}

/** Busca real via scraping da página pública do produto. */
async function fetchProductViaScraping(rawUrl) {
  const html = await fetchHtml(rawUrl);
  const $ = cheerio.load(html);

  const og = (prop) => $(`meta[property="${prop}"]`).attr("content")?.trim();
  const title = og("og:title") || $("title").first().text().trim() || null;
  const image = og("og:image") || null;
  const description = og("og:description") || null;

  const jsonLd = extractJsonLdProduct($);
  const { price, originalPrice } = extractPrices(html, jsonLd);

  if (!title && !image) {
    throw new Error(
      "Não foi possível extrair os dados deste produto. A Shopee pode ter bloqueado o acesso automatizado ou mudado a estrutura da página — tente novamente em alguns minutos ou use outro link."
    );
  }

  const discountPercentage =
    price != null && originalPrice != null && originalPrice > 0
      ? Math.round((1 - price / originalPrice) * 100)
      : null;

  const id = `shopee_${hashString(rawUrl)}_${nanoid(6)}`;

  return {
    id,
    url: rawUrl,
    title: title || "Produto Shopee",
    images: image ? [image] : [],
    price,
    originalPrice,
    discountPercentage,
    rating: null,
    reviewCount: null,
    description: description || null,
    features: [], // a Shopee não expõe uma lista estruturada de características no HTML público
    seller: null,
    category: null,
  };
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      redirect: "follow", // resolve links curtos (s.shopee.com.br/...)
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "pt-BR,pt;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("A Shopee demorou demais para responder. Tente novamente.");
    }
    throw new Error("Não foi possível acessar esse link. Confira se está correto.");
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 403 || res.status === 429) {
    throw new Error("A Shopee bloqueou esta tentativa de acesso automatizado (proteção antibot). Tente novamente mais tarde.");
  }
  if (!res.ok) {
    throw new Error(`A Shopee respondeu com erro (status ${res.status}).`);
  }

  const html = await res.text();
  const lower = html.toLowerCase();
  if (lower.includes("attention required") || lower.includes("cf-browser-verification") || lower.includes("captcha")) {
    throw new Error("A Shopee exigiu verificação anti-robô (captcha) para esta página. Não foi possível continuar automaticamente.");
  }
  return html;
}

function extractJsonLdProduct($) {
  let found = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    try {
      const data = JSON.parse($(el).contents().text());
      const candidates = Array.isArray(data) ? data : [data];
      for (const c of candidates) {
        if (c && (c["@type"] === "Product" || (Array.isArray(c["@type"]) && c["@type"].includes("Product")))) {
          found = c;
          break;
        }
      }
    } catch {
      // JSON-LD malformado ou ausente nesta página — ignora e segue com outros métodos
    }
  });
  return found;
}

function extractPrices(html, jsonLd) {
  const offer = jsonLd?.offers ? (Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers) : null;
  const jsonLdPrice = offer?.price ? Number(offer.price) : null;
  if (jsonLdPrice) {
    return { price: jsonLdPrice, originalPrice: null }; // JSON-LD raramente traz o preço "de"
  }

  // Heurística de último recurso: procura padrões "R$ 39,90" no HTML.
  // Frágil por natureza — a Shopee pode mudar isso a qualquer momento.
  const matches = [...html.matchAll(/R\$\s*([\d.]{1,3}(?:\.\d{3})*,\d{2})/g)].map((m) =>
    Number(m[1].replace(/\./g, "").replace(",", "."))
  );
  if (matches.length === 0) return { price: null, originalPrice: null };
  if (matches.length === 1) return { price: matches[0], originalPrice: null };
  // Se houver dois valores diferentes, assume o menor como preço atual e o maior como "de"
  const sorted = [...new Set(matches)].sort((a, b) => a - b);
  return { price: sorted[0], originalPrice: sorted.length > 1 ? sorted[sorted.length - 1] : null };
}

function hashString(str) {
  let hash = 0;
  for (const c of str) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash;
}
