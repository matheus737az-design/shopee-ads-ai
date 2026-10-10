import dns from "node:dns";

/**
 * ssrfGuard
 *
 * Proteção contra SSRF (Server-Side Request Forgery) para qualquer busca de
 * URL informada pelo usuário (foto do produto, link colado, etc).
 *
 * Sem isso, alguém poderia colar "http://169.254.169.254/latest/meta-data"
 * (metadados da nuvem) ou "http://localhost:3333/..." no campo de imagem e
 * fazer o nosso próprio servidor atacar a si mesmo ou a rede interna.
 *
 * Regras:
 *  - Só http/https.
 *  - Resolve o hostname e bloqueia qualquer IP privado/loopback/link-local/
 *    reservado (IPv4 e IPv6), incluindo o caso de um domínio público
 *    resolver para um IP interno ("DNS rebinding").
 *  - Usado tanto antes do fetch inicial quanto em cada redirecionamento
 *    (ver fetchImageSafely em imageService.js), porque o primeiro hop pode
 *    ser público e o redirect apontar para dentro da rede.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

export function isValidHttpUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function ipv4ToLong(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inRange(longIp, base, maskBits) {
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (longIp & mask) === (ipv4ToLong(base) & mask);
}

const PRIVATE_V4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (inclui metadata.*.internal de clouds)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservado
];

function isPrivateIpv4(ip) {
  const long = ipv4ToLong(ip);
  if (long == null) return true; // formato inválido -> trata como não confiável
  return PRIVATE_V4_RANGES.some(([base, bits]) => inRange(long, base, bits));
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true; // link-local / ULA
  // IPv4 mapeado em IPv6 (::ffff:a.b.c.d) -> valida como IPv4
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

export function isPrivateIp(ip) {
  return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

/**
 * Resolve o hostname e garante que NENHUM dos IPs retornados é privado.
 * Lança erro se o domínio for inválido, bloqueado ou resolver para dentro
 * da rede interna.
 */
export async function assertPublicHostname(hostname) {
  const clean = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(clean) || clean.endsWith(".internal") || clean.endsWith(".local")) {
    throw new Error("Domínio não permitido.");
  }

  let records;
  try {
    records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Não foi possível resolver esse domínio.");
  }
  if (!records.length) throw new Error("Não foi possível resolver esse domínio.");
  for (const rec of records) {
    if (isPrivateIp(rec.address)) {
      throw new Error("Esse endereço aponta para uma rede interna/privada e não é permitido.");
    }
  }
}

/** Valida protocolo + resolve/valida o host. Lança erro descritivo em pt-BR se algo for suspeito. */
export async function assertSafeUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL inválida.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Apenas links http/https são permitidos.");
  }
  await assertPublicHostname(parsed.hostname);
  return parsed;
}
