import sharp from "sharp";

/**
 * artRenderService
 *
 * Gera a ARTE FINAL (um PNG de verdade, não só uma descrição) no servidor,
 * combinando:
 *   - a foto real do produto (se disponível — nunca uma imagem genérica
 *     fingindo ser a foto real; sem foto, o layout é desenhado sem ela)
 *   - preço, preço anterior, desconto, título — inseridos via SVG (texto
 *     exato, sem IA "desenhando" os números, que é a causa mais comum de
 *     preço/preço errado em imagens geradas por IA)
 *
 * Isso roda 100% em memória (nenhum arquivo é gravado em disco), o que:
 *   (a) funciona em qualquer formato Render, inclusive sem disco persistente;
 *   (b) é a correção real do bug "a imagem não aparece" — antes, a arte era
 *       só um <svg> renderizado no NAVEGADOR da pessoa, dependendo de o
 *       navegador conseguir carregar a imagem da Shopee ao vivo. Agora o
 *       PNG final já sai pronto do backend, com a foto já embutida nos bytes
 *       da imagem (ela nunca "pode falhar de carregar" depois).
 *
 * FORMATS: os 3 tamanhos pedidos.
 * TEMPLATES: OFERTA, ELEGANTE, MODERNO, VIRAL.
 */

export const FORMATS = {
  quadrado: { width: 1080, height: 1080, label: "Feed quadrado (1080×1080)" },
  feed: { width: 1080, height: 1350, label: "Feed vertical (1080×1350)" },
  stories: { width: 1080, height: 1920, label: "Stories (1080×1920)" },
};

export const TEMPLATES = ["OFERTA", "ELEGANTE", "MODERNO", "VIRAL"];

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function truncate(s, n) {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

function moneyStr(v) {
  if (v == null) return null;
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Assinatura da marca no canto das artes (ex.: "@maazshopp"). */
function brandHandle() {
  const h = (process.env.BRAND_HANDLE || "maazshopp").replace(/^@/, "");
  return `@${h}`;
}

const FONT_DISPLAY = "'Arial Black', Arial, sans-serif";
const FONT_BODY = "Arial, sans-serif";

/** Monta o <image> com a foto já embutida (data URI) ou nada, se não houver foto. */
function photoGroup({ cx, cy, r, photoDataUri, ringColor }) {
  if (!photoDataUri) return "";
  const clipId = `clip${Math.round(cx)}${Math.round(cy)}${Math.round(r)}`;
  return `
    <defs><clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
    <circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="#ffffff"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="${ringColor}" stroke-width="5"/>
    <image href="${photoDataUri}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"/>
  `;
}

/** Quando não há foto real: um bloco limpo com as iniciais do produto, deixando claro que é só um marcador — nunca uma foto fake. */
function noPhotoPlaceholder({ cx, cy, r, accent, chip }) {
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${chip}" opacity="0.18"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="10 12"/>
    <text x="${cx}" y="${cy + 14}" font-family="${FONT_BODY}" font-size="${r * 0.42}" fill="${accent}" text-anchor="middle" opacity="0.6">sem foto</text>
  `;
}

function buildSvg({ width, height, product, photoDataUri, template }) {
  const price = moneyStr(product.price);
  const original = moneyStr(product.originalPrice);
  const discount = product.discountPercentage;
  const title = truncate(product.title || "Produto Shopee", Math.round(width / 26));

  const palettes = {
    OFERTA: { bg: "#FF4B3E", accent: "#1A1A2E", chip: "#FFD23F", dark: false },
    ELEGANTE: { bg: "#1A1A2E", accent: "#C6A867", chip: "#C6A867", dark: false },
    MODERNO: { bg: "#FFFFFF", accent: "#1A1A2E", chip: "#FF4B3E", dark: true },
    VIRAL: { bg: "#C6F135", accent: "#1A1A2E", chip: "#FF4B3E", dark: true },
  };
  const c = palettes[template] || palettes.OFERTA;

  const cx = width / 2;
  const photoR = Math.min(width, height) * 0.27;
  const photoCy = height * 0.36;
  const photoBlock = photoDataUri
    ? photoGroup({ cx, cy: photoCy, r: photoR, photoDataUri, ringColor: c.chip })
    : noPhotoPlaceholder({ cx, cy: photoCy, r: photoR, accent: c.accent, chip: c.chip });

  const titleY = photoCy + photoR + height * 0.11;
  const priceY = titleY + height * 0.1;
  const originalY = titleY + height * 0.055;

  let badgeTop = "";
  let priceBlock = "";
  let footerColor = c.dark ? "#00000066" : "#ffffffaa";

  if (template === "OFERTA") {
    badgeTop = `
      <rect x="0" y="0" width="${width}" height="${height * 0.09}" fill="${c.chip}"/>
      <text x="${width * 0.055}" y="${height * 0.065}" font-family="${FONT_DISPLAY}" font-size="${width * 0.05}" font-weight="800" fill="${c.accent}">OFERTA DO DIA</text>
    `;
    priceBlock = `
      ${original ? `<text x="${width * 0.055}" y="${originalY}" font-family="${FONT_BODY}" font-size="${width * 0.032}" fill="#ffffffaa" text-decoration="line-through">${esc(original)}</text>` : ""}
      <text x="${width * 0.055}" y="${priceY}" font-family="${FONT_DISPLAY}" font-size="${width * 0.07}" font-weight="800" fill="${c.chip}">${esc(price || "")}</text>
      ${discount ? `<text x="${width * 0.055}" y="${priceY + height * 0.045}" font-family="${FONT_BODY}" font-size="${width * 0.032}" fill="#ffffff" font-weight="700">-${discount}% OFF</text>` : ""}
    `;
  } else if (template === "ELEGANTE") {
    badgeTop = `
      <text x="${cx}" y="${height * 0.08}" font-family="${FONT_BODY}" font-size="${width * 0.03}" fill="${c.chip}" text-anchor="middle" letter-spacing="6">SELEÇÃO ESPECIAL</text>
      <line x1="${width * 0.35}" y1="${height * 0.1}" x2="${width * 0.65}" y2="${height * 0.1}" stroke="${c.chip}" stroke-width="2"/>
    `;
    priceBlock = `
      ${original ? `<text x="${cx}" y="${originalY}" font-family="${FONT_BODY}" font-size="${width * 0.03}" fill="#ffffff88" text-anchor="middle" text-decoration="line-through">${esc(original)}</text>` : ""}
      <text x="${cx}" y="${priceY}" font-family="${FONT_DISPLAY}" font-size="${width * 0.064}" font-weight="700" fill="${c.chip}" text-anchor="middle">${esc(price || "")}</text>
    `;
  } else if (template === "MODERNO") {
    badgeTop = `
      <rect x="${width * 0.055}" y="${height * 0.04}" width="${width * 0.3}" height="${height * 0.045}" rx="${height * 0.0225}" fill="${c.chip}"/>
      <text x="${width * 0.055 + width * 0.15}" y="${height * 0.04 + height * 0.031}" font-family="${FONT_BODY}" font-size="${width * 0.026}" font-weight="700" fill="#ffffff" text-anchor="middle">NOVIDADE</text>
    `;
    priceBlock = `
      ${original ? `<text x="${width * 0.055}" y="${originalY}" font-family="${FONT_BODY}" font-size="${width * 0.03}" fill="#999" text-decoration="line-through">${esc(original)}</text>` : ""}
      <text x="${width * 0.055}" y="${priceY}" font-family="${FONT_DISPLAY}" font-size="${width * 0.066}" font-weight="800" fill="${c.accent}">${esc(price || "")}</text>
      ${discount ? `<rect x="${width * 0.055}" y="${priceY + height * 0.018}" width="${width * 0.001 + discount.toString().length * width * 0.028 + width * 0.05}" height="${height * 0.04}" rx="${height * 0.02}" fill="${c.chip}"/><text x="${width * 0.055 + width * 0.025}" y="${priceY + height * 0.045}" font-family="${FONT_BODY}" font-size="${width * 0.026}" font-weight="700" fill="#fff">-${discount}%</text>` : ""}
    `;
  } else {
    // VIRAL
    badgeTop = `
      <text x="${cx}" y="${height * 0.075}" font-family="${FONT_DISPLAY}" font-size="${width * 0.055}" font-weight="800" fill="${c.accent}" text-anchor="middle">OLHA ISSO 👀</text>
    `;
    priceBlock = `
      <rect x="${width * 0.22}" y="${priceY - height * 0.045}" width="${width * 0.56}" height="${height * 0.075}" rx="${height * 0.0375}" fill="${c.accent}"/>
      <text x="${cx}" y="${priceY + height * 0.005}" font-family="${FONT_DISPLAY}" font-size="${width * 0.06}" font-weight="800" fill="${c.chip}" text-anchor="middle">${esc(price || "")}</text>
      ${original ? `<text x="${cx}" y="${priceY + height * 0.06}" font-family="${FONT_BODY}" font-size="${width * 0.028}" fill="${c.accent}" text-anchor="middle" text-decoration="line-through">${esc(original)}</text>` : ""}
    `;
  }

  const titleAnchor = template === "ELEGANTE" || template === "VIRAL" ? "middle" : "start";
  const titleX = titleAnchor === "middle" ? cx : width * 0.055;

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="${c.bg}"/>
      ${badgeTop}
      ${photoBlock}
      <text x="${titleX}" y="${titleY}" font-family="${FONT_BODY}" font-size="${width * 0.034}" font-weight="700" fill="${c.dark ? c.accent : "#ffffff"}" text-anchor="${titleAnchor}">${esc(title)}</text>
      ${priceBlock}
      <text x="${width - width * 0.04}" y="${height - height * 0.025}" font-family="${FONT_BODY}" font-size="${width * 0.026}" font-weight="700" fill="${footerColor}" text-anchor="end">${esc(brandHandle())}</text>
    </svg>
  `;
}

/**
 * Renderiza a arte final em PNG (Buffer), 100% em memória.
 * @param {object} product - modelo de produto (title, price, originalPrice, discountPercentage, ...)
 * @param {Buffer|null} photoBuffer - bytes da foto real (já validada pelo imageService), ou null
 * @param {string|null} photoContentType - ex. "image/jpeg"
 * @param {string} templateKey - um de TEMPLATES
 * @param {string} formatKey - um de Object.keys(FORMATS)
 */
export async function renderArt({ product, photoBuffer, photoContentType, templateKey, formatKey }) {
  const format = FORMATS[formatKey] || FORMATS.quadrado;
  const template = TEMPLATES.includes(templateKey) ? templateKey : "OFERTA";

  let photoDataUri = null;
  if (photoBuffer && photoContentType) {
    // Redimensiona a foto para um tamanho razoável antes de embutir — mantém
    // o PNG final leve mesmo se a foto original vier enorme.
    const resized = await sharp(photoBuffer)
      .resize(800, 800, { fit: "cover" })
      .jpeg({ quality: 85 })
      .toBuffer();
    photoDataUri = `data:image/jpeg;base64,${resized.toString("base64")}`;
  }

  const svg = buildSvg({ width: format.width, height: format.height, product, photoDataUri, template });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buffer: png, width: format.width, height: format.height };
}

const STORY_BG = { OFERTA: "#FF4B3E", ELEGANTE: "#1A1A2E", MODERNO: "#FFFFFF", VIRAL: "#C6F135" };
const STORY_PILL = { OFERTA: ["#FFD23F", "#1A1A2E"], ELEGANTE: ["#C6A867", "#1A1A2E"], MODERNO: ["#1A1A2E", "#FFFFFF"], VIRAL: ["#1A1A2E", "#C6F135"] };

/**
 * Arte para STORY publicado pela API (1080×1920, JPEG).
 *
 * No story, o Instagram cobre o topo (barra de progresso + nome do perfil) e a
 * base (campo de resposta), e a API não permite sticker de link. Por isso a
 * arte do feed (1080×1350) vai inteira na faixa segura do meio e, embaixo,
 * entra uma chamada "LINK NA BIO" no lugar do link clicável.
 */
export async function renderStoryJpeg({ product, photoBuffer, photoContentType, templateKey }) {
  const template = TEMPLATES.includes(templateKey) ? templateKey : "OFERTA";
  const W = 1080, H = 1920, TOP = 200;
  const feed = await renderArt({ product, photoBuffer, photoContentType, templateKey: template, formatKey: "feed" });
  const cta = esc((process.env.IG_STORY_CTA || "LINK NA BIO").slice(0, 28));
  const [pillBg, pillFg] = STORY_PILL[template];
  const pillW = 620, pillH = 110, pillY = TOP + 1350 + 70;
  const overlay = Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${(W - pillW) / 2}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="${pillBg}"/>
      <text x="${W / 2}" y="${pillY + 72}" font-family="${FONT_DISPLAY}" font-size="50" font-weight="800" fill="${pillFg}" text-anchor="middle">${cta}</text>
    </svg>`);
  const jpeg = await sharp({ create: { width: W, height: H, channels: 3, background: STORY_BG[template] } })
    .composite([{ input: feed.buffer, top: TOP, left: 0 }, { input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
  return { buffer: jpeg, width: W, height: H };
}

/**
 * Mesma arte, mas em JPEG — formato exigido pela API de publicação do Instagram
 * (só aceita JPEG). Fundo achatado em branco para não haver transparência.
 */
export async function renderArtJpeg(opts) {
  const { buffer, width, height } = await renderArt(opts);
  const jpeg = await sharp(buffer).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
  return { buffer: jpeg, width, height };
}
