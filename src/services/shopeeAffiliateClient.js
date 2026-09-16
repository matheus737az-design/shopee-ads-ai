import crypto from "node:crypto";

/**
 * Cliente compartilhado para a API oficial de afiliados da Shopee (GraphQL).
 * Usado tanto por productService (buscar dados de produto) quanto por
 * affiliateService (gerar link de afiliado) — a autenticação é a mesma
 * para as duas coisas.
 */

const ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";

export function hasCredentials() {
  return Boolean(process.env.SHOPEE_AFFILIATE_APP_ID && process.env.SHOPEE_AFFILIATE_SECRET);
}

export async function callShopeeAffiliateApi(query, variables) {
  const appId = process.env.SHOPEE_AFFILIATE_APP_ID;
  const secret = process.env.SHOPEE_AFFILIATE_SECRET;
  if (!appId || !secret) {
    throw new Error("Credenciais da API de afiliados não configuradas.");
  }

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
