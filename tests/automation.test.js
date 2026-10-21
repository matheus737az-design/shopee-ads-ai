import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ads-"));
process.env.IG_USER_ID = "123";
process.env.IG_ACCESS_TOKEN = "TOKEN_SECRETO";
process.env.IG_POST_WINDOW_START = "0";
process.env.IG_POST_WINDOW_END = "24";
process.env.IG_MIN_HOURS_BETWEEN_POSTS = "0";
process.env.IG_MAX_POSTS_PER_DAY = "2";
process.env.IG_FORMAT = "photo"; // os testes de Reel ligam explicitamente

const photo = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#f00" } }).jpeg().toBuffer();
let hasPhoto = true;
mock.module(new URL("../src/services/imageService.js", import.meta.url).href, {
  namedExports: { resolveProductPhoto: async () => (hasPhoto ? { buffer: photo, contentType: "image/jpeg", source: "mock" } : { buffer: null, source: "none" }) },
});

const { enqueue } = await import("../src/db/queueRepository.js");
const { publishItem, runTick, buildCaption } = await import("../src/services/automationService.js");
const { getQueueItem, listQueue } = await import("../src/db/queueRepository.js");

const product = { id: "p1", title: "Fone Bluetooth", price: 49.9, images: [], url: "https://shopee.com.br/x" };
const mk = (status = "approved") => enqueue({ product: { ...product, id: "p" + Math.random() }, caption: "legenda", affiliateLink: "https://s.shopee.com.br/abc", template: "OFERTA", status });

let calls, quota, failPublish, igPosts, mediaSeq = 0, failStory = false, reelContainerFails = false, failReelPublish = false, storyNotReady = 0;
function installFetch() {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET", body: opts.body ? String(opts.body) : "" });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.includes("/123/media?")) return json({ data: igPosts.map((p) => ({ id: p.id, timestamp: new Date(p.timestamp).toISOString(), caption: p.caption })) });
    if (u.includes("content_publishing_limit")) return json({ data: [{ quota_usage: quota.used, config: { quota_total: quota.total } }] });
    if (u.endsWith("/123/media")) {
      const b = String(opts.body);
      if (/media_type=REELS/.test(b)) return reelContainerFails ? json({ error: { message: "video invalido" } }, 400) : json({ id: "cont1r" });
      return json({ id: /media_type=STORIES/.test(b) ? "cont1s" : "cont1" });
    }
    if (u.includes("/cont1s") || u.includes("/cont1r")) return json({ status_code: "FINISHED" });
    if (u.includes("/cont1")) return json({ status_code: "FINISHED" });
    if (u.endsWith("/123/media_publish")) {
      if (failPublish) return json({ error: { code: 190, message: "expired" } }, 400);
      const id = `media${++mediaSeq}`;
      if (failStory && String(opts.body).includes("cont1s")) return json({ error: { message: "story falhou" } }, 400);
      if (storyNotReady > 0 && String(opts.body).includes("cont1s")) {
        storyNotReady--;
        return json({ error: { code: 9007, error_subcode: 2207027, message: "Media ID is not available" } }, 400);
      }
      if (failReelPublish && String(opts.body).includes("cont1r")) return json({ error: { message: "timeout no publish" } }, 500);
      if (!String(opts.body).includes("cont1s")) igPosts.unshift({ id, timestamp: Date.now(), caption: "" }); // stories não aparecem em /media
      return json({ id });
    }
    if (/\/media\d+\?/.test(u)) return json({ permalink: "https://instagram.com/p/xyz" });
    return json({ error: { message: "inesperado " + u } }, 404);
  };
}
const { clearHistoryCache } = await import("../src/services/igHistory.js");
test.beforeEach(() => { quota = { used: 0, total: 100 }; failPublish = false; failStory = false; reelContainerFails = false; failReelPublish = false; storyNotReady = 0; hasPhoto = true; igPosts = []; clearHistoryCache(); installFetch(); });

test("publica: container -> media_publish -> published, imagem é JPEG pública", async () => {
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, true);
  const saved = getQueueItem(it.id);
  assert.equal(saved.status, "published");
  assert.match(saved.igMediaId, /^media\d+$/);
  const create = calls.find((c) => c.url.endsWith("/123/media"));
  assert.match(create.body, /image_url=https%3A%2F%2Fapp\.test%2Fapi%2Fpublic-image%2F[a-f0-9]{48}\.jpg/);
});

test("respeita o limite diário configurado (2)", async () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  const a = mk(), b = mk(), c = mk();
  const results = [];
  for (const it of [a, b, c]) results.push((await publishItem(it.id, { baseUrl: "https://app.test" })).published);
  assert.equal(results.filter(Boolean).length, 2);
  assert.equal(getQueueItem(c.id).status, "approved"); // ficou na fila, não foi perdido
});

test("não publica se a cota real da API está esgotada", async () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  quota = { used: 100, total: 100 };
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, false); assert.match(r.reason, /Cota/);
  assert.ok(!calls.some((c) => c.url.endsWith("/123/media")));
});

test("não publica sem foto real e marca falha", async () => {
  hasPhoto = false;
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, false);
  assert.equal(getQueueItem(it.id).status, "failed");
  assert.ok(!calls.some((c) => c.url.endsWith("/123/media")));
});

test("token expirado vira falha com mensagem clara e sem vazar o token", async () => {
  failPublish = true;
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, false);
  const saved = getQueueItem(it.id);
  assert.equal(saved.status, "failed");
  assert.match(saved.error, /expirado/);
  assert.ok(!JSON.stringify(saved).includes("TOKEN_SECRETO"));
});

test("itens pendentes (modo aprovação) nunca são publicados pelo tick", async () => {
  const it = mk("pending");
  await runTick({ baseUrl: "https://app.test" });
  assert.equal(getQueueItem(it.id).status, "pending");
});

test("legenda: contém link, aviso de link na bio e cabe em 2200 caracteres", () => {
  const c = buildCaption({ copy: { instagram: "x".repeat(5000), cta: "Confira" }, affiliateLink: "https://s.shopee.com.br/abc" });
  assert.ok(c.length <= 2200);
  const short = buildCaption({ copy: { instagram: "Oi", cta: "Confira" }, affiliateLink: "https://s.shopee.com.br/abc" });
  assert.match(short, /s\.shopee\.com\.br\/abc/); assert.match(short, /bio/);
});

test("disco apagado: o limite diário continua valendo pelos posts reais do Instagram", async () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  igPosts = [
    { id: "a", timestamp: Date.now() - 3600e3, caption: "post 1\nCód. 111" },
    { id: "b", timestamp: Date.now() - 7200e3, caption: "post 2\nCód. 222" },
  ];
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, false);
  assert.match(r.reason, /Limite diário/);
  assert.ok(!calls.some((c) => c.url.endsWith("/123/media") && c.method === "POST"));
});

test("não publica se não conseguir ler os posts do Instagram (falha segura)", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (String(url).includes("/123/media?") ? new Response("{}", { status: 500 }) : orig(url, opts));
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, false);
  assert.match(r.reason, /posts recentes/);
});

test("produto com o mesmo código já postado no Instagram não é repostado", async () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  igPosts = [{ id: "old", timestamp: Date.now() - 40 * 3600e3, caption: "achado\nCód. 987654321\n#publi" }];
  const it = enqueue({ product: { ...product, id: "shopee_111_987654321" }, caption: "x", affiliateLink: "https://s.shopee.com.br/abc", template: "OFERTA", status: "approved" });
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, false);
  assert.match(r.reason, /já postado/);
});

test("legenda leva #publi e o código do produto", () => {
  const c = buildCaption({ copy: { instagram: "Oi" }, affiliateLink: "https://s.shopee.com.br/abc", product: { id: "shopee_111_987654321" } });
  assert.match(c, /#publi/);
  assert.match(c, /Cód\. 987654321/);
  const long = buildCaption({ copy: { instagram: "x".repeat(5000) }, affiliateLink: "https://s.shopee.com.br/abc", product: { id: "shopee_1_55555" } });
  assert.ok(long.length <= 2200);
  assert.match(long, /Cód\. 55555/); // o código nunca é cortado
});

test("modo auto: fora do horário não busca produto nem chama a Shopee", async () => {
  const { updateSettings } = await import("../src/db/settingsRepository.js");
  const h = new Date().getHours();
  updateSettings({ mode: "auto", autoFill: true, windowStartHour: (h + 2) % 24, windowEndHour: ((h + 3) % 24) || 24 });
  const r = await runTick({ baseUrl: "https://app.test" });
  assert.equal(r.published, false);
  assert.match(r.actions.join(" "), /Fora da janela/);
  assert.ok(!calls.some((c) => c.url.includes("shopee")));
  updateSettings({ mode: "approval", autoFill: false, windowStartHour: 0, windowEndHour: 24 });
});

test("post + story: publica o feed e depois um story 1080x1920 do mesmo produto", async () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, true);
  const creates = calls.filter((c) => c.url.endsWith("/123/media") && c.method === "POST");
  assert.equal(creates.length, 2);
  assert.doesNotMatch(creates[0].body, /STORIES/);
  assert.match(creates[1].body, /media_type=STORIES/);
  assert.ok(getQueueItem(it.id).igStoryId);
});

test("se o story falhar, o post continua publicado e não é repetido", async () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  failStory = true;
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, true);
  const saved = getQueueItem(it.id);
  assert.equal(saved.status, "published");
  assert.match(saved.storyError, /story falhou/);
  assert.equal(calls.filter((c) => c.url.endsWith("/123/media_publish")).length, 2); // 1 feed + 1 tentativa de story
});

test("story: 'Media ID is not available' (9007) é repetido até publicar", { timeout: 60000 }, async () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  storyNotReady = 1;
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, true);
  const saved = getQueueItem(it.id);
  assert.ok(saved.igStoryId);
  assert.equal(saved.storyError, null);
  assert.equal(calls.filter((c) => c.url.endsWith("/123/media_publish")).length, 3); // 1 feed + 2 tentativas de story
});

test("IG_ALSO_STORY=false publica só o feed", async () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  process.env.IG_ALSO_STORY = "false";
  const it = mk();
  await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(calls.filter((c) => c.url.endsWith("/123/media") && c.method === "POST").length, 1);
  delete process.env.IG_ALSO_STORY;
});

test("posts feitos à mão (sem Cód.) não contam para o limite diário", async () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  igPosts = [1, 2, 3].map((i) => ({ id: "w" + i, timestamp: Date.now() - i * 60e3, caption: "Bem-vindo " + i }));
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, true);
});

const reset = () => { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(process.env.DATA_DIR, { recursive: true }); };
const mediaCreates = () => calls.filter((c) => c.url.endsWith("/123/media") && c.method === "POST");

test("Reels: gera o vídeo e publica como REELS (MP4 público) + story", { timeout: 120000 }, async () => {
  reset(); process.env.IG_FORMAT = "reels";
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  delete process.env.IG_FORMAT; process.env.IG_FORMAT = "photo";
  assert.equal(r.published, true);
  const creates = mediaCreates();
  assert.match(creates[0].body, /media_type=REELS/);
  assert.match(creates[0].body, /video_url=https%3A%2F%2Fapp\.test%2Fapi%2Fpublic-image%2F[a-f0-9]{48}\.mp4/);
  assert.match(creates[0].body, /share_to_feed=true/);
  assert.match(creates[0].body, /cover_url=https%3A%2F%2Fapp\.test%2Fapi%2Fpublic-image%2F[a-f0-9]{48}\.jpg/); // capa própria
  assert.match(creates[1].body, /media_type=STORIES/);
  assert.equal(getQueueItem(it.id).kind, "reel");
});

test("Reels: se o ffmpeg não existir, posta como foto", { timeout: 60000 }, async () => {
  reset(); process.env.IG_FORMAT = "reels"; process.env.FFMPEG_PATH = "/nao/existe/ffmpeg";
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  delete process.env.FFMPEG_PATH; process.env.IG_FORMAT = "photo";
  assert.equal(r.published, true);
  assert.doesNotMatch(mediaCreates()[0].body, /REELS/);
  const saved = getQueueItem(it.id);
  assert.equal(saved.kind, "photo");
  assert.match(saved.reelError, /vídeo não gerado/);
});

test("Reels: Instagram recusa o vídeo antes de publicar -> posta como foto", { timeout: 120000 }, async () => {
  reset(); process.env.IG_FORMAT = "reels"; reelContainerFails = true;
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  process.env.IG_FORMAT = "photo";
  assert.equal(r.published, true);
  assert.equal(getQueueItem(it.id).kind, "photo");
});

test("Reels: erro no media_publish NÃO posta foto (evita duplicar)", { timeout: 120000 }, async () => {
  reset(); process.env.IG_FORMAT = "reels"; failReelPublish = true;
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  process.env.IG_FORMAT = "photo";
  assert.equal(r.published, false);
  assert.equal(getQueueItem(it.id).status, "failed");
  assert.equal(mediaCreates().length, 1); // só o container do Reel
});

test("legenda puxa conversa", () => {
  assert.match(buildCaption({ copy: { instagram: "Oi" }, affiliateLink: "https://s.shopee.com.br/a" }), /Você compraria\?/);
});
