/**
 * aiService
 * v1: geração de texto por templates locais (mock).
 * Quando plugarmos um LLM de verdade (ex.: API da Anthropic), troque APENAS
 * o corpo de generateCopy por uma chamada HTTP — a assinatura continua igual.
 */

export const TEXT_STYLES = [
  { key: "oferta", label: "Oferta", emoji: "🔥", desc: "Preço, desconto e urgência" },
  { key: "beneficio", label: "Benefício", emoji: "💡", desc: "Problema que resolve" },
  { key: "desejo", label: "Desejo", emoji: "😍", desc: "Vontade de comprar" },
  { key: "viral", label: "Viral", emoji: "⚡", desc: "Curto, redes sociais" },
  { key: "profissional", label: "Profissional", emoji: "🛍️", desc: "Comercial e limpo" },
];

function money(v) {
  return v == null ? null : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** MOCK — troque o corpo desta função por uma chamada real a um LLM no futuro */
export async function generateCopy(product, styleKey) {
  const feats = (product.features || []).slice(0, 3).map((f) => `✨ ${f}`).join("\n");
  const priceLine = product.originalPrice
    ? `💰 De ${money(product.originalPrice)} por apenas ${money(product.price)}!`
    : `💰 Por apenas ${money(product.price)}`;
  const link = "[LINK]";

  switch (styleKey) {
    case "oferta":
      return `🔥 OLHA ESSA OFERTA!\n\n${product.title} caiu de preço e o estoque não deve durar.\n\n${feats}\n\n${priceLine}\n\n👉 Corre que acaba rápido:\n${link}`;
    case "beneficio":
      return `Cansado(a) de bagunça na hora de achar as coisas? 👀\n\n${product.title} resolve isso rapidinho.\n\n${feats}\n\n${priceLine}\n\n👉 Veja como funciona:\n${link}`;
    case "desejo":
      return `Isso aqui mudou minha rotina 😍\n\n${product.title} — simples, bonito e funcional.\n\n${feats}\n\n${priceLine}\n\n👉 Quero um também:\n${link}`;
    case "viral":
      return `gente PAREM TUDO 🚨\n\n${product.title} por ${money(product.price)} 😱\n\n${(product.features || [])[0] ?? ""}\n\n👉 link aqui ó:\n${link}`;
    case "profissional":
    default:
      return `${product.title}\n\n${product.description || ""}\n\nPrincipais características:\n${feats}\n\n${priceLine}\n\nSaiba mais:\n${link}`;
  }
}
