// @ts-nocheck
"use strict";
declare const React: any;
declare const ReactDOM: any;
const { useState, useRef, useEffect, useCallback } = React;

/* =========================================================================
   ACESSO AO BACKEND — mesma origem, então usamos caminhos relativos (/api/...)
   ========================================================================= */
const API_BASE = "/api";

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erro ${res.status} ao falar com o backend.`);
  }
  return res.json();
}

/** Chama /api/generate/art e devolve um blob de imagem (PNG), ou lança erro com a mensagem do backend. */
async function apiGenerateArt(product: any, template: string, format: string, manualPhoto: string | null) {
  const res = await fetch(`${API_BASE}/generate/art`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product, template, format, manualPhoto }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erro ${res.status} ao gerar a arte.`);
  }
  const photoSource = res.headers.get("X-Photo-Source");
  const blob = await res.blob();
  return { blob, photoSource };
}

const api = {
  health: () => apiFetch("/health"),
  generate: (url: string, style: string) => apiFetch("/generate", { method: "POST", body: JSON.stringify({ url, style }) }),
  regenerateText: (product: any, style: string) => apiFetch("/generate/text", { method: "POST", body: JSON.stringify({ product, style }) }),
  listAds: () => apiFetch("/ads"),
  saveAd: (ad: any) => apiFetch("/ads", { method: "POST", body: JSON.stringify(ad) }),
  updateAd: (id: string, fields: any) => apiFetch(`/ads/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
  platforms: () => apiFetch("/ads/publish/platforms"),
  publish: (adId: string, platform: string) => apiFetch(`/ads/${adId}/publish`, { method: "POST", body: JSON.stringify({ platform }) }),
  dashboard: () => apiFetch("/dashboard"),
};

function money(v: number | null | undefined) {
  return v == null ? null : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const TEXT_STYLES = [
  { key: "oferta", label: "Oferta", emoji: "🔥" },
  { key: "beneficio", label: "Benefício", emoji: "💡" },
  { key: "desejo", label: "Desejo", emoji: "😍" },
  { key: "viral", label: "Viral", emoji: "⚡" },
  { key: "profissional", label: "Profissional", emoji: "🛍️" },
];

const ART_TEMPLATES = [
  { key: "OFERTA", label: "Oferta", emoji: "🔥" },
  { key: "ELEGANTE", label: "Elegante", emoji: "✨" },
  { key: "MODERNO", label: "Moderno", emoji: "🧊" },
  { key: "VIRAL", label: "Viral", emoji: "⚡" },
];

const ART_FORMATS = [
  { key: "stories", label: "Stories", dims: "1080×1920", ratio: "1080 / 1920" },
  { key: "feed", label: "Feed vertical", dims: "1080×1350", ratio: "1080 / 1350" },
  { key: "quadrado", label: "Quadrado", dims: "1080×1080", ratio: "1 / 1" },
];

const CAPTION_FIELDS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "alternative", label: "Alternativa" },
];

const PLATFORM_EMOJI: Record<string, string> = { whatsapp: "💬", telegram: "✈️", facebook: "📘", instagram: "📸", tiktok: "🎵" };

const EXAMPLES = [
  { title: "Organizador de Gavetas 6 Divisórias", images: ["🗄️"], price: 39.9, originalPrice: 59.9 },
  { title: "Mini Umidificador USB com LED", images: ["💧"], price: 27.5, originalPrice: 45.0 },
  { title: "Fone Bluetooth TWS Prova D'água", images: ["🎧"], price: 59.9, originalPrice: 129.9 },
];

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const DISPLAY_FONT = "'Space Grotesk', 'Arial Black', sans-serif";
const BRAND = { primary: "#FF4B3E", ink: "#1A1A2E", cream: "#FFF8F0", lime: "#C6F135" };

const LOADING_STEPS = ["Link recebido", "Buscando produto e gerando texto...", "Produto e texto prontos", "Gerando a arte...", "Finalizando anúncio..."];

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: BRAND.primary }}>
        <span className="icon text-white">✨</span>
      </div>
      <span className="font-bold text-lg" style={{ color: BRAND.ink, fontFamily: DISPLAY_FONT }}>Shopee Ads AI</span>
    </div>
  );
}

function ConnectionBanner({ online, onRetry }: { online: boolean | null; onRetry: () => void }) {
  if (online !== false) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs font-medium" style={{ background: "#FEF2F2", color: "#B91C1C" }}>
      <span className="icon">⚠️</span>
      Não consegui falar com o backend. Confira se ele está rodando ("npm run dev" na pasta backend).
      <button onClick={onRetry} className="ml-auto underline flex-shrink-0">Tentar de novo</button>
    </div>
  );
}

function NavBar({ screen, setScreen }: { screen: string; setScreen: (s: string) => void }) {
  const items = [
    { key: "home", label: "Novo anúncio", emoji: "✨" },
    { key: "history", label: "Meus anúncios", emoji: "🕘" },
    { key: "dashboard", label: "Dashboard", emoji: "📊" },
    { key: "automation", label: "Instagram", emoji: "🤖" },
  ];
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#00000010" }}>
      <Logo />
      <div className="flex gap-1 bg-black/5 rounded-full p-1">
        {items.map((it) => {
          const active = screen === it.key || (screen === "loading" && it.key === "home") || (screen === "result" && it.key === "home");
          return (
            <button
              key={it.key}
              onClick={() => setScreen(it.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
              style={active ? { background: "#fff", color: BRAND.ink, boxShadow: "0 1px 3px rgba(0,0,0,.1)" } : { color: "#00000066" }}
            >
              <span>{it.emoji}</span> {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ExampleCard({ p }: { p: any }) {
  return (
    <div className="rounded-2xl p-4 bg-white border" style={{ borderColor: "#00000010", minWidth: 220 }}>
      <div className="text-5xl mb-2">{p.images[0]}</div>
      <div className="text-sm font-semibold line-clamp-2" style={{ color: BRAND.ink }}>{p.title}</div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="font-bold" style={{ color: BRAND.primary }}>{money(p.price)}</span>
        {p.originalPrice && <span className="text-xs text-gray-400 line-through">{money(p.originalPrice)}</span>}
      </div>
    </div>
  );
}

function HomeScreen({ link, setLink, onGenerate, error }: any) {
  return (
    <div className="relative flex flex-col items-center px-6 py-16 overflow-hidden" style={{ background: BRAND.cream, minHeight: "100%" }}>
      <svg className="absolute pointer-events-none" style={{ top: -80, right: -120, opacity: 0.35 }} width="520" height="520" viewBox="0 0 520 520">
        <defs><filter id="blob-blur"><feGaussianBlur stdDeviation="40" /></filter></defs>
        <path filter="url(#blob-blur)" fill={BRAND.lime} d="M260 60c90 0 170 70 190 150s-30 170-120 190-190-10-220-100S60 130 150 90s70-30 110-30z" />
      </svg>
      <div className="relative max-w-xl w-full text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-6" style={{ background: `${BRAND.lime}55`, color: BRAND.ink }}>
          <span>✨</span> Feito para afiliados que não têm tempo a perder
        </div>
        <h1 className="text-4xl font-extrabold leading-tight mb-4" style={{ color: BRAND.ink, fontFamily: DISPLAY_FONT }}>
          Transforme qualquer produto da Shopee em uma publicação pronta para vender.
        </h1>
        <p className="text-gray-500 mb-8">Cole o link, clique em gerar e receba texto + arte prontos para postar.</p>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch">
          <div className="flex items-center gap-2 flex-1 bg-white rounded-xl px-4 py-3 border" style={{ borderColor: error ? BRAND.primary : "#00000015" }}>
            <span className="text-gray-400 flex-shrink-0">🔗</span>
            <input
              value={link}
              onChange={(e: any) => setLink(e.target.value)}
              placeholder="Cole o link do produto Shopee"
              className="flex-1 outline-none text-sm bg-transparent"
              onKeyDown={(e: any) => e.key === "Enter" && onGenerate()}
            />
          </div>
          <button onClick={onGenerate} className="rounded-xl px-6 py-3 font-semibold text-white flex items-center justify-center gap-2 whitespace-nowrap transition-transform active:scale-95" style={{ background: BRAND.primary }}>
            <span>✨</span> Gerar anúncio
          </button>
        </div>
        {error && <p className="text-sm mt-2 text-left" style={{ color: BRAND.primary }}>{error}</p>}
        <p className="text-xs text-gray-400 mt-3">O texto é escrito automaticamente e pode ser editado antes de publicar.</p>
      </div>
      <div className="relative mt-16 w-full max-w-4xl">
        <p className="text-sm font-semibold text-gray-500 mb-4">Exemplos de anúncios gerados</p>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {EXAMPLES.map((p, i) => <ExampleCard key={i} p={p} />)}
        </div>
      </div>
    </div>
  );
}

function LoadingScreen({ step }: { step: number }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24" style={{ background: BRAND.cream, minHeight: "100%" }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-8 animate-pulse" style={{ background: BRAND.primary }}>
        <span className="text-2xl">✨</span>
      </div>
      <div className="max-w-xs w-full space-y-3">
        {LOADING_STEPS.map((label, i) => {
          const done = i < step, current = i === step;
          return (
            <div key={label} className="flex items-center gap-3 text-sm">
              <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs" style={{ background: done ? "#22c55e" : current ? BRAND.primary : "#00000015" }}>
                {done ? "✓" : ""}
              </span>
              <span style={{ color: done || current ? BRAND.ink : "#00000055", fontWeight: current ? 600 : 400 }}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultScreen({
  product, onUpdateProduct, copy, activeCaptionKey, setActiveCaptionKey, text, setText,
  style, setStyle, template, setTemplate, format, setFormat, onRegenText,
  artUrl, artLoading, artError, onDownload, onCopyCaption, copiedField,
  onCopyLink, onShareWhatsApp, onShareInstagram, onPublish, affLink, isAffiliate, affiliateWarning, saveMsg,
  manualPhotoInput, setManualPhotoInput, onApplyManualPhotoUrl, onPickPhoto,
}: any) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentFormat = ART_FORMATS.find((f: any) => f.key === format) || ART_FORMATS[0];

  return (
    <div className="grid md:grid-cols-2 gap-8 p-6 md:p-10" style={{ background: BRAND.cream, minHeight: "100%" }}>
      <div>
        <div
          className="rounded-2xl overflow-hidden shadow-lg border bg-white max-w-md mx-auto flex items-center justify-center"
          style={{ borderColor: "#00000010", aspectRatio: currentFormat.ratio }}
        >
          {artLoading && <span className="text-sm text-gray-400">Gerando arte…</span>}
          {!artLoading && artError && <span className="text-sm p-4 text-center" style={{ color: BRAND.primary }}>{artError}</span>}
          {!artLoading && !artError && artUrl && <img src={artUrl} alt="Arte gerada" className="w-full h-full object-contain" />}
        </div>

        <div className="flex flex-wrap gap-2 justify-center mt-4 max-w-md mx-auto">
          {ART_TEMPLATES.map((t) => (
            <button
              key={t.key}
              onClick={() => setTemplate(t.key)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border"
              style={template === t.key ? { background: BRAND.ink, color: "#fff", borderColor: BRAND.ink } : { color: BRAND.ink, borderColor: "#00000015" }}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 justify-center mt-2 max-w-md mx-auto">
          {ART_FORMATS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFormat(f.key)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border"
              style={format === f.key ? { background: BRAND.lime, color: BRAND.ink, borderColor: BRAND.lime } : { color: BRAND.ink, borderColor: "#00000015" }}
            >
              {f.label} ({f.dims})
            </button>
          ))}
        </div>

        <div className="mt-4 max-w-md mx-auto bg-white rounded-xl border p-3" style={{ borderColor: "#00000010" }}>
          <p className="text-xs font-semibold mb-2" style={{ color: BRAND.ink }}>Foto do produto</p>
          <label className="text-xs text-gray-500 block mb-1">Link de outra imagem (opcional — cole e clique em "Usar")</label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={manualPhotoInput}
              placeholder="https://..."
              onChange={(e: any) => setManualPhotoInput(e.target.value)}
              className="flex-1 border rounded-lg px-2 py-1.5 text-xs"
              style={{ borderColor: "#00000015", color: BRAND.ink }}
            />
            <button onClick={onApplyManualPhotoUrl} className="px-3 py-1.5 rounded-lg text-xs font-semibold border" style={{ borderColor: "#00000015", color: BRAND.ink }}>Usar</button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg border"
            style={{ borderColor: "#00000015", color: BRAND.ink }}
          >
            <span>🖼️</span> Ou envie um arquivo do computador
          </button>
          <p className="text-[11px] text-gray-400 mt-2">A arte é gerada no servidor com a foto já embutida — por isso o download/compartilhamento sempre traz a imagem certa.</p>

          <div className="flex gap-2 mt-3">
            <label className="flex-1 text-xs text-gray-500">
              Preço atual
              <input
                type="number" step="0.01"
                value={product.price ?? ""}
                placeholder="0,00"
                onChange={(e: any) => onUpdateProduct({ price: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-full mt-1 border rounded-lg px-2 py-1.5 text-sm" style={{ borderColor: "#00000015", color: BRAND.ink }}
              />
            </label>
            <label className="flex-1 text-xs text-gray-500">
              Preço anterior (opcional)
              <input
                type="number" step="0.01"
                value={product.originalPrice ?? ""}
                placeholder="0,00"
                onChange={(e: any) => onUpdateProduct({ originalPrice: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-full mt-1 border rounded-lg px-2 py-1.5 text-sm" style={{ borderColor: "#00000015", color: BRAND.ink }}
              />
            </label>
          </div>
        </div>

        <div className="flex gap-2 justify-center mt-4 max-w-md mx-auto">
          <button onClick={onDownload} disabled={!artUrl} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: BRAND.primary }}>
            <span>⬇️</span> Baixar imagem
          </button>
        </div>
      </div>

      <div className="max-w-md w-full mx-auto md:mx-0">
        <h2 className="text-2xl font-bold mb-1" style={{ color: BRAND.ink, fontFamily: DISPLAY_FONT }}>Seu anúncio está pronto!</h2>
        <p className="text-sm text-gray-500 mb-1">{product.title}</p>
        {copy?.source === "mock" && <p className="text-[11px] text-gray-400 mb-3">Texto gerado por modelo local (sem IA configurada no servidor).</p>}

        <div className="flex flex-wrap gap-2 mb-3">
          {TEXT_STYLES.map((s) => (
            <button
              key={s.key}
              onClick={() => setStyle(s.key)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border"
              style={style === s.key ? { background: BRAND.lime, color: BRAND.ink, borderColor: BRAND.lime } : { color: BRAND.ink, borderColor: "#00000015" }}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>

        {copy?.title && (
          <div className="mb-3">
            <p className="text-xs text-gray-400 mb-1">Título curto</p>
            <p className="text-sm font-semibold" style={{ color: BRAND.ink }}>{copy.title}</p>
          </div>
        )}

        <div className="flex gap-1 mb-2">
          {CAPTION_FIELDS.map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveCaptionKey(f.key)}
              className="px-3 py-1 rounded-full text-xs font-medium border"
              style={activeCaptionKey === f.key ? { background: BRAND.ink, color: "#fff", borderColor: BRAND.ink } : { color: BRAND.ink, borderColor: "#00000015" }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e: any) => setText(e.target.value)}
          rows={9}
          className="w-full rounded-xl border p-4 text-sm outline-none bg-white resize-none"
          style={{ borderColor: "#00000015", color: BRAND.ink }}
        />

        <div className="flex gap-2 mt-3">
          <button onClick={() => onCopyCaption(activeCaptionKey)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border flex-1 justify-center" style={{ borderColor: "#00000015", color: BRAND.ink }}>
            <span>{copiedField === activeCaptionKey ? "✅" : "📋"}</span> {copiedField === activeCaptionKey ? "Copiado!" : "Copiar legenda"}
          </button>
          <button onClick={onRegenText} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border flex-1 justify-center" style={{ borderColor: "#00000015", color: BRAND.ink }}>
            <span>🔄</span> Gerar outra versão
          </button>
        </div>

        {copy?.cta && <p className="text-xs text-gray-400 mt-2">CTA sugerido: <span style={{ color: BRAND.ink }}>{copy.cta}</span></p>}

        {affiliateWarning && (
          <div className="mt-4 p-3 rounded-xl text-xs" style={{ background: "#FFF7E6", color: "#926A00", border: "1px solid #F5D98E" }}>
            ⚠️ {affiliateWarning}
          </div>
        )}

        <div className="mt-3 p-3 rounded-xl bg-white border text-xs flex items-center gap-2" style={{ borderColor: "#00000010" }}>
          <span className="text-gray-400 flex-shrink-0">🔗</span>
          <span className="truncate text-gray-500">{affLink}</span>
          <span className="ml-auto text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={isAffiliate ? { background: "#dcfce7", color: "#16a34a" } : { background: "#fee2e2", color: "#b91c1c" }}>
            {isAffiliate ? "afiliado" : "não confirmado"}
          </span>
        </div>

        <div className="flex gap-2 mt-3">
          <button onClick={onCopyLink} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border" style={{ borderColor: "#00000015", color: BRAND.ink }}>
            <span>{copiedField === "link" ? "✅" : "🔗"}</span> Copiar link
          </button>
          <button
            onClick={onShareWhatsApp}
            disabled={!artUrl}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: "#25D366" }}
          >
            <span>💬</span> WhatsApp
          </button>
          <button
            onClick={onShareInstagram}
            disabled={!artUrl}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)" }}
          >
            <span>📸</span> Instagram
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">
          No celular, isso abre o menu de compartilhar do sistema já com a imagem e a legenda prontas — é só tocar no WhatsApp ou Instagram. No computador, a imagem é baixada e a legenda copiada automaticamente.
        </p>

        <button onClick={onPublish} className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white" style={{ background: BRAND.ink }}>
          <span>🚀</span> Publicar
        </button>
        {saveMsg && <p className="text-xs text-center mt-2 text-gray-400">{saveMsg}</p>}
      </div>
    </div>
  );
}

function PublishModal({ onClose, platforms, onSelect, publishing }: any) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full" onClick={(e: any) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold" style={{ color: BRAND.ink }}>Publicar em</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {platforms.map((p: any) => (
            <button
              key={p.key}
              disabled={!p.ready || publishing}
              onClick={() => p.ready && onSelect(p.key)}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs"
              style={p.ready ? { borderColor: "#00000015", color: BRAND.ink, cursor: "pointer" } : { borderColor: "#00000008", color: "#00000033", cursor: "not-allowed" }}
            >
              <span className="text-xl">{PLATFORM_EMOJI[p.key] || "🚀"}</span>
              {p.label}
              {!p.ready && <span className="text-xs">em breve</span>}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-4">WhatsApp, Telegram e Facebook abrem o compartilhamento direto. Instagram usa o menu de compartilhar do celular (ou baixa a imagem e copia o texto no computador). TikTok ainda não está disponível.</p>
      </div>
    </div>
  );
}

function HistoryScreen({ items, onOpen }: any) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6" style={{ background: BRAND.cream, minHeight: "100%" }}>
        <span className="text-4xl mb-3">🖼️</span>
        <p className="font-semibold" style={{ color: BRAND.ink }}>Nenhum anúncio ainda</p>
        <p className="text-sm text-gray-400">Gere seu primeiro anúncio para vê-lo aqui.</p>
      </div>
    );
  }
  return (
    <div className="p-6 md:p-10" style={{ background: BRAND.cream, minHeight: "100%" }}>
      <h2 className="text-xl font-bold mb-5" style={{ color: BRAND.ink, fontFamily: DISPLAY_FONT }}>Meus anúncios</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((it: any) => {
          const styleLabel = TEXT_STYLES.find((s) => s.key === it.style)?.label || it.style;
          const date = it.createdAt ? new Date(it.createdAt).toLocaleDateString("pt-BR") : "";
          const published = it.status === "publicado";
          return (
            <div key={it.id} className="bg-white rounded-2xl p-4 border" style={{ borderColor: "#00000010" }}>
              <p className="text-sm font-semibold line-clamp-2" style={{ color: BRAND.ink }}>{it.product?.title}</p>
              <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                <span>{money(it.product?.price)}</span>
                <span>{date}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-black/5" style={{ color: BRAND.ink }}>{styleLabel}</span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={published ? { background: "#22c55e22", color: "#16a34a" } : { background: "#00000010", color: "#00000066" }}>
                  {published ? "Publicado" : "Rascunho"}
                </span>
              </div>
              <button onClick={() => onOpen(it)} className="w-full mt-3 flex items-center justify-center gap-1 text-xs font-semibold py-2 rounded-lg border" style={{ borderColor: "#00000015", color: BRAND.ink }}>
                Abrir ›
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-2xl p-5 border" style={{ borderColor: "#00000010" }}>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-3xl font-extrabold mt-1" style={{ color: BRAND.ink }}>{value}</p>
    </div>
  );
}

function DashboardScreen({ stats }: { stats: any }) {
  const s = stats || { adsCreated: 0, productsProcessed: 0, artsGenerated: 0, publications: 0 };
  return (
    <div className="p-6 md:p-10" style={{ background: BRAND.cream, minHeight: "100%" }}>
      <h2 className="text-xl font-bold mb-5" style={{ color: BRAND.ink, fontFamily: DISPLAY_FONT }}>Dashboard</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Anúncios criados" value={s.adsCreated} />
        <StatCard label="Produtos processados" value={s.productsProcessed} />
        <StatCard label="Artes geradas" value={s.artsGenerated} />
        <StatCard label="Publicações" value={s.publications} />
      </div>
      <div className="mt-8 p-5 rounded-2xl border border-dashed" style={{ borderColor: "#00000020" }}>
        <p className="text-sm font-semibold" style={{ color: BRAND.ink }}>Em breve (requer integração real)</p>
        <div className="grid sm:grid-cols-4 gap-4 mt-3 text-sm text-gray-400">
          <span>Cliques</span><span>Conversões</span><span>Comissões</span><span>Produtos mais vendidos</span>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   AUTOMAÇÃO DO INSTAGRAM — em alta, fila e ajustes (protegido por senha)
   ========================================================================= */
function readPw(): string { try { return sessionStorage.getItem("adminPw") || ""; } catch (e) { return ""; } }
function savePw(v: string) { try { if (v) sessionStorage.setItem("adminPw", v); else sessionStorage.removeItem("adminPw"); } catch (e) {} }

async function adminFetch(path: string, options: any = {}, raw = false) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "x-admin-password": readPw(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body.error || `Erro ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return raw ? res.blob() : res.json();
}

const STATUS_LABEL: any = {
  pending: { t: "Aguardando aprovação", c: "#b45309", bg: "#fef3c7" },
  approved: { t: "Aprovado — na fila", c: "#1d4ed8", bg: "#dbeafe" },
  publishing: { t: "Publicando…", c: "#6d28d9", bg: "#ede9fe" },
  published: { t: "Publicado ✓", c: "#15803d", bg: "#dcfce7" },
  failed: { t: "Falhou", c: "#b91c1c", bg: "#fee2e2" },
  rejected: { t: "Rejeitado", c: "#4b5563", bg: "#f3f4f6" },
};

function QueuePreview({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; let obj: string | null = null;
    adminFetch(`/queue/${id}/preview`, {}, true).then((b: any) => { if (alive) { obj = URL.createObjectURL(b); setUrl(obj); } }).catch(() => {});
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [id]);
  return url ? <img src={url} alt="Prévia da arte" className="w-full rounded-xl border" /> : <div className="w-full aspect-[4/5] rounded-xl bg-black/5 flex items-center justify-center text-xs text-gray-400">Carregando prévia…</div>;
}

function QueueCard({ item, onChange, busy, setBusy }: any) {
  const [caption, setCaption] = useState(item.caption);
  const [msg, setMsg] = useState("");
  useEffect(() => setCaption(item.caption), [item.caption]);
  const st = STATUS_LABEL[item.status] || STATUS_LABEL.pending;
  const editable = !["publishing", "published"].includes(item.status);
  const run = async (fn: () => Promise<any>, okMsg = "") => {
    setBusy(true); setMsg("");
    try { await fn(); setMsg(okMsg); } catch (e: any) { setMsg(e.message); }
    setBusy(false); onChange();
  };
  const post = (p: string) => adminFetch(p, { method: "POST" });
  return (
    <div className="bg-white rounded-2xl border p-4 grid md:grid-cols-[220px_1fr] gap-4" style={{ borderColor: "#00000010" }}>
      <QueuePreview id={item.id} />
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: st.c, background: st.bg }}>{st.t}</span>
          <span className="text-xs text-gray-400">{item.source === "trending" ? "Automático (em alta)" : "Manual"}</span>
        </div>
        <div className="font-semibold text-sm mb-2" style={{ color: BRAND.ink }}>{item.product.title}</div>
        <textarea value={caption} onChange={(e: any) => setCaption(e.target.value)} disabled={!editable} rows={7}
          className="w-full text-sm border rounded-xl p-2" style={{ borderColor: "#00000020" }} />
        {item.error && <p className="text-xs mt-1" style={{ color: "#b91c1c" }}>⚠ {item.error}</p>}
        {item.permalink && <a href={item.permalink} target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: BRAND.primary }}>Ver no Instagram</a>}
        {msg && <p className="text-xs mt-1 text-gray-600">{msg}</p>}
        <div className="flex gap-2 flex-wrap mt-3">
          {editable && caption !== item.caption && (
            <button disabled={busy} className="px-3 py-1.5 rounded-lg text-sm border" onClick={() => run(() => adminFetch(`/queue/${item.id}`, { method: "PATCH", body: JSON.stringify({ caption }) }), "Legenda salva.")}>Salvar legenda</button>
          )}
          {["pending", "rejected", "failed"].includes(item.status) && (
            <button disabled={busy} className="px-3 py-1.5 rounded-lg text-sm text-white" style={{ background: BRAND.primary }} onClick={() => run(() => post(`/queue/${item.id}/approve`), "Aprovado.")}>Aprovar</button>
          )}
          {["approved", "failed", "pending"].includes(item.status) && (
            <button disabled={busy} className="px-3 py-1.5 rounded-lg text-sm border" onClick={() => { if (confirm("Publicar este post no Instagram agora?")) run(() => post(`/queue/${item.id}/publish`), "Publicado!"); }}>Publicar agora</button>
          )}
          {["pending", "approved", "failed"].includes(item.status) && (
            <button disabled={busy} className="px-3 py-1.5 rounded-lg text-sm border" onClick={() => run(() => post(`/queue/${item.id}/reject`), "Rejeitado.")}>Rejeitar</button>
          )}
        </div>
      </div>
    </div>
  );
}

function TrendingTab({ onQueued }: any) {
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [done, setDone] = useState<any>({});
  const load = async () => {
    setLoading(true); setErr("");
    try { setItems((await adminFetch("/trending?limit=20")).items); } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };
  const send = async (p: any) => {
    setSending(p.id); setErr("");
    try { await adminFetch("/queue", { method: "POST", body: JSON.stringify({ url: p.url }) }); setDone((d: any) => ({ ...d, [p.id]: true })); onQueued(); }
    catch (e: any) { setErr(e.message); }
    setSending(null);
  };
  return (
    <div>
      <button onClick={load} disabled={loading} className="px-4 py-2 rounded-xl text-white text-sm font-semibold" style={{ background: BRAND.primary }}>
        {loading ? "Buscando…" : items ? "Atualizar lista" : "Buscar produtos em alta"}
      </button>
      {err && <p className="text-sm mt-3" style={{ color: "#b91c1c" }}>⚠ {err}</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
        {(items || []).map((p: any) => (
          <div key={p.id} className="bg-white rounded-2xl border p-3 flex gap-3" style={{ borderColor: "#00000010" }}>
            {p.images && p.images[0] && <img src={p.images[0]} alt="" className="w-20 h-20 rounded-lg object-cover bg-black/5" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold line-clamp-2" style={{ color: BRAND.ink }}>{p.title}</div>
              <div className="text-sm font-bold" style={{ color: BRAND.primary }}>{money(p.price)}</div>
              <div className="text-xs text-gray-500">{p.sales != null ? `${p.sales} vendas` : ""} {p.commissionRate != null ? `· comissão ${(p.commissionRate * 100).toFixed(0)}%` : ""}</div>
              <button disabled={sending === p.id || done[p.id]} onClick={() => send(p)} className="mt-1 px-3 py-1 rounded-lg text-xs border">
                {done[p.id] ? "Na fila ✓" : sending === p.id ? "Preparando…" : "Enviar para a fila"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {items && items.length === 0 && <p className="text-sm text-gray-500 mt-4">Nenhum produto retornado.</p>}
    </div>
  );
}

function SettingsTab({ status, reload }: any) {
  const [s, setS] = useState<any>(status.settings);
  const [msg, setMsg] = useState("");
  const set = (k: string, v: any) => setS((o: any) => ({ ...o, [k]: v }));
  const num = (k: string, label: string, help: string) => (
    <label className="block text-sm"><span className="font-semibold" style={{ color: BRAND.ink }}>{label}</span>
      <input type="number" value={s[k]} onChange={(e: any) => set(k, Number(e.target.value))} className="block border rounded-lg p-2 mt-1 w-28" style={{ borderColor: "#00000020" }} />
      <span className="text-xs text-gray-500">{help}</span></label>
  );
  const save = async () => {
    setMsg("");
    try { await adminFetch("/automation/settings", { method: "PUT", body: JSON.stringify(s) }); setMsg("Salvo."); reload(); } catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="bg-white rounded-2xl border p-5 grid gap-4 max-w-xl" style={{ borderColor: "#00000010" }}>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={s.mode === "auto"} onChange={(e: any) => set("mode", e.target.checked ? "auto" : "approval")} className="mt-1" />
        <span><b>Publicar sem pedir aprovação</b><br /><span className="text-xs text-gray-500">Desligado (recomendado): só sai o que você aprovar.</span></span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={s.autoFill} onChange={(e: any) => set("autoFill", e.target.checked)} className="mt-1" />
        <span><b>Buscar produtos em alta sozinho</b><br /><span className="text-xs text-gray-500">Mantém a fila abastecida usando a lista de mais vendidos.</span></span>
      </label>
      {num("maxPostsPerDay", "Máximo de posts em 24h", `Teto de segurança: 25. A Meta permite bem mais, mas postar demais prejudica o alcance.`)}
      {num("minHoursBetweenPosts", "Horas entre um post e outro", "Evita postar tudo de uma vez.")}
      {num("windowStartHour", "Postar a partir das (hora)", `Fuso: ${s.timeZone}`)}
      {num("windowEndHour", "Postar até as (hora)", "Depois disso espera o dia seguinte.")}
      {num("queueTarget", "Itens na fila (automático)", "Quantos itens esperando antes de buscar novos.")}
      {num("dedupeDays", "Não repetir produto por (dias)", "")}
      <div className="flex items-center gap-3"><button onClick={save} className="px-4 py-2 rounded-xl text-white text-sm font-semibold" style={{ background: BRAND.primary }}>Salvar ajustes</button><span className="text-sm text-gray-600">{msg}</span></div>
      <p className="text-xs text-gray-500">No plano grátis do Render, ajustes salvos aqui voltam ao padrão quando o servidor reinicia. Para fixar, use as variáveis de ambiente (veja o README).</p>
    </div>
  );
}

function AutomationScreen() {
  const [pw, setPw] = useState(readPw());
  const [input, setInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authErr, setAuthErr] = useState("");
  const [tab, setTab] = useState("queue");
  const [status, setStatus] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tickMsg, setTickMsg] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const reload = async () => {
    try {
      const [st, q] = await Promise.all([adminFetch("/automation/status"), adminFetch("/queue")]);
      setStatus(st); setQueue(q.items); setAuthed(true); setErr("");
    } catch (e: any) {
      if (e.status === 401 || e.status === 503) { setAuthed(false); setAuthErr(e.message); savePw(""); } else setErr(e.message);
    }
  };
  useEffect(() => { if (pw) reload(); }, []);
  const login = () => { savePw(input); setPw(input); setAuthErr(""); setTimeout(reload, 0); };

  if (!authed) {
    return (
      <div className="p-6 md:p-10 max-w-md" style={{ background: BRAND.cream }}>
        <h2 className="text-xl font-bold mb-2" style={{ color: BRAND.ink, fontFamily: DISPLAY_FONT }}>Automação do Instagram</h2>
        <p className="text-sm text-gray-600 mb-3">Área protegida. Digite a senha definida em ADMIN_PASSWORD no Render.</p>
        <input type="password" value={input} onChange={(e: any) => setInput(e.target.value)} onKeyDown={(e: any) => e.key === "Enter" && login()} placeholder="Senha" className="border rounded-xl p-2 w-full" style={{ borderColor: "#00000020" }} />
        <button onClick={login} className="mt-3 px-4 py-2 rounded-xl text-white text-sm font-semibold" style={{ background: BRAND.primary }}>Entrar</button>
        {authErr && <p className="text-sm mt-3" style={{ color: "#b91c1c" }}>{authErr}</p>}
      </div>
    );
  }

  const ig = status?.instagram;
  const addUrl = async () => {
    setBusy(true); setErr("");
    try { await adminFetch("/queue", { method: "POST", body: JSON.stringify({ url: newUrl }) }); setNewUrl(""); await reload(); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const tickNow = async () => {
    setBusy(true); setTickMsg("");
    try { const r = await adminFetch("/automation/tick", { method: "POST" }); setTickMsg(r.actions.join(" • ")); } catch (e: any) { setTickMsg(e.message); }
    setBusy(false); reload();
  };
  const tabs = [{ k: "queue", l: "Fila" }, { k: "trending", l: "Em alta" }, { k: "settings", l: "Ajustes" }];
  return (
    <div className="p-6 md:p-10" style={{ background: BRAND.cream, minHeight: "100%" }}>
      <h2 className="text-xl font-bold mb-4" style={{ color: BRAND.ink, fontFamily: DISPLAY_FONT }}>Automação do Instagram</h2>
      {status && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5 text-sm">
          <div className="bg-white rounded-2xl border p-3" style={{ borderColor: "#00000010" }}>
            <div className="text-xs text-gray-500">Instagram</div>
            <div className="font-semibold">{!ig.configured ? "Não configurado" : ig.error ? "Erro de conexão" : `@${ig.username || "?"}`}</div>
            {ig.error && <div className="text-xs" style={{ color: "#b91c1c" }}>{ig.error}</div>}
            {ig.quota && ig.quota.total != null && <div className="text-xs text-gray-500">Cota da Meta: {ig.quota.used}/{ig.quota.total} em 24h</div>}
          </div>
          <div className="bg-white rounded-2xl border p-3" style={{ borderColor: "#00000010" }}>
            <div className="text-xs text-gray-500">Posts nas últimas 24h</div>
            <div className="font-semibold">{status.publishedLast24h} de {status.settings.maxPostsPerDay} permitidos</div>
          </div>
          <div className="bg-white rounded-2xl border p-3" style={{ borderColor: "#00000010" }}>
            <div className="text-xs text-gray-500">Pode postar agora?</div>
            <div className="font-semibold">{status.canPublishNow ? "Sim" : "Não"}</div>
            {!status.canPublishNow && <div className="text-xs text-gray-500">{status.blockedReason}{status.nextEligibleAt ? ` Próximo: ${new Date(status.nextEligibleAt).toLocaleString("pt-BR")}` : ""}</div>}
          </div>
          <div className="bg-white rounded-2xl border p-3" style={{ borderColor: "#00000010" }}>
            <div className="text-xs text-gray-500">Modo</div>
            <div className="font-semibold">{status.settings.mode === "auto" ? "Automático total" : "Com aprovação"}{status.settings.autoFill ? " + busca sozinho" : ""}</div>
          </div>
        </div>
      )}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className="px-4 py-1.5 rounded-full text-sm font-medium"
            style={tab === t.k ? { background: BRAND.ink, color: "#fff" } : { background: "#00000008", color: BRAND.ink }}>{t.l}</button>
        ))}
        <button onClick={tickNow} disabled={busy} className="ml-auto px-3 py-1.5 rounded-lg text-sm border">Rodar agora (publica o próximo aprovado, se as regras permitirem)</button>
      </div>
      {tickMsg && <p className="text-sm mb-3 text-gray-700">{tickMsg}</p>}
      {err && <p className="text-sm mb-3" style={{ color: "#b91c1c" }}>⚠ {err}</p>}

      {tab === "queue" && (
        <div>
          <div className="flex gap-2 mb-4">
            <input value={newUrl} onChange={(e: any) => setNewUrl(e.target.value)} placeholder="Colar link de um produto da Shopee para a fila" className="flex-1 border rounded-xl p-2 text-sm" style={{ borderColor: "#00000020" }} />
            <button onClick={addUrl} disabled={busy || !newUrl} className="px-4 py-2 rounded-xl text-white text-sm font-semibold" style={{ background: BRAND.primary }}>{busy ? "…" : "Adicionar"}</button>
          </div>
          <div className="grid gap-4">
            {queue.length === 0 && <p className="text-sm text-gray-500">A fila está vazia. Use “Em alta” ou cole um link acima.</p>}
            {queue.map((it: any) => <QueueCard key={it.id} item={it} onChange={reload} busy={busy} setBusy={setBusy} />)}
          </div>
        </div>
      )}
      {tab === "trending" && <TrendingTab onQueued={reload} />}
      {tab === "settings" && status && <SettingsTab status={status} reload={reload} />}
    </div>
  );
}

function ShopeeAdsAI() {
  const [screen, setScreen] = useState("home");
  const [online, setOnline] = useState<boolean | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [loadStep, setLoadStep] = useState(0);
  const [product, setProduct] = useState<any>(null);
  const [adId, setAdId] = useState<string | null>(null);
  const [style, setStyle] = useState("oferta");
  const [template, setTemplate] = useState("OFERTA");
  const [format, setFormat] = useState("quadrado");
  const [copy, setCopy] = useState<any>(null);
  const [activeCaptionKey, setActiveCaptionKey] = useState("whatsapp");
  const [text, setText] = useState("");
  const [affLink, setAffLink] = useState("");
  const [isAffiliate, setIsAffiliate] = useState(false);
  const [affiliateWarning, setAffiliateWarning] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [showPublish, setShowPublish] = useState(false);
  const [platforms, setPlatforms] = useState<any[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);

  const [manualPhotoInput, setManualPhotoInput] = useState("");
  const [manualPhoto, setManualPhoto] = useState<string | null>(null);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [artBlob, setArtBlob] = useState<Blob | null>(null);
  const [artLoading, setArtLoading] = useState(false);
  const [artError, setArtError] = useState<string | null>(null);

  const checkHealth = useCallback(() => {
    api.health().then(() => setOnline(true)).catch(() => setOnline(false));
  }, []);
  useEffect(() => { checkHealth(); }, [checkHealth]);

  useEffect(() => {
    if (screen === "history") api.listAds().then(setHistory).catch(() => {});
    if (screen === "dashboard") api.dashboard().then(setStats).catch(() => {});
  }, [screen]);

  useEffect(() => {
    if (showPublish) api.platforms().then(setPlatforms).catch(() => setPlatforms([]));
  }, [showPublish]);

  /** Chama o backend pra gerar a arte final (PNG real, foto já embutida) sempre que produto/template/formato/foto manual mudarem. */
  const regenerateArt = useCallback(async (p: any, tmpl: string, fmt: string, manual: string | null) => {
    if (!p) return;
    setArtLoading(true);
    setArtError(null);
    try {
      const { blob } = await apiGenerateArt(p, tmpl, fmt, manual);
      setArtBlob((prev) => { if (artUrl) URL.revokeObjectURL(artUrl); return blob; });
      setArtUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      setArtError(err.message || "Erro ao gerar a arte.");
    } finally {
      setArtLoading(false);
    }
  }, [artUrl]);

  useEffect(() => {
    if (screen === "result" && product) {
      regenerateArt(product, template, format, manualPhoto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, format, manualPhoto, product?.id, screen]);

  const runGeneration = useCallback(async (rawLink: string) => {
    setScreen("loading");
    setLoadStep(0);
    try {
      setLoadStep(1);
      const data = await api.generate(rawLink, style);
      setLoadStep(2);
      setProduct(data.product);
      setCopy(data.copy);
      setText(data.copy?.whatsapp || data.text || "");
      setActiveCaptionKey("whatsapp");
      setAffLink(data.affiliateLink);
      setIsAffiliate(Boolean(data.isAffiliate));
      setAffiliateWarning(data.affiliateWarning || null);
      setAdId(null);
      setManualPhoto(null);
      setManualPhotoInput("");
      setLoadStep(3);
      // a arte é gerada pelo useEffect acima assim que a tela "result" montar com o produto
      setLoadStep(4);
      setTimeout(() => setScreen("result"), 200);
    } catch (err: any) {
      setError(err.message || "Erro ao gerar o anúncio. Tente novamente.");
      setScreen("home");
    }
  }, [style]);

  const onGenerate = () => {
    if (!link.trim()) {
      setError("Insira um link válido de produto da Shopee.");
      return;
    }
    setError("");
    runGeneration(link);
  };

  const onRegenText = async () => {
    try {
      const { copy: newCopy } = await api.regenerateText(product, style);
      setCopy(newCopy);
      setText((newCopy as any)[activeCaptionKey] || newCopy.whatsapp);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const changeStyle = async (key: string) => {
    setStyle(key);
    try {
      const { copy: newCopy } = await api.regenerateText(product, key);
      setCopy(newCopy);
      setText((newCopy as any)[activeCaptionKey] || newCopy.whatsapp);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const changeActiveCaption = (key: string) => {
    setActiveCaptionKey(key);
    if (copy) setText((copy as any)[key] ?? copy.whatsapp);
  };

  const onCopyCaption = async (field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {}
  };

  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(affLink);
      setCopiedField("link");
      setTimeout(() => setCopiedField(null), 1500);
    } catch {}
  };

  const onApplyManualPhotoUrl = () => {
    if (manualPhotoInput.trim()) setManualPhoto(manualPhotoInput.trim());
  };

  const onPickPhoto = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setManualPhoto(reader.result as string);
    reader.readAsDataURL(file);
  };

  const onDownload = () => {
    if (!artBlob || !product) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(artBlob);
    a.download = `anuncio-${product.id}-${format}.png`;
    a.click();
  };

  /**
   * Compartilha a arte JÁ GERADA (o PNG real, com a foto embutida) + a legenda
   * juntos, usando o menu de compartilhar nativo do aparelho (Web Share API).
   * É o único jeito confiável de entregar imagem + texto já prontos para o
   * WhatsApp/Instagram — não existe link (wa.me, instagram.com/...) que
   * anexe uma imagem automaticamente; por isso, no celular, isso abre o
   * menu "Compartilhar" do sistema com a arte e a legenda prontas, e a
   * pessoa só toca no ícone do WhatsApp ou do Instagram na lista. No
   * computador (onde essa API não existe para arquivos), a imagem é
   * baixada e a legenda copiada automaticamente, para anexar manualmente.
   */
  const shareNative = async (captionText: string) => {
    if (!artBlob || !product) return "Imagem ainda não está pronta.";
    const file = new File([artBlob], `anuncio-${product.id}.png`, { type: "image/png" });
    if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
      await (navigator as any).share({ files: [file], text: captionText });
      return "Compartilhado!";
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    try { await navigator.clipboard.writeText(captionText); } catch {}
    return "Esse navegador não deixa anexar a imagem automaticamente: ela foi baixada e a legenda foi copiada — é só anexar a imagem na conversa e colar a legenda.";
  };

  const onShareWhatsApp = async () => {
    const msg = await shareNative((text || "") + "\n" + affLink);
    setSaveMsg(msg as string);
    setTimeout(() => setSaveMsg(""), 5000);
  };

  const onShareInstagram = async () => {
    const msg = await shareNative(text || "");
    setSaveMsg(msg as string);
    setTimeout(() => setSaveMsg(""), 5000);
  };

  const ensureSavedAd = async () => {
    const adPayload = { productId: product.id, style, template, format, text, copy, affiliateLink: affLink, isAffiliate };
    if (adId) {
      await api.updateAd(adId, adPayload);
      return adId;
    }
    const ad = await api.saveAd(adPayload);
    setAdId(ad.id);
    return ad.id;
  };

  const onPublish = () => setShowPublish(true);

  const onSelectPlatform = async (platformKey: string) => {
    setPublishing(true);
    try {
      const id = await ensureSavedAd();
      const { shareUrl } = await api.publish(id, platformKey);
      if (platformKey === "instagram") {
        const msg = await shareNative(text || "");
        setSaveMsg(msg as string);
      } else if (platformKey === "whatsapp") {
        const msg = await shareNative((text || "") + "\n" + affLink);
        setSaveMsg(msg as string);
      } else {
        if (shareUrl) window.open(shareUrl, "_blank");
        setSaveMsg("Anúncio publicado e salvo em Meus anúncios.");
      }
      setShowPublish(false);
    } catch (err: any) {
      setSaveMsg(err.message);
    } finally {
      setPublishing(false);
      setTimeout(() => setSaveMsg(""), 4000);
    }
  };

  const openFromHistory = (item: any) => {
    setProduct(item.product);
    setCopy(item.copy || { whatsapp: item.text, instagram: item.text, alternative: item.text, source: "mock" });
    setText(item.text);
    setActiveCaptionKey("whatsapp");
    setTemplate(item.template || "OFERTA");
    setFormat(item.format || "quadrado");
    setStyle(item.style || "oferta");
    setAffLink(item.affiliateLink || "");
    setIsAffiliate(Boolean(item.isAffiliate));
    setAffiliateWarning(null);
    setAdId(item.id);
    setManualPhoto(null);
    setManualPhotoInput("");
    setScreen("result");
  };

  const goHome = async () => {
    if (product && !adId) {
      api.saveAd({ productId: product.id, style, template, format, text, copy, affiliateLink: affLink, isAffiliate }).then((ad) => setAdId(ad.id)).catch(() => {});
    } else if (product && adId) {
      api.updateAd(adId, { style, template, format, text, copy, affiliateLink: affLink, isAffiliate }).catch(() => {});
    }
    setLink("");
    setError("");
    setScreen("home");
  };

  const handleNav = (s: string) => { if (s === "home" && screen === "result") goHome(); else setScreen(s); };

  return (
    <div className="w-full min-h-screen" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <NavBar screen={screen} setScreen={handleNav} />
      <ConnectionBanner online={online} onRetry={checkHealth} />
      {screen === "home" && <HomeScreen link={link} setLink={setLink} onGenerate={onGenerate} error={error} />}
      {screen === "loading" && <LoadingScreen step={loadStep} />}
      {screen === "result" && product && (
        <ResultScreen
          product={product}
          onUpdateProduct={(fields: any) => setProduct((p: any) => ({ ...p, ...fields }))}
          copy={copy}
          activeCaptionKey={activeCaptionKey}
          setActiveCaptionKey={changeActiveCaption}
          text={text}
          setText={setText}
          style={style}
          setStyle={changeStyle}
          template={template}
          setTemplate={setTemplate}
          format={format}
          setFormat={setFormat}
          onRegenText={onRegenText}
          artUrl={artUrl}
          artLoading={artLoading}
          artError={artError}
          onDownload={onDownload}
          onCopyCaption={onCopyCaption}
          copiedField={copiedField}
          onCopyLink={onCopyLink}
          onShareWhatsApp={onShareWhatsApp}
          onShareInstagram={onShareInstagram}
          onPublish={onPublish}
          affLink={affLink}
          isAffiliate={isAffiliate}
          affiliateWarning={affiliateWarning}
          saveMsg={saveMsg}
          manualPhotoInput={manualPhotoInput}
          setManualPhotoInput={setManualPhotoInput}
          onApplyManualPhotoUrl={onApplyManualPhotoUrl}
          onPickPhoto={onPickPhoto}
        />
      )}
      {screen === "history" && <HistoryScreen items={history} onOpen={openFromHistory} />}
      {screen === "dashboard" && <DashboardScreen stats={stats} />}
      {screen === "automation" && <AutomationScreen />}
      {showPublish && <PublishModal onClose={() => setShowPublish(false)} platforms={platforms} onSelect={onSelectPlatform} publishing={publishing} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<ShopeeAdsAI />);
