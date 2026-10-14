import * as instagram from "./instagramService.js";
import { getRecentPosts, rememberPost, clearHistoryCache } from "./igHistory.js";
import { getTrendingProducts } from "./trendingService.js";
import { resolveProductPhoto } from "./imageService.js";
import { renderReel, HOOKS } from "./reelService.js";
import { putPublicImage, deletePublicImage } from "./publicImageStore.js";

/**
 * Refaz um post de produto como Reel (pedido manual, uma vez).
 *
 * REEL_REPLACE_CODE=<código do produto>, ex. 58201637252. Ao subir o
 * servidor: acha o post de foto com esse "Cód." na conta, encontra o produto
 * nos mais vendidos da Shopee, gera o Reel e publica com A MESMA legenda
 * (mesmo link de afiliado e código). É idempotente: se já existir um vídeo
 * com esse código, não faz nada.
 *
 * Não apaga o post antigo (a API não permite) — o log diz qual é, para apagar
 * pelo app. Pedido manual: ignora horário/intervalo, mas respeita a cota real
 * da Meta.
 */

const hasCode = (caption, code) => new RegExp(`C[óo]d\\.?\\s*${code}\\b`, "i").test(caption || "");

async function findProduct(code) {
  for (let page = 1; page <= 5; page++) {
    const items = await getTrendingProducts({ limit: 50, page }).catch(() => []);
    const hit = items.find((p) => String(p.id).endsWith(`_${code}`));
    if (hit) return hit;
    if (!items.length) break;
  }
  return null;
}

export async function replaceWithReel({ baseUrl, code }) {
  clearHistoryCache();
  const posts = await getRecentPosts({ force: true });
  const matches = posts.filter((p) => hasCode(p.caption, code));
  if (matches.some((p) => p.mediaType === "VIDEO")) return { status: "já existe Reel desse produto" };
  const original = matches.find((p) => p.mediaType !== "VIDEO");
  if (!original) return { status: `nenhum post com Cód. ${code} encontrado` };

  const q = await instagram.getPublishingQuota();
  if (q.total != null && q.used != null && q.used >= q.total) return { status: "cota da Meta esgotada, tento no próximo reinício" };

  const product = await findProduct(code);
  if (!product) return { status: "produto não está mais entre os mais vendidos da Shopee — não consegui os dados para o vídeo" };
  const photo = await resolveProductPhoto(product, null);
  if (!photo.buffer) return { status: "sem foto real do produto" };

  const reel = await renderReel({ product, photoBuffer: photo.buffer, variant: 0, hook: HOOKS[0] });
  const token = putPublicImage(reel.buffer, "video/mp4");
  try {
    const { mediaId, permalink } = await instagram.publishReel({
      videoUrl: `${baseUrl}/api/public-image/${token}.mp4`,
      caption: original.caption,
      coverOffsetMs: reel.coverOffsetMs,
    });
    rememberPost({ id: mediaId, caption: original.caption });
    return { status: "publicado", mediaId, permalink, oldPost: original.permalink || original.id };
  } finally {
    deletePublicImage(token);
  }
}

export async function maybeReplaceWithReel({ baseUrl }) {
  const code = (process.env.REEL_REPLACE_CODE || "").replace(/\D/g, "");
  if (!code || !instagram.isConfigured()) return;
  try {
    const r = await replaceWithReel({ baseUrl, code });
    console.log(`[refazer como Reel] Cód. ${code}: ${r.status}${r.permalink ? ` → ${r.permalink}` : ""}${r.oldPost ? ` | apague o post antigo pelo app: ${r.oldPost}` : ""}`);
  } catch (e) {
    console.error(`[refazer como Reel] Cód. ${code}: falhou — ${e.message}`);
  }
}
