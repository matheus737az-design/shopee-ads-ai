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

let calls, quota, failPublish;
function installFetch() {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET", body: opts.body ? String(opts.body) : "" });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.includes("content_publishing_limit")) return json({ data: [{ quota_usage: quota.used, config: { quota_total: quota.total } }] });
    if (u.endsWith("/123/media")) return json({ id: "cont1" });
    if (u.includes("/cont1")) return json({ status_code: "FINISHED" });
    if (u.endsWith("/123/media_publish")) return failPublish ? json({ error: { code: 190, message: "expired" } }, 400) : json({ id: "media9" });
    if (u.includes("/media9")) return json({ permalink: "https://instagram.com/p/xyz" });
    return json({ error: { message: "inesperado " + u } }, 404);
  };
}
test.beforeEach(() => { quota = { used: 0, total: 100 }; failPublish = false; hasPhoto = true; installFetch(); });

test("publica: container -> media_publish -> published, imagem é JPEG pública", async () => {
  const it = mk();
  const r = await publishItem(it.id, { baseUrl: "https://app.test" });
  assert.equal(r.published, true);
  const saved = getQueueItem(it.id);
  assert.equal(saved.status, "published");
  assert.equal(saved.igMediaId, "media9");
  const create = calls.find((c) => c.url.endsWith("/123/media"));
  assert.match(create.body, /image_url=https%3A%2F%2Fapp\.test%2Fapi%2Fpublic-image%2F[a-f0-9]{48}\.jpg/);
});

test("respeita o limite diário configurado (2)", async () => {
  const a = mk(), b = mk(), c = mk();
  const before = listQueue().filter((i) => i.status === "published").length; // já pode haver 1 do teste anterior
  const results = [];
  for (const it of [a, b, c]) results.push((await publishItem(it.id, { baseUrl: "https://app.test" })).published);
  const total = before + results.filter(Boolean).length;
  assert.equal(total, 2);
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
