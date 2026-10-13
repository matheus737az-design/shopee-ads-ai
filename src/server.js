import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import generateRoutes from "./routes/generate.js";
import adsRoutes from "./routes/ads.js";
import dashboardRoutes from "./routes/dashboard.js";
import imageProxyRoutes from "./routes/imageProxy.js";
import automationRoutes, { publicImageRouter } from "./routes/automation.js";
import { startScheduler } from "./services/scheduler.js";
import linkInBioRoutes from "./routes/linkInBio.js";

const app = express();

// Atrás do proxy do Render: necessário para req.ip/req.protocol corretos.
app.set("trust proxy", 1);

// Permite que uma página aberta em outro domínio (ex: claude.ai) chame esta
// API rodando em localhost — necessário por causa do "Private Network Access"
// do Chrome, além do CORS normal.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Private-Network", "true");
  next();
});

// CORS: por padrão libera qualquer origem (o site é servido same-origin em
// produção, então isso raramente importa de verdade). Se algum dia este
// backend precisar atender um frontend em outro domínio específico, defina
// ALLOWED_ORIGIN=https://seusite.com no .env para restringir.
const allowedOrigin = process.env.ALLOWED_ORIGIN || true;
app.use(cors({ origin: allowedOrigin }));

// Limite de corpo JSON: 12MB cobre o upload manual de foto em base64 (até
// 8MB de imagem ~ 11MB em base64) sem deixar o servidor aberto a payloads
// absurdamente grandes.
app.use(express.json({ limit: "12mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/generate", generateRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/image-proxy", imageProxyRoutes);
app.use("/api/public-image", publicImageRouter);
app.use("/api", automationRoutes);

// Vitrine pública para o link da bio do Instagram
app.use("/achados", linkInBioRoutes);

// Frontend estático — abra http://localhost:3333 no navegador para usar o app
app.use(express.static(path.join(__dirname, "..", "public")));

// 404 para rotas de API desconhecidas (evita cair no fallback de arquivo estático)
app.use("/api", (req, res) => res.status(404).json({ error: "Rota não encontrada." }));

// Tratador de erro global — garante que qualquer erro não tratado explicitamente
// nas rotas ainda vira uma resposta JSON previsível, sem vazar stack trace nem
// chaves/variáveis de ambiente para o cliente.
app.use((err, req, res, next) => {
  console.error("[erro não tratado]", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Erro interno no servidor. Tente novamente." });
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`Shopee Ads AI rodando em http://localhost:${PORT}`);
  startScheduler();
});
