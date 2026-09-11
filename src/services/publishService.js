/**
 * publishService
 * WhatsApp, Telegram e Facebook usam links de compartilhamento públicos —
 * funcionam de verdade, sem precisar de API/keys.
 * Instagram e TikTok não têm API pública de publicação configurada ainda:
 * ficam marcados como indisponíveis até termos as credenciais e o fluxo de
 * aprovação de cada plataforma.
 */
export const PLATFORMS = [
  { key: "whatsapp", label: "WhatsApp", ready: true },
  { key: "telegram", label: "Telegram", ready: true },
  { key: "facebook", label: "Facebook", ready: true },
  { key: "instagram", label: "Instagram", ready: false },
  { key: "tiktok", label: "TikTok", ready: false },
];

export function buildShareUrl(platformKey, text, link) {
  switch (platformKey) {
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(text + "\n" + link)}`;
    case "telegram":
      return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`;
    default:
      return null; // plataforma sem integração pronta ainda
  }
}
