import test from "node:test";
import assert from "node:assert/strict";
import { requireAdmin, requireCronOrAdmin } from "../src/middleware/adminAuth.js";

const run = (mw, headers = {}) => {
  let out = { next: false, status: null };
  const req = { ip: "1.2.3." + Math.floor(Math.random() * 250), get: (h) => headers[h.toLowerCase()] };
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  mw(req, res, () => (out.next = true));
  return out;
};

test("sem ADMIN_PASSWORD o painel fica desligado (503)", () => {
  delete process.env.ADMIN_PASSWORD;
  assert.equal(run(requireAdmin, { "x-admin-password": "x" }).status, 503);
});
test("senha certa passa, errada/vazia é 401", () => {
  process.env.ADMIN_PASSWORD = "segredo";
  assert.equal(run(requireAdmin, { "x-admin-password": "segredo" }).next, true);
  assert.equal(run(requireAdmin, { "x-admin-password": "errada" }).status, 401);
  assert.equal(run(requireAdmin, {}).status, 401);
});
test("tick aceita CRON_SECRET, rejeita segredo errado", () => {
  process.env.ADMIN_PASSWORD = "segredo"; process.env.CRON_SECRET = "cron123";
  assert.equal(run(requireCronOrAdmin, { "x-cron-secret": "cron123" }).next, true);
  assert.equal(run(requireCronOrAdmin, { "x-cron-secret": "nope" }).status, 401);
});
