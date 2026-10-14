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

/** ease-out cúbico entre t0 e t1, como expressão do ffmpeg (0→1). */
const ease = (t0, t1) => `(1-pow(1-min(max((t-${t0})/${t1 - t0},0),1),3))`;

/** Monta o filtro do ffmpeg que anima as camadas. */
export function buildFilter({ hasBadge, audio }) {
  const { W, H, DURATION: D } = REEL;
  const f = [];
  // [0] fundo: desliza devagar para cima (efeito de movimento contínuo)
  f.push(`[0:v]crop=${W}:${H}:0:'200*t/${D}',setsar=1,format=yuva420p[bg]`);
  // [1] frase de impacto: cai do topo
  f.push(`[bg][1:v]overlay=x='(W-w)/2':y='-h+(120+h)*${ease(0.1, 0.55)}'[v1]`);
  // [2] card: entra crescendo com leve exagero, depois zoom lento
  f.push(`[2:v]scale=w='trunc(iw*if(lt(t,0.3),0.02,if(lt(t,0.75),0.02+1.06*${ease(0.3, 0.75)},1.08-0.08*min((t-0.75)/0.25,1)+0.05*max(t-1,0)/${D}))/2)*2':h=-2:eval=frame[card]`);
  f.push(`[v1][card]overlay=x='(W-w)/2':y='485-h/2':enable='gte(t,0.3)'[v2]`);
  // [3] título: sobe e aparece
  f.push(`[3:v]format=rgba,fade=t=in:st=1.1:d=0.4:alpha=1[title]`);
  f.push(`[v2][title]overlay=x='(W-w)/2':y='800+30*(1-${ease(1.1, 1.5)})'[v3]`);
  // [4] preço: entra pela esquerda
  f.push(`[v3][4:v]overlay=x='-w+((W+w)/2)*${ease(2.0, 2.45)}':y='885':enable='gte(t,2.0)'[v4]`);
  let last = "v4";
  let idx = 5;
  if (hasBadge) {
    // selo: "pop" com quique
    f.push(`[${idx}:v]scale=w='trunc(max(4,iw*if(lt(t,2.7),0.02,if(lt(t,2.95),1.25*(t-2.7)/0.25,if(lt(t,3.1),1.25-0.25*(t-2.95)/0.15,1))))/2)*2':h=-2:eval=frame[badge]`);
    f.push(`[${last}][badge]overlay=x='590-w/2':y='300-h/2':enable='gte(t,2.7)'[v5]`);
    last = "v5";
    idx++;
  }
  // CTA: sobe e pulsa
  f.push(`[${idx}:v]scale=w='trunc(iw*(1+0.05*sin(2*PI*1.6*max(t-4.4,0)))/2)*2':h=-2:eval=frame[cta]`);
  f.push(`[${last}][cta]overlay=x='(W-w)/2':y='735+${H}*(1-${ease(3.9, 4.4)})-h/2':enable='gte(t,3.9)',format=yuv420p[vout]`);
  idx++;
  if (audio) {
    // Batida 120 bpm: bumbo nos tempos, chimbal nos contratempos, "pop" no selo, fade no fim
    const kick = `sin(2*PI*(45+90*exp(-28*mod(t,0.5)))*mod(t,0.5))*exp(-7*mod(t,0.5))*0.55`;
    const hat = `(random(0)-0.5)*exp(-70*mod(t+0.25,0.5))*0.22`;
    const bass = `sin(2*PI*if(lt(mod(t,2),1),55,65.4)*t)*0.12*(1-exp(-20*mod(t,0.5)))*exp(-2.5*mod(t,0.5))`;
    const pop = `gte(t,2.7)*sin(2*PI*1046*(t-2.7))*exp(-18*max(t-2.7,0))*0.35`;
    const swoosh = `gte(t,3.9)*(random(1)-0.5)*exp(-9*max(t-3.9,0))*0.18`;
    f.push(`aevalsrc='(${kick}+${hat}+${bass}+${pop}+${swoosh})*min(1,(${D}-t)/0.6)':s=44100:d=${D}[aout]`);
  }
  return f.join(";");
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
 * Roda o ffmpeg com duas travas: tempo máximo e memória máxima
 * (REELS_MAX_MB, padrão 260). Passou do limite, mata o ffmpeg — o post sai
 * como foto — em vez de deixar o Render derrubar o servidor inteiro por falta
 * de memória.
 */
function run(bin, args, timeoutMs) {
  const maxMb = Number(process.env.REELS_MAX_MB) || 260;
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    let killedFor = null;
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    const timer = setTimeout(() => {
      killedFor = "ffmpeg demorou demais para gerar o vídeo.";
      p.kill("SIGKILL");
    }, timeoutMs);
    const watch = setInterval(() => {
      const mb = rssMb(p.pid);
      if (mb != null && mb > maxMb) {
        killedFor = `ffmpeg passou do limite de memória (${Math.round(mb)} MB > ${maxMb} MB).`;
        p.kill("SIGKILL");
      }
    }, 150);
    const done = () => {
      clearTimeout(timer);
      clearInterval(watch);
    };
    p.on("error", (e) => {
      done();
      reject(new Error(`ffmpeg indisponível: ${e.message}`));
    });
    p.on("close", (code) => {
      done();
      if (killedFor) return reject(new Error(killedFor));
      code === 0 ? resolve() : reject(new Error(`ffmpeg falhou (${code}): ${err.split("\n").slice(-4).join(" ")}`));
    });
  });
}

/**
 * Gera o Reel. @returns {Promise<{buffer:Buffer, durationSec:number, coverOffsetMs:number}>}
 */
export async function renderReel({ product, photoBuffer, variant = 0, hook, timeoutMs = 6 * 60 * 1000 }) {
  const { W, H, FPS, DURATION: D } = REEL;
  const layers = await buildLayers({ product, photoBuffer, variant, hook });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));
  try {
    const order = ["bg", "hook", "card", "title", "price", ...(layers.badge ? ["badge"] : []), "cta"];
    const inputs = [];
    for (const name of order) {
      const file = path.join(dir, `${name}.png`);
      fs.writeFileSync(file, layers[name]);
      // -threads 1 por entrada: no Render o ffmpeg enxerga todos os núcleos da máquina
      // hospedeira e abriria dezenas de threads (com buffers) por imagem.
      inputs.push("-threads", "1", "-thread_queue_size", "4", "-loop", "1", "-framerate", String(FPS), "-t", String(D), "-i", file);
    }
    const audio = process.env.REELS_AUDIO !== "off";
    const out = path.join(dir, "reel.mp4");
    const args = [
      "-hide_banner", "-loglevel", "error", "-y", "-filter_threads", "1",
      ...inputs,
      "-filter_complex_threads", "1",
      "-filter_complex", buildFilter({ hasBadge: Boolean(layers.badge), audio }),
      "-map", "[vout]",
      ...(audio ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "128k", "-ar", "44100"] : []),
      "-c:v", "libx264", "-preset", process.env.REELS_PRESET || "veryfast", "-crf", "22",
      // memória baixa (Render grátis = 512 MB): sem lookahead/threads extras
      "-x264-params", "rc-lookahead=0:threads=1:sliced-threads=0:ref=2:bframes=0",
      "-pix_fmt", "yuv420p", "-r", String(FPS), "-s", `${W}x${H}`,
      "-profile:v", "high", "-level", "4.0",
      "-t", String(D), "-movflags", "+faststart", "-threads", process.env.REELS_THREADS || "1",
      out,
    ];
    await run(await ffmpegPath(), args, timeoutMs);
    return { buffer: fs.readFileSync(out), durationSec: D, coverOffsetMs: 4600 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
