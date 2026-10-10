import { callShopeeAffiliateApi, hasCredentials } from "./shopeeAffiliateClient.js";

/**
 * affiliateService
 *
 * Regra importante pedida: NUNCA substituir silenciosamente um link que a
 * pessoa já colou (que já é de afiliado) por outra coisa, e nunca afirmar
 * que uma venda será comissionada se não houver garantia real disso.
 *
 * Lógica:
 *   1. Se o link colado já parece ser um link de afiliado (shortlink da
 *      Shopee, ou já tem parâmetros de afiliado conhecidos), ele é
 *      PRESERVADO como está — não tentamos gerar outro por cima.
 *   2. Se não for um link de afiliado e houver credenciais da API oficial,
 *      geramos um link de afiliado real via generateShortLink.
 *   3. Se não for um link de afiliado e NÃO houver credenciais, devolvemos
 *      o link original (sem fingir um "af_id=MOCK123" como se fosse real)
 *      e avisamos explicitamente que esse link pode não gerar comissão.
 */

const AAFFILIATE_HOST_HINTS = ["s.shopee", "shp.ee", "affiliate"];
const AFFILIATE_PARAM_HINTS = ["af_id", "af_siteid", "affiliate_id", "utm_source=affiliate", "smtt"];

export function looksLikeAffiliateLink(url) {
  try {
    const u = new URL(url);
    if (AAFFILIATE_HOST_HINTS.some((h) => u.hostname.includes(h))) return true;
    const query = u.search.toLowerCase();
    return AFFILIATE_PARAM_HINTS.some((p) => query.includes(p));
  } catch {
    return false;
  }
}

/**
 * @returns {{ link: string, isAffiliate: boolean, warning: string|null }}
 */
export async function toAffiliateLink(url) {
  if (looksLikeAffiliateLink(url)) {
    return { link: url, isAffiliate: true, warning: null };
  }

  if (hasCredentials()) {
    try {
      const query = `
        mutation GenerateShortLink($input: ShortLinkInput!) {
          generateShortLink(input: $input) { shortLink }
        }
      `;
      const variables = { input: { originUrl: url, subIds: ["shopeeadsai"] } };
      const data = await callShopeeAffiliateApi(query, variables);
      const shortLink = data?.generateShortLink?.shortLink;
      if (shortLink) {
        return { link: shortLink, isAffiliate: true, warning: null };
      }
      return {
        link: url,
        isAffiliate: false,
        warning: "A API de afiliados não retornou um link para este produto. Este é o link original — pode não gerar comissão.",
      };
    } catch (err) {
      console.warn("[affiliateService] Falha ao gerar link de afiliado:", err.message);
      return {
        link: url,
        isAffiliate: false,
        warning: "Não foi possível gerar um link de afiliado agora. Este é o link original — pode não gerar comissão.",
      };
    }
  }

  return {
    link: url,
    isAffiliate: false,
    warning: "Este link não parece ser de afiliado e não há credenciais da API configuradas para gerar um. Publicar com este link pode não gerar comissão.",
  };
}
