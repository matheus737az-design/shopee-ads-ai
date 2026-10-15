import test from "node:test";
import assert from "node:assert/strict";
import { extractLink, extractTitle, productsFromPosts, page } from "../src/routes/linkInBio.js";

const cap = "🔥 OLHA ESSA OFERTA!\nTruss Leave-in Reconstrutor 260ml\n💰 De R$ 119 por R$ 50\n🔗 Link na bio:\nhttps://s.shopee.com.br/5VW3brVE5Y\nCód. 58201637252\n#publi #shopee";

test("extrai o link de afiliado da legenda", () => {
  assert.equal(extractLink(cap), "https://s.shopee.com.br/5VW3brVE5Y");
  assert.equal(extractLink("veja https://www.instagram.com/x e https://s.shopee.com.br/abc."), "https://s.shopee.com.br/abc");
  assert.equal(extractLink("sem link"), null);
});

test("título pula a chamada inicial", () => {
  assert.equal(extractTitle(cap), "Truss Leave-in Reconstrutor 260ml");
});

test("vitrine só mostra posts de produto, com link e imagem", () => {
  const items = productsFromPosts([
    { id: "1", caption: cap, mediaType: "IMAGE", mediaUrl: "https://cdn/x.jpg", timestamp: 1 },
    { id: "4", caption: cap.replace("58201637252", "777777"), mediaType: "VIDEO", mediaUrl: "https://cdn/v.mp4", thumbnailUrl: "https://cdn/t.jpg", timestamp: 4 },
    { id: "2", caption: "Bem-vindo ao perfil!", mediaType: "IMAGE", mediaUrl: "https://cdn/y.jpg", timestamp: 2 },
    { id: "3", caption: "Cód. 123 sem link", mediaType: "IMAGE", mediaUrl: "https://cdn/z.jpg", timestamp: 3 },
  ]);
  assert.deepEqual(items.map((i) => i.id), ["1", "4"]);
  assert.equal(items[1].image, "/achados/img/4?v=2"); // capa servida pelo nosso servidor
});

test("página escapa HTML e marca links como patrocinados", () => {
  const html = page({ items: [{ id: "1", link: "https://s.shopee.com.br/a", title: "<b>x</b>", image: "https://cdn/x.jpg" }] });
  assert.ok(!html.includes("<b>x</b>"));
  assert.match(html, /rel="sponsored noopener"/);
  assert.match(html, /comissão/);
});

import { trendingCards } from "../src/routes/linkInBio.js";

test("mais vendidos: exige link de afiliado e foto, tira os já postados e duplicados", () => {
  const prods = [
    { id: "shopee_1_111111", offerLink: "https://s.shopee.com.br/a", images: ["https://cf/x.jpg"], price: 10, title: "A" },
    { id: "shopee_1_222222", offerLink: "https://s.shopee.com.br/b", images: ["https://cf/y.jpg"], price: 20, title: "B", discountPercentage: 33.4 },
    { id: "shopee_1_222222", offerLink: "https://s.shopee.com.br/b", images: ["https://cf/y.jpg"], price: 20, title: "B dup" },
    { id: "shopee_1_333333", offerLink: null, images: ["https://cf/z.jpg"], price: 30, title: "sem link" },
    { id: "shopee_1_444444", offerLink: "https://s.shopee.com.br/d", images: [], price: 40, title: "sem foto" },
  ];
  const cards = trendingCards(prods, new Set(["111111"]));
  assert.deepEqual(cards.map((c) => c.title), ["B"]);
  assert.equal(cards[0].discount, 33);
});

test("página mostra as duas seções", () => {
  const html = page({
    items: [{ id: "1", link: "https://s.shopee.com.br/a", title: "x", image: "https://cdn/x.jpg" }],
    more: [{ link: "https://s.shopee.com.br/b", image: "https://cf/y.jpg", title: "Prod", price: 19.9, originalPrice: 39.9, discount: 50 }],
  });
  assert.match(html, /Postados no Instagram/);
  assert.match(html, /Mais vendidos agora/);
  assert.match(html, /R\$\s?19,90/);
});
