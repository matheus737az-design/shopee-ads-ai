import { nanoid } from "nanoid";
import { readCollection, writeCollection } from "./jsonStore.js";
import { getProductById } from "./productRepository.js";

export function createAd({ productId, style, template, text, affiliateLink }) {
  const ads = readCollection("ads");
  const now = new Date().toISOString();
  const ad = {
    id: `ad_${nanoid(10)}`,
    productId,
    style,
    template,
    text,
    affiliateLink,
    status: "rascunho",
    createdAt: now,
    updatedAt: now,
  };
  ads.unshift(ad);
  writeCollection("ads", ads);
  return hydrateAd(ad);
}

export function updateAd(id, fields) {
  const ads = readCollection("ads");
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  ads[idx] = { ...ads[idx], ...fields, updatedAt: new Date().toISOString() };
  writeCollection("ads", ads);
  return hydrateAd(ads[idx]);
}

export function listAds() {
  return readCollection("ads").map(hydrateAd);
}

export function getAdById(id) {
  const ad = readCollection("ads").find((a) => a.id === id);
  return ad ? hydrateAd(ad) : null;
}

export function registerPublication(adId, platform) {
  const pubs = readCollection("publications");
  const pub = { id: `pub_${nanoid(10)}`, adId, platform, createdAt: new Date().toISOString() };
  pubs.push(pub);
  writeCollection("publications", pubs);
  updateAd(adId, { status: "publicado" });
  return pub;
}

export function getDashboardStats() {
  const ads = readCollection("ads");
  const pubs = readCollection("publications");
  return {
    adsCreated: ads.length,
    productsProcessed: new Set(ads.map((a) => a.productId)).size,
    artsGenerated: ads.length,
    publications: pubs.length,
  };
}

function hydrateAd(ad) {
  return { ...ad, product: getProductById(ad.productId) };
}
