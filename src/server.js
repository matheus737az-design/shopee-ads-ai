import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import generateRoutes from "./routes/generate.js";
import adsRoutes from "./routes/ads.js";
import dashboardRoutes from "./routes/dashboard.js";

const app = express();

// Permite que uma página aberta em outro domínio (ex: claude.ai) chame esta
// API rodando em localhost — necessário por causa do "Private Network Access"
// do Chrome, além do CORS normal.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Private-Network", "true");
  next();
});
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/generate", generateRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Frontend estático — abra http://localhost:3333 no navegador para usar o app
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`Shopee Ads AI rodando em http://localhost:${PORT}`);
});
