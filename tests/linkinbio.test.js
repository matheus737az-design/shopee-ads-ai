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
    { id: "2", caption: "Bem-vindo ao perfil!", mediaType: "IMAGE", mediaUrl: "https://cdn/y.jpg", timestamp: 2 },
    { id: "3", caption: "Cód. 123 sem link", mediaType: "IMAGE", mediaUrl: "https://cdn/z.jpg", timestamp: 3 },
  ]);
  assert.deepEqual(items.map((i) => i.id), ["1"]);
});

test("página escapa HTML e marca links como patrocinados", () => {
  const html = page({ items: [{ id: "1", link: "https://s.shopee.com.br/a", title: "<b>x</b>", image: "https://cdn/x.jpg" }] });
  assert.ok(!html.includes("<b>x</b>"));
  assert.match(html, /rel="sponsored noopener"/);
  assert.match(html, /comissão/);
});
