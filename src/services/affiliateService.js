import crypto from "node:crypto";

/**
 * affiliateService
 *
 * Com SHOPEE_AFFILIATE_APP_ID e SHOPEE_AFFILIATE_SECRET configurados no
 * .env, gera links de afiliado de verdade via API oficial da Shopee
 * (GraphQL, autenticado com HMAC-SHA256). Sem essas credenciais, cai num
 * mock simples — só pra não travar o resto do app durante o desenvolvimento.
 *
 * IMPORTANTE: a assinatura exata da API (nomes de campos, formato do input)
 * foi montada com base em documentação de terceiros que integram essa API —
 * eu não consegui testar contra a API real (sem acesso à internet aqui).
 * Se dar erro na primeira tentativa, me manda a mensagem de erro que a
 * própria API da Shopee devolver — ela costuma dizer exatamente qual campo
 * está errado, e eu ajusto.
 */

const ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";

export async function toAffiliateLink(url) {
  const appId = process.env.SHOPEE_AFFILIATE_APP_ID;
  const secret = process.env.SHOPEE_AFFILIATE_SECRET;

  if (!appId || !secret) {
    // MOCK — usado até as credenciais reais serem configuradas
    return url.includes("?") ? `${url}&af_id=MOCK123` : `${url}?af_id=MOCK123`;
  }

  const query = `
    mutation GenerateShortLink($input: ShortLinkInput!) {
      generateShortLink(input: $input) {
        shortLink
      }
    }
  `;
  const variables = {
    input: {
      originUrl: url,
      subIds: ["shopeeadsai"],
    },
  };

  const data = await callShopeeAffiliateApi(appId, secret, query, variables);
  const shortLink = data?.generateShortLink?.shortLink;
  if (!shortLink) {
    throw new Error("A API de afiliados da Shopee não retornou um link para este produto.");
  }
  return shortLink;
}

async function callShopeeAffiliateApi(appId, secret, query, variables) {
  const body = JSON.stringify({ query, variables });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash("sha256")
    .update(`${appId}${timestamp}${body}${secret}`)
    .digest("hex");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || json?.errors?.length) {
    const msg = json?.errors?.[0]?.message || `Erro ${res.status} ao falar com a API de afiliados da Shopee.`;
    throw new Error(msg);
  }
  return json.data;
}
