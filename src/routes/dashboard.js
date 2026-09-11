import { Router } from "express";
import { getDashboardStats } from "../db/adRepository.js";

const router = Router();

/** GET /api/dashboard — números reais do que já foi feito (nada inventado) */
router.get("/", (req, res) => {
  res.json(getDashboardStats());
});

export default router;
