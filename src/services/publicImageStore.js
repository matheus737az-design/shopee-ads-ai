import crypto from "node:crypto";

/**
 * A API do Instagram exige que a imagem esteja numa URL PÚBLICA no momento
 * da publicação (a Meta é quem baixa). Como o Render free não tem disco
 * permanente, guardamos o JPEG só em memória, sob um token aleatório
 * impossível de adivinhar, e ele expira sozinho em alguns minutos.
 */
const TTL_MS = 15 * 60 * 1000;
const store = new Map(); // token -> { buffer, expiresAt }

setInterval(() => {
  const now = Date.now();
  for (const [t, v] of store) if (v.expiresAt < now) store.delete(t);
}, 60 * 1000).unref?.();

export function putPublicImage(buffer, contentType = "image/jpeg") {
  const token = crypto.randomBytes(24).toString("hex");
  store.set(token, { buffer, contentType, expiresAt: Date.now() + TTL_MS });
  return token;
}

/** Igual a getPublicImage, mas devolve também o tipo (image/jpeg ou video/mp4). */
export function getPublicMedia(token) {
  const v = store.get(token);
  if (!v || v.expiresAt < Date.now()) {
    store.delete(token);
    return null;
  }
  return { buffer: v.buffer, contentType: v.contentType || "image/jpeg" };
}

export function getPublicImage(token) {
  const v = store.get(token);
  if (!v || v.expiresAt < Date.now()) {
    store.delete(token);
    return null;
  }
  return v.buffer;
}

export function deletePublicImage(token) {
  store.delete(token);
}
