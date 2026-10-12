import { getSettings } from "../db/settingsRepository.js";
import {
  listQueue, getQueueItem, enqueue, updateQueueItem, publishedTimestamps, wasProductQueuedRecently,
} from "../db/queueRepository.js";
import { checkPublishAllowed } from "./publishRules.js";
import * as instagram from "./instagramService.js";
import { getTrendingProducts } from "./trendingService.js";
import { toAffiliateLink } from "./affiliateService.js";
import { generateCopy, TEXT_STYLES } from "./aiService.js";
import { resolveProductPhoto } from "./imageService.js";
import { renderArtJpeg, TEMPLATES } from "./artRenderService.js";
import { putPublicImage, deletePublicImage } from "./publicImageStore.js";
import { fetchProduct } from "./productService.js";

/**
 * automationService — o "piloto automático": produtos em alta -> fila ->
 * publicação no Instagram, sempre respeitando as regras de quantidade.
 */

let busy = false; // trava para dois ticks não rodarem ao mesmo tempo
const STALE_PUBLISHING_MS = 10 * 60 * 1000;

/** Legenda final. O link NÃO é clicável no Instagram; por isso o aviso "link na bio". */
export function buildCaption({ copy, affiliateLink }) {
  const body = (copy?.instagram || copy?.whatsapp || "").trim();
  const cta = copy?.cta ? `\n\n👉 ${copy.cta}` : "";
  const hashtags = (process.env.IG_HASHTAGS || "#shopee #achadinhos #ofertas").trim();
  const disclosure = process.env.IG_DISCLOSURE === "off" ? "" : "\n\n🔗 Link de afiliado na bio ou no link abaixo (no Instagram o link da legenda não é clicável):";
  const caption = `${body}${cta}${disclosure}\n${affiliateLink}\n\n${hashtags}`.trim();
  return caption.slice(0, 2200); // limite do Instagram
}

function pickTemplate() {
  const publishedCount = listQueue().length;
  return TEMPLATES[publishedCount % TEMPLATES.length];
}

/** Cria o item de fila a partir de um link de produto (dados sempre vêm do servidor, não do navegador). */
export async function enqueueFromUrl(url, { status } = {}) {
  const settings = getSettings();
  const product = await fetchProduct(url);
  const style = TEXT_STYLES[listQueue().length % TEXT_STYLES.length].key;
  const [copy, affiliate] = await Promise.all([generateCopy(product, style), toAffiliateLink(product.url)]);
  if (!affiliate.isAffiliate) {
    throw new Error("Não foi possível gerar um link de afiliado para este produto — não vou enfileirar um post sem comissão.");
  }
  return enqueue({
    product,
    copy,
    caption: buildCaption({ copy, affiliateLink: affiliate.link }),
    affiliateLink: affiliate.link,
    template: pickTemplate(),
    status: status || (settings.mode === "auto" ? "approved" : "pending"),
    source: "manual",
  });
}

/** Procura UM produto em alta ainda não usado, com foto real e link de afiliado, e enfileira. */
async function fillQueueOnce(settings) {
  const trending = await getTrendingProducts({ limit: 30 });
  for (const p of trending) {
    if (wasProductQueuedRecently(p.id, settings.dedupeDays)) continue;
    const photo = await resolveProductPhoto(p, null).catch(() => ({ buffer: null }));
    if (!photo.buffer) continue; // nunca posta sem foto real
    const affiliate = await toAffiliateLink(p.url);
    if (!affiliate.isAffiliate) continue; // nunca posta sem link de afiliado confirmado
    const style = TEXT_STYLES[listQueue().length % TEXT_STYLES.length].key;
    const copy = await generateCopy(p, style);
    return enqueue({
      product: p,
      copy,
      caption: buildCaption({ copy, affiliateLink: affiliate.link }),
      affiliateLink: affiliate.link,
      template: pickTemplate(),
      status: settings.mode === "auto" ? "approved" : "pending",
      source: "trending",
    });
  }
  return null;
}

/** Estado geral para o painel (inclui a cota real da API, se o Instagram estiver configurado). */
export async function getStatus() {
  const settings = getSettings();
  const stamps = publishedTimestamps();
  const check = checkPublishAllowed({ now: new Date(), settings, publishedAt: stamps });
  const last24h = stamps.filter((t) => Date.now() - t < 24 * 3600 * 1000).length;
  const status = {
    settings,
    instagram: { configured: instagram.isConfigured(), username: null, quota: null, error: null },
    publishedLast24h: last24h,
    canPublishNow: check.ok,
    blockedReason: check.reason,
    nextEligibleAt: check.nextEligibleAt,
    counts: listQueue().reduce((acc, i) => ({ ...acc, [i.status]: (acc[i.status] || 0) + 1 }), {}),
  };
  if (instagram.isConfigured()) {
    try {
      status.instagram.username = (await instagram.getAccountStatus()).username;
      status.instagram.quota = await instagram.getPublishingQuota();
    } catch (e) {
      status.instagram.error = e.message;
    }
  }
  return status;
}

/**
 * Publica um item da fila, se (e somente se) as regras permitirem.
 * @returns {{published:boolean, reason?:string, item?:object}}
 */
export async function publishItem(id, { baseUrl }) {
  const item = getQueueItem(id);
  if (!item) throw new Error("Item da fila não encontrado.");
  if (!["approved", "failed"].includes(item.status)) {
    return { published: false, reason: `Item está "${item.status}" — só itens aprovados podem ser publicados.` };
  }
  if (!instagram.isConfigured()) {
    return { published: false, reason: "Instagram não configurado (faltam IG_USER_ID / IG_ACCESS_TOKEN)." };
  }
  if (busy) return { published: false, reason: "Outra publicação já está em andamento." };

  const settings = getSettings();
  const check = checkPublishAllowed({ now: new Date(), settings, publishedAt: publishedTimestamps() });
  if (!check.ok) return { published: false, reason: check.reason };

  busy = true;
  let token = null;
  try {
    // Autoridade final: a cota real da própria API do Instagram.
    try {
      const q = await instagram.getPublishingQuota();
      if (q.total != null && q.used != null && q.used >= q.total) {
        return { published: false, reason: `Cota da API do Instagram esgotada (${q.used}/${q.total} em 24h).` };
      }
    } catch (e) {
      // Se não conseguimos nem consultar a cota, é mais seguro não publicar.
      return { published: false, reason: `Não consegui verificar a cota do Instagram: ${e.message}` };
    }

    updateQueueItem(id, { status: "publishing", error: null });
    const photo = await resolveProductPhoto(item.product, null);
    if (!photo.buffer) throw new Error("Sem foto real do produto — não publico arte sem foto.");
    const { buffer } = await renderArtJpeg({
      product: item.product,
      photoBuffer: photo.buffer,
      photoContentType: photo.contentType,
      templateKey: item.template,
      formatKey: settings.format,
    });
    token = putPublicImage(buffer);
    const imageUrl = `${baseUrl}/api/public-image/${token}.jpg`;

    const { mediaId, permalink } = await instagram.publishPhoto({ imageUrl, caption: item.caption });
    const done = updateQueueItem(id, {
      status: "published", igMediaId: mediaId, permalink, publishedAt: new Date().toISOString(), error: null,
    });
    return { published: true, item: done };
  } catch (err) {
    const failed = updateQueueItem(id, { status: "failed", error: err.message });
    return { published: false, reason: err.message, item: failed };
  } finally {
    if (token) deletePublicImage(token);
    busy = false;
  }
}

/** Chamado por um agendador externo (cron). Faz no máximo UMA publicação por chamada. */
export async function runTick({ baseUrl }) {
  const settings = getSettings();
  const actions = [];

  // itens "publishing" travados (servidor reiniciou no meio): marca como falha, SEM reenviar
  // automaticamente — pode ter sido publicado; confira no Instagram antes de tentar de novo.
  for (const i of listQueue()) {
    if (i.status === "publishing" && Date.now() - new Date(i.updatedAt).getTime() > STALE_PUBLISHING_MS) {
      updateQueueItem(i.id, { status: "failed", error: "Interrompido no meio — confira no Instagram se foi publicado antes de tentar de novo." });
      actions.push(`item ${i.id} marcado como falho (travado)`);
    }
  }

  if (settings.autoFill) {
    const waiting = listQueue().filter((i) => i.status === "pending" || i.status === "approved").length;
    if (waiting < settings.queueTarget) {
      try {
        const added = await fillQueueOnce(settings);
        actions.push(added ? `produto em alta enfileirado: ${added.product.title}` : "nenhum produto novo elegível encontrado");
      } catch (e) {
        actions.push(`falha ao buscar produtos em alta: ${e.message}`);
      }
    }
  }

  const next = listQueue().filter((i) => i.status === "approved").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!next) {
    actions.push("nada aprovado para publicar");
    return { actions };
  }
  const result = await publishItem(next.id, { baseUrl });
  actions.push(result.published ? `publicado: ${next.product.title}` : `não publicado: ${result.reason}`);
  return { actions, published: result.published };
}
