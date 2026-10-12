import test from "node:test";
import assert from "node:assert/strict";
import { checkPublishAllowed } from "../src/services/publishRules.js";

const S = { maxPostsPerDay: 3, minHoursBetweenPosts: 4, windowStartHour: 8, windowEndHour: 22, timeZone: "America/Sao_Paulo" };
const at = (iso) => new Date(iso); // 15:00Z = 12:00 em São Paulo (UTC-3)
const H = 3600 * 1000;

test("permite dentro da janela, sem posts anteriores", () => {
  assert.equal(checkPublishAllowed({ now: at("2026-01-10T15:00:00Z"), settings: S, publishedAt: [] }).ok, true);
});
test("bloqueia fora da janela (03:00 em SP)", () => {
  const r = checkPublishAllowed({ now: at("2026-01-10T06:00:00Z"), settings: S, publishedAt: [] });
  assert.equal(r.ok, false); assert.match(r.reason, /janela/);
});
test("bloqueia no intervalo mínimo", () => {
  const now = at("2026-01-10T15:00:00Z");
  const r = checkPublishAllowed({ now, settings: S, publishedAt: [now.getTime() - 2 * H] });
  assert.equal(r.ok, false); assert.match(r.reason, /intervalo/);
  assert.equal(r.nextEligibleAt.getTime(), now.getTime() + 2 * H);
});
test("bloqueia ao atingir o limite diário (janela móvel de 24h)", () => {
  const now = at("2026-01-10T20:00:00Z");
  const r = checkPublishAllowed({ now, settings: S, publishedAt: [now - 20 * H, now - 12 * H, now - 5 * H] });
  assert.equal(r.ok, false); assert.match(r.reason, /Limite diário/);
  assert.equal(r.nextEligibleAt.getTime(), now - 20 * H + 24 * H);
});
test("posts com mais de 24h não contam", () => {
  const now = at("2026-01-10T15:00:00Z");
  assert.equal(checkPublishAllowed({ now, settings: S, publishedAt: [now - 30 * H, now - 26 * H, now - 25 * H] }).ok, true);
});
test("janela que cruza a meia-noite", () => {
  const s = { ...S, windowStartHour: 20, windowEndHour: 2 };
  assert.equal(checkPublishAllowed({ now: at("2026-01-11T01:00:00Z"), settings: s, publishedAt: [] }).ok, true); // 22h SP
  assert.equal(checkPublishAllowed({ now: at("2026-01-10T15:00:00Z"), settings: s, publishedAt: [] }).ok, false);
});
