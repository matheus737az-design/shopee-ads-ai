/**
 * Rate limiter simples, em memória, sem dependências externas.
 * Suficiente para esta escala (uso de uma pessoa/pequeno grupo de afiliados,
 * sem múltiplas instâncias do servidor rodando ao mesmo tempo).
 *
 * Limita por IP + rota, numa janela deslizante simples.
 */
export function makeLimiter({ windowMs, limit, message }) {
  const hits = new Map(); // ip -> [timestamps]

  // limpeza periódica para não acumular memória indefinidamente
  setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of hits) {
      const fresh = timestamps.filter((t) => now - t < windowMs);
      if (fresh.length === 0) hits.delete(ip);
      else hits.set(ip, fresh);
    }
  }, windowMs).unref?.();

  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    const timestamps = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= limit) {
      return res.status(429).json({ error: message });
    }
    timestamps.push(now);
    hits.set(ip, timestamps);
    next();
  };
}

export const generateLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 12,
  message: "Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.",
});

export const artLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  message: "Muitas gerações de arte em pouco tempo. Aguarde um minuto e tente de novo.",
});

export const trendingLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 6,
  message: "Muitas consultas de produtos em alta. Aguarde um minuto.",
});

// Senha errada várias vezes seguidas -> bloqueia o IP por um tempo (anti força-bruta).
export const adminFailLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  message: "Muitas tentativas de senha. Aguarde alguns minutos.",
});
