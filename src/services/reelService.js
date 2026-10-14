import sharp from "sharp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * reelService — gera um Reel vertical (720×1280, ~8s, MP4 H.264 + AAC) a
 * partir da foto do produto, 100% automático e original.
 *
 * Como funciona: o sharp desenha cada elemento como uma camada PNG
 * (fundo, frase de impacto, card com a foto, título, preço, selo de
 * desconto, chamada final) e o ffmpeg anima as camadas com expressões
 * (entrar deslizando, "pop" do selo, zoom lento na foto, pulsar do CTA).
 * Assim o servidor não precisa desenhar 240 quadros um a um — importante no
 * Render grátis, que tem CPU bem limitada.
 *
 * A trilha é uma batida simples sintetizada pelo próprio ffmpeg (sem música
 * de terceiros). REELS_AUDIO=off gera o vídeo mudo.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "..", "..", "assets", "fonts");
const FONT_BLACK = path.join(FONT_DIR, "InterDisplay-Black.otf");
const FONT_BOLD = path.join(FONT_DIR, "Inter-Bold.otf");

export const REEL = { W: 720, H: 1280, FPS: 30, DURATION: 8 };

const PALETTES = [
  { key: "AMARELO", bg: "#FFD23F", stripe: "#FFC300", ink: "#1A1A2E", hookBg: "#1A1A2E", hookInk: "#FFD23F", price: "#FF4B3E", old: "#1A1A2E99", ctaBg: "#FF4B3E", ctaInk: "#FFFFFF", badgeBg: "#FF4B3E", badgeInk: "#FFFFFF" },
  { key: "VERMELHO", bg: "#FF4B3E", stripe: "#F23F33", ink: "#FFFFFF", hookBg: "#FFD23F", hookInk: "#1A1A2E", price: "#FFD23F", old: "#FFFFFFAA", ctaBg: "#FFD23F", ctaInk: "#1A1A2E", badgeBg: "#1A1A2E", badgeInk: "#FFD23F" },
];

export const HOOKS = [
  "ACHADINHO DA SHOPEE",
  "OLHA O QUE EU ACHEI",
  "PREÇO DE ACHADINHO",
  "CORRE QUE TÁ BARATO",
  "MAIS VENDIDO DA SHOPEE",
];

const money = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const markup = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Texto como PNG transparente (Pango), com fonte própria do projeto. */
async function textPng(text, { font = FONT_BLACK, size, color, width, align = "centre", spacing = 0 }) {
  const family = font === FONT_BLACK ? "Inter Display Black" : "Inter Bold";
  const buf = await sharp({
    text: {
      text: `<span foreground="${color}">${markup(text)}</span>`,
      fontfile: font,
      font: `${family} ${size}`,
      width,
      align,
      spacing,
      rgba: true,
      dpi: 72,
      wrap: "word",
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return buf;
}

/** Pílula arredondada com texto centralizado. */
async function pill(text, { size, bg, ink, padX = 34, padY = 18 }) {
  const t = await textPng(text, { size, color: ink });
  const w = t.info.width + padX * 2;
  const h = t.info.height + padY * 2;
  const shape = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${h / 2}" fill="${bg}"/></svg>`);
  return sharp(shape).composite([{ input: t.data, left: padX, top: padY }]).png().toBuffer();
}

function truncateTitle(title, max = 60) {
  const clean = String(title || "Produto").replace(/\s+/g, " ").replace(/[|•]+.*$/, "").trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

/**
 * Monta as camadas (PNGs) do Reel.
 * @returns {Promise<Record<string, Buffer>>}
 */
export async function buildLayers({ product, photoBuffer, variant = 0, hook }) {
  const { W, H } = REEL;
  const c = PALETTES[variant % PALETTES.length];
  const layers = {};

  // Fundo com listras diagonais sutis (dá textura e movimento quando desliza)
  const stripes = Array.from({ length: 40 }, (_, i) => `<rect x="${i * 70 - 1400}" y="-200" width="26" height="${H * 2 + 400}" fill="${c.stripe}" transform="rotate(25)"/>`).join("");
  layers.bg = await sharp(Buffer.from(`<svg width="${W}" height="${H + 200}"><rect width="${W}" height="${H + 200}" fill="${c.bg}"/>${stripes}</svg>`)).png().toBuffer();

  layers.hook = await pill(hook || HOOKS[0], { size: 40, bg: c.hookBg, ink: c.hookInk });

  // Card branco com a foto do produto
  const CARD = 500, PAD = 20, R = 42;
  const inner = CARD - PAD * 2;
  const photo = photoBuffer
    ? await sharp(photoBuffer).resize(inner, inner, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).png().toBuffer()
    : await sharp({ create: { width: inner, height: inner, channels: 3, background: "#f2f2f2" } }).png().toBuffer();
  const roundMask = Buffer.from(`<svg width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${R - 10}" fill="#fff"/></svg>`);
  const photoRounded = await sharp(photo).composite([{ input: roundMask, blend: "dest-in" }]).png().toBuffer();
  const cardShape = Buffer.from(`<svg width="${CARD + 24}" height="${CARD + 30}">
      <rect x="12" y="20" width="${CARD}" height="${CARD}" rx="${R}" fill="#000" opacity=".18"/>
      <rect x="12" y="8" width="${CARD}" height="${CARD}" rx="${R}" fill="#fff"/></svg>`);
  layers.card = await sharp(cardShape).composite([{ input: photoRounded, left: 12 + PAD, top: 8 + PAD }]).png().toBuffer();

  layers.title = (await textPng(truncateTitle(product.title, 56), { font: FONT_BOLD, size: 32, color: c.ink, width: W - 120 })).data;

  // Preço: antigo riscado + novo grande
  const priceNew = await textPng(money(product.price), { size: 84, color: c.price });
  const parts = [{ input: priceNew.data, left: 0, top: 0 }];
  let pw = priceNew.info.width, ph = priceNew.info.height;
  if (product.originalPrice && product.originalPrice > product.price) {
    const old = await textPng(`de ${money(product.originalPrice)}`, { font: FONT_BOLD, size: 34, color: c.old });
    const strike = Buffer.from(`<svg width="${old.info.width}" height="${old.info.height}"><rect x="${old.info.width * 0.18}" y="${old.info.height / 2}" width="${old.info.width * 0.82}" height="4" fill="${c.old}"/></svg>`);
    const oldImg = await sharp(old.data).composite([{ input: strike }]).png().toBuffer();
    parts.forEach((p) => (p.top += old.info.height + 2));
    parts.push({ input: oldImg, left: Math.round((Math.max(pw, old.info.width) - old.info.width) / 2), top: 0 });
    ph += old.info.height + 2;
    pw = Math.max(pw, old.info.width);
    parts[0].left = Math.round((pw - priceNew.info.width) / 2);
  }
  layers.price = await sharp({ create: { width: pw, height: ph, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(parts).png().toBuffer();

  // Selo de desconto
  const pct = product.discountPercentage ? Math.round(product.discountPercentage) : null;
  if (pct && pct >= 5) {
    const B = 190;
    const t = await textPng(`-${pct}%`, { size: 56, color: c.badgeInk });
    const off = await textPng("OFF", { size: 30, color: c.badgeInk });
    const svg = Buffer.from(`<svg width="${B}" height="${B}"><circle cx="${B / 2}" cy="${B / 2}" r="${B / 2 - 4}" fill="${c.badgeBg}" stroke="#fff" stroke-width="8"/></svg>`);
    layers.badge = await sharp(svg)
      .composite([
        { input: t.data, left: Math.round((B - t.info.width) / 2), top: Math.round(B / 2 - t.info.height + 8) },
        { input: off.data, left: Math.round((B - off.info.width) / 2), top: Math.round(B / 2 + 6) },
      ])
      .png()
      .toBuffer();
  }

  // Chamada final (o @ da conta o próprio Instagram já mostra no Reel)
  layers.cta = await pill("LINK NA BIO", { size: 46, bg: c.ctaBg, ink: c.ctaInk, padX: 46, padY: 22 });

  return layers;
}

/* ------------------------------------------------------------------ */
/* Animação: cada quadro é composto no Node (sharp) e enviado cru ao   */
/* ffmpeg, que só codifica. Memória previsível (~1 quadro por vez).    */
/* ------------------------------------------------------------------ */

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
/** ease-out cúbico de 0→1 entre t0 e t1 */
const E = (t, t0, t1) => 1 - Math.pow(1 - clamp01((t - t0) / (t1 - t0)), 3);

/** Estado de cada camada no instante t (posição pelo centro ou canto, escala, opacidade). */
export function frameState(t, { hasBadge }) {
  const { W, H, DURATION: D } = REEL;
  const st = { bgOffset: (200 * t) / D, items: [] };
  st.items.push({ name: "hook", cx: W / 2, top: (h) => -h + (120 + h) * E(t, 0.1, 0.55), scale: 1 });
  if (t >= 0.3) {
    let s;
    if (t < 0.75) s = 0.02 + 1.06 * E(t, 0.3, 0.75);
    else s = 1.08 - 0.08 * Math.min((t - 0.75) / 0.25, 1) + (0.05 * Math.max(t - 1, 0)) / D;
    st.items.push({ name: "card", cx: W / 2, cy: 485, scale: s });
  }
  if (t >= 1.1) st.items.push({ name: "title", cx: W / 2, top: () => 800 + 30 * (1 - E(t, 1.1, 1.5)), scale: 1, alpha: clamp01((t - 1.1) / 0.4) });
  if (t >= 2.0) st.items.push({ name: "price", left: (w) => -w + ((W + w) / 2) * E(t, 2.0, 2.45), top: () => 885, scale: 1 });
  if (hasBadge && t >= 2.7) {
    const s = t < 2.95 ? (1.25 * (t - 2.7)) / 0.25 : t < 3.1 ? 1.25 - (0.25 * (t - 2.95)) / 0.15 : 1;
    st.items.push({ name: "badge", cx: 590, cy: 300, scale: Math.max(s, 0.03) });
  }
  if (t >= 3.9) {
    st.items.push({ name: "cta", cx: W / 2, cy: 735 + H * (1 - E(t, 3.9, 4.4)), scale: 1 + 0.05 * Math.sin(2 * Math.PI * 1.6 * Math.max(t - 4.4, 0)) });
  }
  return st;
}

/** Converte as camadas PNG para RGBA cru (uma vez). */
async function toRaw(layers) {
  const out = {};
  for (const [k, png] of Object.entries(layers)) {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    out[k] = { data, w: info.width, h: info.height };
  }
  return out;
}

const rawImg = (l) => ({ raw: { width: l.w, height: l.h, channels: 4 } });

/** Recorta a parte visível de uma camada colocada em (x,y) num quadro W×H. */
async function placeVisible(layer, x, y) {
  const { W, H } = REEL;
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x) + layer.w), y1 = Math.min(H, Math.round(y) + layer.h);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  if (x0 === Math.round(x) && y0 === Math.round(y) && x1 - x0 === layer.w && y1 - y0 === layer.h) {
    return { input: layer.data, ...rawImg(layer), left: x0, top: y0 };
  }
  const data = await sharp(layer.data, rawImg(layer))
    .extract({ left: x0 - Math.round(x), top: y0 - Math.round(y), width: x1 - x0, height: y1 - y0 })
    .raw()
    .toBuffer();
  return { input: data, raw: { width: x1 - x0, height: y1 - y0, channels: 4 }, left: x0, top: y0 };
}

async function scaled(layer, scale) {
  if (Math.abs(scale - 1) < 0.002) return layer;
  const w = Math.max(2, Math.round(layer.w * scale));
  const { data, info } = await sharp(layer.data, rawImg(layer)).resize({ width: w }).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

async function faded(layer, alpha) {
  if (alpha >= 0.999) return layer;
  const data = Buffer.from(layer.data);
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * alpha);
  return { ...layer, data };
}

/** Compõe o quadro do instante t e devolve RGB cru (W×H×3). */
export async function composeFrame(raw, t) {
  const { W, H } = REEL;
  const st = frameState(t, { hasBadge: Boolean(raw.badge) });
  const bg = await sharp(raw.bg.data, rawImg(raw.bg)).extract({ left: 0, top: Math.round(st.bgOffset), width: W, height: H }).raw().toBuffer();
  const comps = [];
  for (const it of st.items) {
    let l = raw[it.name];
    if (!l) continue;
    l = await scaled(l, it.scale);
    if (it.alpha != null) l = await faded(l, it.alpha);
    const x = it.left ? it.left(l.w) : it.cx - l.w / 2;
    const y = it.top ? it.top(l.h) : it.cy - l.h / 2;
    const c = await placeVisible(l, x, y);
    if (c) comps.push(c);
  }
  return sharp(bg, { raw: { width: W, height: H, channels: 4 } }).composite(comps).removeAlpha().raw().toBuffer();
}

/** Trilha: batida 120 bpm, "pop" no selo e "swoosh" no CTA (ffmpeg aevalsrc). */
export function audioExpr() {
  const D = REEL.DURATION;
  const kick = `sin(2*PI*(45+90*exp(-28*mod(t,0.5)))*mod(t,0.5))*exp(-7*mod(t,0.5))*0.55`;
  const hat = `(random(0)-0.5)*exp(-70*mod(t+0.25,0.5))*0.22`;
  const bass = `sin(2*PI*if(lt(mod(t,2),1),55,65.4)*t)*0.12*(1-exp(-20*mod(t,0.5)))*exp(-2.5*mod(t,0.5))`;
  const pop = `gte(t,2.7)*sin(2*PI*1046*(t-2.7))*exp(-18*max(t-2.7,0))*0.35`;
  const swoosh = `gte(t,3.9)*(random(1)-0.5)*exp(-9*max(t-3.9,0))*0.18`;
  return `aevalsrc='(${kick}+${hat}+${bass}+${pop}+${swoosh})*min(1,(${D}-t)/0.6)':s=44100:d=${D}`;
}

async function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const mod = await import("ffmpeg-static");
    if (mod.default && fs.existsSync(mod.default)) return mod.default;
  } catch {
    /* ffmpeg-static não instalado: usa o ffmpeg do sistema */
  }
  return "ffmpeg";
}

/** Memória (RSS) do processo em MB, lida do /proc (Linux). null se indisponível. */
function rssMb(pid) {
  try {
    const m = fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? Number(m[1]) / 1024 : null;
  } catch {
    return null;
  }
}

/**
 * Gera o Reel. Trava de tempo e de memória (REELS_MAX_MB, padrão 200 MB para
 * o ffmpeg): se passar, aborta — e o post sai como foto — em vez de deixar o
 * Render derrubar o servidor.
 * @returns {Promise<{buffer:Buffer, durationSec:number, coverOffsetMs:number}>}
 */
export async function renderReel({ product, photoBuffer, variant = 0, hook, timeoutMs = 8 * 60 * 1000 }) {
  const { W, H, FPS, DURATION: D } = REEL;
  sharp.cache(false);
  sharp.concurrency(1);
  const raw = await toRaw(await buildLayers({ product, photoBuffer, variant, hook }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));
  const out = path.join(dir, "reel.mp4");
  const audio = process.env.REELS_AUDIO !== "off";
  const maxMb = Number(process.env.REELS_MAX_MB) || 200;
  const args = [
    "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-filter_threads", "1",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "pipe:0",
    ...(audio ? ["-f", "lavfi", "-i", audioExpr()] : []),
    "-map", "0:v", ...(audio ? ["-map", "1:a", "-c:a", "aac", "-b:a", "128k", "-ar", "44100"] : []),
    "-c:v", "libx264", "-preset", process.env.REELS_PRESET || "veryfast", "-crf", "22",
    "-x264-params", "threads=1:lookahead-threads=1:sliced-threads=0:rc-lookahead=0:ref=2:bframes=0",
    "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.0",
    "-t", String(D), "-movflags", "+faststart",
    out,
  ];
  const bin = await ffmpegPath();
  const p = spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"], env: { ...process.env, MALLOC_ARENA_MAX: "2" } });
  let err = "";
  let abort = null;
  p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
  p.stdin.on("error", () => {}); // ffmpeg morto -> escrita falha; tratado abaixo
  const exited = new Promise((resolve) => p.on("close", resolve));
  const spawnError = new Promise((_, reject) => p.on("error", (e) => reject(new Error(`ffmpeg indisponível: ${e.message}`))));
  const kill = (why) => {
    if (!abort) abort = why;
    p.kill("SIGKILL");
  };
  const timer = setTimeout(() => kill("a geração do vídeo demorou demais."), timeoutMs);
  const watch = setInterval(() => {
    const mb = rssMb(p.pid);
    if (mb != null && mb > maxMb) kill(`ffmpeg passou do limite de memória (${Math.round(mb)} MB > ${maxMb} MB).`);
  }, 150);
  try {
    const frames = Math.round(D * FPS);
    const writeAll = (async () => {
      for (let i = 0; i < frames && !abort; i++) {
        const frame = await composeFrame(raw, i / FPS);
        if (!p.stdin.write(frame)) {
          await new Promise((r) => {
            const done = () => {
              p.stdin.off("drain", done);
              p.stdin.off("close", done);
              r();
            };
            p.stdin.on("drain", done);
            p.stdin.on("close", done);
          });
        }
      }
      p.stdin.end();
    })();
    await Promise.race([writeAll, spawnError]);
    const code = await Promise.race([exited, spawnError]);
    if (abort) throw new Error(abort);
    if (code !== 0) throw new Error(`ffmpeg falhou (${code}): ${err.split("\n").slice(-4).join(" ")}`);
    return { buffer: fs.readFileSync(out), durationSec: D, coverOffsetMs: 4600 };
  } finally {
    clearTimeout(timer);
    clearInterval(watch);
    if (p.exitCode == null) p.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
