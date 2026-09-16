import { callShopeeAffiliateApi, hasCredentials } from "./shopeeAffiliateClient.js";

/**
 * affiliateService
 * Usa a API oficial de afiliados quando SHOPEE_AFFILIATE_APP_ID/SECRET
 * estiverem configurados; senão cai num mock simples (dev/teste).
 */
export async function toAffiliateLink(url) {
  if (!hasCredentials()) {
    return url.includes("?") ? `${url}&af_id=MOCK123` : `${url}?af_id=MOCK123`;
  }

  const query = `
    mutation GenerateShortLink($input: ShortLinkInput!) {
      generateShortLink(input: $input) {
        shortLink
      }
    }
  `;
  const variables = { input: { originUrl: url, subIds: ["shopeeadsai"] } };

  const data = await callShopeeAffiliateApi(query, variables);
  const shortLink = data?.generateShortLink?.shortLink;
  if (!shortLink) {
    throw new Error("A API de afiliados da Shopee não retornou um link para este produto.");
  }
  return shortLink;
}
