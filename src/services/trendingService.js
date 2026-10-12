import { callShopeeAffiliateApi, hasCredentials } from "./shopeeAffiliateClient.js";

/**
 * trendingService
 *
 * Lista produtos "em alta" usando a API oficial de afiliados da Shopee
 * (productOfferV2 com ordenação por vendas). Nada de scraping.
 *
 * ATENÇÃO: os valores de `sortType`/`listType` abaixo vêm da documentação
 * pública da API (sortType 2 = mais vendidos). Eu não consegui testar contra
 * a API real daqui. Por isso:
 *   - os valores são configuráveis por variável de ambiente;
 *   - se a Shopee recusar a consulta, o erro real aparece e o schema dos
 *     argumentos de `productOfferV2` é impresso no log do servidor (mesma
 *     técnica de introspecção que usamos antes), para ajustarmos sem chute.
 */

const SORT_TYPE = Number(process.env.SHOPEE_TRENDING_SORT_TYPE || 2); // 2 = ITEM_SOLD_DESC
const LIST_TYPE = process.env.SHOPEE_TRENDING_LIST_TYPE; // opcional (ex.: 2 = mais vendidos da plataforma)

// Campos já confirmados por introspecção real nesta conta:
const SAFE_FIELDS = ["itemId", "productName", "price", "priceMin", "priceMax", "priceDiscountRate", "imageUrl", "shopName", "offerLink"];
// Campos extras (úteis, mas não confirmados) — se algum não existir, caímos no conjunto seguro:
const RICH_FIELDS = [...SAFE_FIELDS, "shopId", "sales", "ratingStar", "commissionRate", "productLink"];

function buildQuery(fields) {
  const listArg = LIST_TYPE ? ", $listType: Int" : "";
  const listPass = LIST_TYPE ? ", listType: $listType" : "";
  return `
    query Trending($limit: Int, $page: Int, $sortType: Int${listArg}) {
      productOfferV2(limit: $limit, page: $page, sortType: $sortType${listPass}) {
        nodes { ${fields.join(" ")} }
      }
    }
  `;
}

async function logArgsSchema() {
  try {
    const data = await callShopeeAffiliateApi(
      `query { __type(name: "Query") { fields { name args { name type { kind name ofType { kind name } } } } } }`,
      {}
    );
    const f = (data?.__type?.fields || []).find((x) => x.name === "productOfferV2");
    console.warn("[trendingService] Argumentos aceitos por productOfferV2:", JSON.stringify(f, null, 2));
  } catch (e) {
    console.warn("[trendingService] Não foi possível consultar o schema:", e.message);
  }
}

function mapNode(node) {
  const price = node.price != null ? Number(node.price) : null;
  const discountPercentage = node.priceDiscountRate != null ? Number(node.priceDiscountRate) : null;
  const originalPrice =
    price != null && discountPercentage ? Math.round((price / (1 - discountPercentage / 100)) * 100) / 100 : null;
  const shopId = node.shopId != null ? String(node.shopId) : null;
  const itemId = String(node.itemId);
  const url = node.productLink || (shopId ? `https://shopee.com.br/product/${shopId}/${itemId}` : node.offerLink || null);

  return {
    id: shopId ? `shopee_${shopId}_${itemId}` : `shopee_${itemId}`,
    url,
    title: node.productName || "Produto Shopee",
    images: node.imageUrl ? [node.imageUrl] : [],
    price,
    originalPrice,
    discountPercentage,
    rating: node.ratingStar != null ? Number(node.ratingStar) : null,
    reviewCount: null,
    sales: node.sales != null ? Number(node.sales) : null,
    commissionRate: node.commissionRate != null ? String(node.commissionRate) : null,
    description: null,
    features: [],
    seller: node.shopName || null,
    category: null,
    offerLink: node.offerLink || null,
  };
}

export async function getTrendingProducts({ limit = 20, page = 1 } = {}) {
  if (!hasCredentials()) {
    throw new Error("Produtos em alta exigem as credenciais da API de afiliados (SHOPEE_AFFILIATE_APP_ID/SECRET).");
  }
  const variables = { limit: Math.min(Math.max(Number(limit) || 20, 1), 50), page: Number(page) || 1, sortType: SORT_TYPE };
  if (LIST_TYPE) variables.listType = Number(LIST_TYPE);

  let data;
  try {
    data = await callShopeeAffiliateApi(buildQuery(RICH_FIELDS), variables);
  } catch (richErr) {
    console.warn("[trendingService] Consulta com campos extras falhou, tentando só os confirmados:", richErr.message);
    try {
      data = await callShopeeAffiliateApi(buildQuery(SAFE_FIELDS), variables);
    } catch (err) {
      await logArgsSchema();
      throw new Error(`A Shopee recusou a consulta de produtos em alta: ${err.message}`);
    }
  }

  const nodes = data?.productOfferV2?.nodes || [];
  return nodes.filter((n) => n && n.itemId != null).map(mapNode).filter((p) => p.url && p.price != null);
}
