import { nanoid } from "nanoid";
import * as cheerio from "cheerio";
import { callShopeeAffiliateApi, hasCredentials } from "./shopeeAffiliateClient.js";

/**
 * productService
 *
 * Ordem de tentativa:
 *   1. API oficial de afiliados da Shopee, se SHOPEE_AFFILIATE_APP_ID e
 *      SHOPEE_AFFILIATE_SECRET estiverem configurados (fetchProductViaApi).
 *   2. Scraping da página pública, como reserva caso a API falhe ou não
 *      tenha esse produto no catálogo (fetchProductViaScraping).
 *
 * IMPORTANTE: o formato exato da consulta da API (nomes de campos) foi
 * montado com base em documentação de terceiros — eu não consegui testar
 * contra a API real. Se der erro, me manda a mensagem exata que a Shopee
 * devolver (aparece nos logs do servidor / na resposta de erro) que eu
 * ajusto os nomes dos campos.
 */

const REQUEST_TIMEOUT_MS = 12000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function isValidShopeeUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /shopee\.[a-z.]+\//i.test(url.trim()) || /^https?:\/\/(s\.)?shopee/i.test(url.trim());
}

/** Ponto de entrada usado pelo resto do app. */
export async function fetchProduct(url) {
  if (hasCredentials()) {
    try {
      return await fetchProductViaApi(url);
    } catch (err) {
      console.warn("[productService] API falhou, tentando scraping como reserva:", err.message);
    }
  }
  return fetchProductViaScraping(url);
}

/** Extrai shopId/itemId de um link de produto Shopee (padrões conhecidos). */
function parseShopeeIds(url) {
  const clean = url.split("?")[0];
  // padrão novo: .../{algo}/{shopId}/{itemId}
  let m = clean.match(/\/(\d{5,})\/(\d{5,})\/?$/);
  if (m) return { shopId: m[1], itemId: m[2] };
  // padrão antigo: ...-i.{shopId}.{itemId}
  m = clean.match(/-i\.(\d+)\.(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2] };
  return null;
}

async function fetchProductViaApi(url) {
  const ids = parseShopeeIds(url);
  if (!ids) {
    throw new Error("Não foi possível identificar o produto a partir deste link (formato de URL não reconhecido).");
  }

  const query = `
    query ProductOffer($itemId: Int64, $shopId: Int64) {
      productOfferV2(itemId: $itemId, shopId: $shopId) {
        nodes {
          itemId
          productName
          price
          priceMin
          priceMax
          priceDiscountRate
          imageUrl
          shopName
          offerLink
        }
      }
    }
  `;
  const variables = { itemId: String(ids.itemId), shopId: String(ids.shopId) };

  try {
    const data = await callShopeeAffiliateApi(query, variables);
    const node = data?.productOfferV2?.nodes?.[0];
    if (!node) {
      throw new Error("A API de afiliados não encontrou este produto no catálogo.");
    }

    // Log temporário de diagnóstico — mostra tudo que a API devolveu, pra
    // conferirmos qual campo é a imagem em tamanho real e qual é o preço à
    // vista (sem ainda saber os nomes certos desses campos).
    console.warn("[productService] Produto bruto devolvido pela API:", JSON.stringify(node, null, 2));
    await logProductOfferNodeSchema();

    const price = node.priceMin != null ? Number(node.priceMin) : node.price != null ? Number(node.price) : null;
    const priceMax = node.priceMax != null ? Number(node.priceMax) : null;
    const discountPercentage = node.priceDiscountRate != null ? Number(node.priceDiscountRate) : null;

    return {
      id: `shopee_${ids.shopId}_${ids.itemId}`,
      url,
      title: node.productName || "Produto Shopee",
      images: node.imageUrl ? [node.imageUrl] : [],
      price,
      originalPrice: priceMax && priceMax !== price ? priceMax : null,
      discountPercentage,
      rating: null,
      reviewCount: null,
      description: null,
      features: [],
      seller: node.shopName || null,
      category: null,
    };
  } catch (err) {
    // Diagnóstico único: pergunta pra própria API qual é o formato exato
    // esperado, pra não continuarmos chutando o tipo/nome dos campos.
    await logProductOfferSchema();
    throw err;
  }
}

async function logProductOfferNodeSchema() {
  try {
    const introspection = `
      query {
        __schema {
          types { name kind fields { name } }
        }
      }
    `;
    const data = await callShopeeAffiliateApi(introspection, {});
    const types = (data?.__schema?.types || []).filter((t) => t.fields && /offer|product/i.test(t.name || ""));
    const summary = types.map((t) => ({ name: t.name, fields: t.fields.map((f) => f.name) }));
    console.warn("[productService] Campos disponíveis nos tipos de produto/oferta:", JSON.stringify(summary, null, 2));
  } catch (e) {
    console.warn("[productService] Falha ao listar campos disponíveis:", e.message);
  }
}

async function logProductOfferSchema() {
  try {
    const introspection = `
      query {
        __type(name: "Query") {
          fields {
            name
            args {
              name
              type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
            }
          }
        }
      }
    `;
    const data = await callShopeeAffiliateApi(introspection, {});
    const fields = data?.__type?.fields || [];
    const match = fields.find((f) => f.name.toLowerCase().includes("productoffer"));
    console.warn("[productService] Formato esperado pela API da Shopee para busca de produto:", JSON.stringify(match, null, 2));
    if (!match) {
      console.warn("[productService] Campos disponíveis na API:", fields.map((f) => f.name).join(", "));
    }
  } catch (introspectionErr) {
    console.warn("[productService] Não foi possível consultar o schema da API:", introspectionErr.message);
  }
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
