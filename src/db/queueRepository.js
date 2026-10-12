import { nanoid } from "nanoid";
import { readCollection, writeCollection } from "./jsonStore.js";

/**
 * Fila de publicações do Instagram.
 * status: pending (aguardando aprovação) | approved (pronto p/ publicar) |
 *         publishing | published | failed | rejected
 */

const COLLECTION = "queue";

export function listQueue() {
  return readCollection(COLLECTION);
}

export function getQueueItem(id) {
  return readCollection(COLLECTION).find((i) => i.id === id) || null;
}

export function enqueue({ product, copy, caption, affiliateLink, template, status = "pending", source = "manual" }) {
  const items = readCollection(COLLECTION);
  const now = new Date().toISOString();
  const item = {
    id: `q_${nanoid(10)}`,
    productId: product.id,
    product,
    copy: copy || null,
    caption,
    affiliateLink,
    template,
    status,
    source,
    error: null,
    igMediaId: null,
    permalink: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
  items.unshift(item);
  writeCollection(COLLECTION, items);
  return item;
}

export function updateQueueItem(id, fields) {
  const items = readCollection(COLLECTION);
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...fields, updatedAt: new Date().toISOString() };
  writeCollection(COLLECTION, items);
  return items[idx];
}

export function publishedTimestamps() {
  return readCollection(COLLECTION)
    .filter((i) => i.status === "published" && i.publishedAt)
    .map((i) => new Date(i.publishedAt).getTime());
}

/** Publicações registradas localmente: [{ t, mediaId }]. */
export function publishedEntries() {
  return readCollection(COLLECTION)
    .filter((i) => i.status === "published" && i.publishedAt)
    .map((i) => ({ t: new Date(i.publishedAt).getTime(), mediaId: i.igMediaId || null }));
}

/** Produto já foi enfileirado/publicado nos últimos `days` dias? (rejeitados não contam) */
export function wasProductQueuedRecently(productId, days) {
  if (!days) return false;
  const since = Date.now() - days * 24 * 3600 * 1000;
  return readCollection(COLLECTION).some(
    (i) => i.productId === productId && i.status !== "rejected" && new Date(i.createdAt).getTime() >= since
  );
}
