import { getSettings } from "../db/settingsRepository.js";
import {
  listQueue, getQueueItem, enqueue, updateQueueItem, publishedTimestamps, publishedEntries, wasProductQueuedRecently,
} from "../db/queueRepository.js";
import { checkPublishAllowed } from "./publishRules.js";
import * as instagram from "./instagramService.js";
import { getTrendingProducts } from "./trendingService.js";
import { toAffiliateLink } from "./affiliateService.js";
import { generateCopy, TEXT_STYLES } from "./aiService.js";
import { resolveProductPhoto } from "./imageService.js";
import { renderArtJpeg, renderStoryJpeg, TEMPLATES } from "./artRenderService.js";
import { putPublicImage, deletePublicImage } from "./publicImageStore.js";
import { fetchProduct } from "./productService.js";
import { getRecentPosts, rememberPost, mergeTimestamps, postedOnInstagram, productMarker, isProductPost } from "./igHistory.js";

/**
 * automationService — o "piloto automático": produtos em alta -> fila ->
 * publicação no Instagram, sempre respeitando as regras de quantidade.
 */

let busy = false; // trava para dois ticks não rodarem ao mesmo tempo
const STALE_PUBLISHING_MS = 10 * 60 * 1000;

/** Legenda final. O link NÃO é clicável no Instagram; por isso o aviso "link na bio". */
export const DEFAULT_HASHTAGS = "#publi #shopee #achadinhos #ofertas";

export function buildCaption({ copy, affiliateLink, product }) {
  const body = (copy?.instagram || copy?.whatsapp || "").trim();
  const cta = copy?.cta ? `\n\n👉 ${copy.cta}` : "";
  let hashtags = (process.env.IG_HASHTAGS || DEFAULT_HASHTAGS).trim();
  // Post de afiliado é publicidade: a identificação (#publi) é obrigatória pelas regras da Meta/CONAR.
  if (!/#publi\b|#ad\b|#publicidade\b/i.test(hashtags)) hashtags = `#publi ${hashtags}`;
  const disclosure = process.env.IG_DISCLOSURE === "off" ? "" : "\n\n🔗 Link de afiliado na bio ou no link abaixo (no Instagram o link da legenda não é clicável):";
  // O código do produto fica no fim e é o que impede repostar o mesmo item, mesmo se o servidor perder os arquivos.
  const marker = product ? productMarker(product) : "";
  const tail = `\n${affiliateLink}${marker ? `\n${marker}` : ""}\n\n${hashtags}`;
  const head = `${body}${cta}${disclosure}`.slice(0, 2200 - tail.length);
  return `${head}${tail}`.trim(); // limite do Instagram: 2200
}

/**
 * Histórico de publicações: arquivos locais + posts reais da conta do Instagram.
 * Lança erro se não conseguir ler o Instagram (quem chama não deve publicar).
 */
async function publishedHistory() {
  const local = publishedEntries();
  if (!instagram.isConfigured()) return { stamps: local.map((e) => e.t), posts: [] };
  const posts = await getRecentPosts();
  // Só posts de produto (com "Cód.") contam para o limite diário/intervalo:
  // posts feitos à mão (boas-vindas, avisos) não travam o piloto automático.
  const productPosts = posts.filter((p) => isProductPost(p.caption));
  return { stamps: mergeTimestamps(local, productPosts), posts };
}

/** Publica também um story junto com cada post? Padrão: sim (IG_ALSO_STORY=false desliga). */
export function storiesEnabled() {
  return process.env.IG_ALSO_STORY !== "false";
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
    caption: buildCaption({ copy, affiliateLink: affiliate.link, product }),
    affiliateLink: affiliate.link,
    template: pickTemplate(),
    status: status || (settings.mode === "auto" ? "approved" : "pending"),
    source: "manual",
  });
}

/**
 * Procura UM produto em alta ainda não usado (nem na fila, nem no Instagram),
 * com foto real e link de afiliado, e enfileira. Percorre algumas páginas da
 * lista de mais vendidos para não esgotar as opções.
 */
async function fillQueueOnce(settings, { posts = [], status } = {}) {
  const maxPages = 5;
  for (let page = 1; page <= maxPages; page++) {
    const trending = await getTrendingProducts({ limit: 30, page });
    if (!trending.length) break;
    for (const p of trending) {
      if (wasProductQueuedRecently(p.id, settings.dedupeDays)) continue;
      if (postedOnInstagram(p, posts, settings.dedupeDays)) continue;
      const photo = await resolveProductPhoto(p, null).catch(() => ({ buffer: null }));
      if (!photo.buffer) continue; // nunca posta sem foto real
      const affiliate = await toAffiliateLink(p.offerLink || p.url);
      if (!affiliate.isAffiliate) continue; // nunca posta sem link de afiliado confirmado
      const style = TEXT_STYLES[listQueue().length % TEXT_STYLES.length].key;
      const copy = await generateCopy(p, style);
      return enqueue({
        product: p,
        copy,
        caption: buildCaption({ copy, affiliateLink: affiliate.link, product: p }),
        affiliateLink: affiliate.link,
        template: pickTemplate(),
        status: status || (settings.mode === "auto" ? "approved" : "pending"),
        source: "trending",
      });
    }
  }
  return null;
}

/** Estado geral para o painel (inclui a cota real da API, se o Instagram estiver configurado). */
export async function getStatus() {
  const settings = getSettings();
  let stamps = publishedTimestamps();
  let historyError = null;
  try {
    stamps = (await publishedHistory()).stamps;
  } catch (e) {
    historyError = e.message;
  }
  const check = checkPublishAllowed({ now: new Date(), settings, publishedAt: stamps });
  const last24h = stamps.filter((t) => Date.now() - t < 24 * 3600 * 1000).length;
  const status = {
    historyError,
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

  busy = true;
  const settings = getSettings();
  let history;
  try {
    history = await publishedHistory();
  } catch (e) {
    busy = false;
    // Sem saber o que já foi postado, não dá para garantir os limites: não publica.
    return { published: false, reason: `Não consegui ler os posts recentes do Instagram: ${e.message}` };
  }
  const check = checkPublishAllowed({ now: new Date(), settings, publishedAt: history.stamps });
  if (!check.ok) {
    busy = false;
    return { published: false, reason: check.reason };
  }
  if (postedOnInstagram(item.product, history.posts, settings.dedupeDays)) {
    busy = false;
    updateQueueItem(id, { status: "rejected", error: "Este produto já foi postado no Instagram recentemente." });
    return { published: false, reason: "Produto já postado recentemente no Instagram (evitando repetição)." };
  }

  let token = null;
  let storyToken = null;
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
    rememberPost({ id: mediaId, caption: item.caption });
    let done = updateQueueItem(id, {
      status: "published", igMediaId: mediaId, permalink, publishedAt: new Date().toISOString(), error: null,
    });

    // Story do mesmo produto (arte vertical 1080×1920). O post do feed já saiu:
    // se o story falhar, só registramos o erro — nunca repostamos o feed.
    if (storiesEnabled()) {
      try {
        const story = await renderStoryJpeg({
          product: item.product,
          photoBuffer: photo.buffer,
          photoContentType: photo.contentType,
          templateKey: item.template,
        });
        storyToken = putPublicImage(story.buffer);
        const { mediaId: storyId } = await instagram.publishStory({ imageUrl: `${baseUrl}/api/public-image/${storyToken}.jpg` });
        done = updateQueueItem(id, { igStoryId: storyId, storyError: null });
      } catch (e) {
        console.warn("[automação] post publicado, mas o story falhou:", e.message);
        done = updateQueueItem(id, { storyError: e.message });
      }
    }
    return { published: true, item: done };
  } catch (err) {
    const failed = updateQueueItem(id, { status: "failed", error: err.message });
    return { published: false, reason: err.message, item: failed };
  } finally {
    if (token) deletePublicImage(token);
    if (storyToken) deletePublicImage(storyToken);
    busy = false;
  }
}

/**
 * Um "ciclo" do piloto automático. Chamado pelo agendador interno (e também
 * aceito via POST /api/automation/tick). Faz no máximo UMA publicação.
 *
 * Modo auto: primeiro confere se pode publicar AGORA (limite diário,
 * intervalo, horário — com base nos posts reais do Instagram). Só então busca
 * um produto em alta, gera texto/arte e publica. Assim não gasta chamadas de
 * IA/Shopee à toa quando o post estaria bloqueado de qualquer jeito.
 *
 * Modo aprovação: mantém a fila abastecida para você aprovar no painel e
 * publica o que já estiver aprovado.
 */
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

  let history = { stamps: publishedTimestamps(), posts: [] };
  if (instagram.isConfigured()) {
    try {
      history = await publishedHistory();
    } catch (e) {
      actions.push(`não consegui ler os posts do Instagram: ${e.message}`);
      return { actions, published: false, error: e.message };
    }
  }

  const approved = () => listQueue().filter((i) => i.status === "approved").sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (settings.mode === "auto") {
    if (!instagram.isConfigured()) {
      actions.push("Instagram ainda não configurado (faltam IG_USER_ID / IG_ACCESS_TOKEN)");
      return { actions, published: false };
    }
    const check = checkPublishAllowed({ now: new Date(), settings, publishedAt: history.stamps });
    if (!check.ok) {
      actions.push(`aguardando: ${check.reason}`);
      return { actions, published: false, nextEligibleAt: check.nextEligibleAt };
    }
    if (!approved().length && settings.autoFill) {
      try {
        const added = await fillQueueOnce(settings, { posts: history.posts, status: "approved" });
        actions.push(added ? `produto em alta escolhido: ${added.product.title}` : "nenhum produto novo elegível encontrado");
      } catch (e) {
        actions.push(`falha ao buscar produtos em alta: ${e.message}`);
        return { actions, published: false, error: e.message };
      }
    }
  } else if (settings.autoFill) {
    const waiting = listQueue().filter((i) => i.status === "pending" || i.status === "approved").length;
    if (waiting < settings.queueTarget) {
      try {
        const added = await fillQueueOnce(settings, { posts: history.posts });
        actions.push(added ? `produto em alta enfileirado: ${added.product.title}` : "nenhum produto novo elegível encontrado");
      } catch (e) {
        actions.push(`falha ao buscar produtos em alta: ${e.message}`);
      }
    }
  }

  const next = approved()[0];
  if (!next) {
    actions.push("nada aprovado para publicar");
    return { actions, published: false };
  }
  if (!instagram.isConfigured()) {
    actions.push("Instagram ainda não configurado");
    return { actions, published: false };
  }
  const result = await publishItem(next.id, { baseUrl });
  actions.push(result.published ? `publicado: ${next.product.title}` : `não publicado: ${result.reason}`);
  return { actions, published: result.published, permalink: result.item?.permalink || null, error: result.published ? null : result.reason };
}
