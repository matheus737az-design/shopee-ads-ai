/**
 * aiService
 *
 * Gera o conjunto completo de textos pedido:
 *   - título curto
 *   - legenda para WhatsApp
 *   - legenda para Instagram
 *   - CTA (chamada para ação)
 *   - uma versão alternativa
 *
 * Duas fontes possíveis:
 *   1. IA real (Anthropic/Claude), SE a variável de ambiente
 *      ANTHROPIC_API_KEY estiver configurada. A chamada roda só no backend —
 *      a chave nunca é enviada ao navegador.
 *   2. Gerador por templates (mock), usado quando não há chave configurada.
 *      Continua claramente marcado como mock no campo `source` da resposta,
 *      nunca apresentado como IA real quando não é.
 *
 * Em NENHUM dos dois modos o texto inventa desconto, "últimas unidades",
 * "menor preço do Brasil" ou avaliações falsas — só usa os dados reais que
 * vieram do produto.
 */

export const TEXT_STYLES = [
  { key: "oferta", label: "Oferta", emoji: "🔥", desc: "Preço, desconto e urgência real" },
  { key: "beneficio", label: "Benefício", emoji: "💡", desc: "Problema que resolve" },
  { key: "desejo", label: "Desejo", emoji: "😍", desc: "Vontade de comprar" },
  { key: "viral", label: "Viral", emoji: "⚡", desc: "Curto, redes sociais" },
  { key: "profissional", label: "Profissional", emoji: "🛍️", desc: "Comercial e limpo" },
];

const REQUEST_TIMEOUT_MS = 20000;

function money(v) {
  return v == null ? null : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function hasRealAiCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Monta o bloco de fatos reais do produto — é só isso que a IA (ou o mock) pode usar. */
function factsBlock(product) {
  const lines = [
    `Nome: ${product.title || "Produto Shopee"}`,
    product.price != null ? `Preço atual: ${money(product.price)}` : null,
    product.originalPrice != null ? `Preço anterior: ${money(product.originalPrice)}` : null,
    product.discountPercentage != null ? `Desconto: ${product.discountPercentage}%` : null,
    product.description ? `Descrição: ${product.description}` : null,
    (product.features || []).length ? `Características: ${product.features.join("; ")}` : null,
    product.seller ? `Vendedor: ${product.seller}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Chama a API da Anthropic (Claude) para gerar os 5 campos em JSON.
 * Lança erro se a chamada falhar — o chamador decide se cai para o mock.
 */
async function generateCopyWithRealAi(product, styleKey) {
  const styleLabel = TEXT_STYLES.find((s) => s.key === styleKey)?.label || "Oferta";
  const prompt = `Você escreve posts de venda para afiliados brasileiros divulgarem produtos da Shopee em redes sociais.

Dados REAIS do produto (não invente nada além disto):
${factsBlock(product)}

Estilo pedido: ${styleLabel}.

Gere um JSON com exatamente estes campos, em português do Brasil, tom natural (como uma pessoa real escreveria, não um robô de marketing):
- "title": título curto (até 60 caracteres)
- "whatsapp": legenda curta para WhatsApp (até 3 linhas, pode usar 1-2 emojis)
- "instagram": legenda para Instagram (pode ser um pouco mais longa, com quebras de linha e emojis)
- "cta": uma chamada para ação curta (ex. "Confira agora", "Garanta o seu")
- "alternative": uma versão alternativa completa da legenda (ângulo diferente do mesmo produto)

Regras obrigatórias:
- NUNCA invente desconto, estoque, prazo, "menor preço do Brasil" ou avaliações que não estejam nos dados acima.
- Se não houver preço anterior/desconto nos dados, não mencione desconto.
- Responda APENAS com o JSON, sem markdown, sem texto antes ou depois.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API de IA respondeu ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const raw = data?.content?.[0]?.text || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("A IA não devolveu um JSON válido.");
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.whatsapp || !parsed.instagram) throw new Error("Resposta da IA incompleta.");
    return { ...parsed, source: "ai" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Fallback por template — usado quando não há ANTHROPIC_API_KEY ou a IA real falhou. */
function generateCopyWithTemplate(product, styleKey) {
  const feats = (product.features || []).slice(0, 3).map((f) => `✨ ${f}`).join("\n");
  const priceLine = product.originalPrice
    ? `💰 De ${money(product.originalPrice)} por ${money(product.price)}`
    : product.price != null
    ? `💰 Por ${money(product.price)}`
    : "";
  const title = (product.title || "Produto Shopee").slice(0, 60);

  const byStyle = {
    oferta: {
      whatsapp: `🔥 ${title}\n${priceLine}\n👉 Confira o link!`,
      instagram: `🔥 OLHA ESSA OFERTA!\n\n${title}\n\n${feats}\n\n${priceLine}\n\n👉 Link na bio/comentário!`,
      cta: "Garanta o seu",
      alternative: `Separei esse achado pra você: ${title}. ${priceLine}. Vale a pena dar uma olhada!`,
    },
    beneficio: {
      whatsapp: `${title} pode facilitar seu dia a dia.\n${priceLine}\n👉 Dá uma olhada:`,
      instagram: `Cansado(a) de perder tempo com isso? 👀\n\n${title} ajuda nessa.\n\n${feats}\n\n${priceLine}`,
      cta: "Veja como funciona",
      alternative: `Esse ${title} resolve um probleminha chato do dia a dia. ${priceLine}.`,
    },
    desejo: {
      whatsapp: `Isso aqui mudou minha rotina 😍\n${title}\n${priceLine}`,
      instagram: `Eu simplesmente precisava contar 😍\n\n${title} — simples e funcional.\n\n${feats}\n\n${priceLine}`,
      cta: "Quero um também",
      alternative: `Confesso que me apaixonei por esse ${title}. ${priceLine}.`,
    },
    viral: {
      whatsapp: `gente OLHA ISSO 🚨 ${title} ${priceLine}`,
      instagram: `PAREM TUDO 🚨\n\n${title}${product.price != null ? ` por ${money(product.price)}` : ""} 😱\n\n${(product.features || [])[0] ?? ""}`,
      cta: "Corre ver",
      alternative: `isso é sério?? ${title} assim 👀 ${priceLine}`,
    },
    profissional: {
      whatsapp: `${title}\n${priceLine}\nSaiba mais pelo link.`,
      instagram: `${title}\n\n${product.description || ""}\n\nPrincipais características:\n${feats}\n\n${priceLine}`,
      cta: "Saiba mais",
      alternative: `${title} — qualidade e praticidade. ${priceLine}.`,
    },
  };

  const chosen = byStyle[styleKey] || byStyle.oferta;
  return {
    title,
    whatsapp: chosen.whatsapp,
    instagram: chosen.instagram,
    cta: chosen.cta,
    alternative: chosen.alternative,
    source: "mock",
  };
}

/**
 * Ponto de entrada usado pelas rotas.
 * Tenta IA real se configurada; se falhar ou não estiver configurada, usa o
 * gerador por template — sempre deixando claro em `source` qual dos dois foi usado.
 */
export async function generateCopy(product, styleKey = "oferta") {
  if (hasRealAiCredentials()) {
    try {
      return await generateCopyWithRealAi(product, styleKey);
    } catch (err) {
      console.warn("[aiService] IA real falhou, usando gerador por template:", err.message);
    }
  }
  return generateCopyWithTemplate(product, styleKey);
}
