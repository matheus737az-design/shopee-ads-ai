import { readCollection, writeCollection } from "./jsonStore.js";

export function saveProduct(p) {
  const products = readCollection("products");
  const idx = products.findIndex((x) => x.id === p.id);
  if (idx >= 0) products[idx] = p;
  else products.push(p);
  writeCollection("products", products);
  return p;
}

export function getProductById(id) {
  return readCollection("products").find((p) => p.id === id) || null;
}
