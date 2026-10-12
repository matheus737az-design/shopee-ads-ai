/**
 * publishRules — regras de quantidade/horário, funções puras (fáceis de testar).
 *
 * Um post só pode sair se TODAS estas condições forem verdadeiras:
 *  1. Estamos dentro da janela de horário permitida (fuso configurado).
 *  2. Publicamos menos que `maxPostsPerDay` nas últimas 24h (janela móvel).
 *  3. Passou o intervalo mínimo desde o último post.
 *  4. (checado fora daqui) a cota real devolvida pela API do Instagram
 *     (`content_publishing_limit`) ainda não está esgotada.
 */

const DAY_MS = 24 * 3600 * 1000;

export function hourInTimeZone(date, timeZone) {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(date);
  return Number(h) % 24;
}

/**
 * @param {{now:Date, settings:object, publishedAt:number[]}} p
 * @returns {{ok:boolean, reason:string|null, nextEligibleAt:Date|null}}
 */
export function checkPublishAllowed({ now, settings, publishedAt }) {
  const nowMs = now.getTime();
  const recent = publishedAt.filter((t) => nowMs - t < DAY_MS).sort((a, b) => a - b);

  // 2. limite por 24h (janela móvel)
  if (recent.length >= settings.maxPostsPerDay) {
    const frees = recent[recent.length - settings.maxPostsPerDay] + DAY_MS;
    return { ok: false, reason: `Limite diário atingido (${recent.length}/${settings.maxPostsPerDay} nas últimas 24h).`, nextEligibleAt: new Date(frees) };
  }

  // 3. intervalo mínimo
  const last = recent.length ? recent[recent.length - 1] : null;
  const minMs = settings.minHoursBetweenPosts * 3600 * 1000;
  if (last != null && nowMs - last < minMs) {
    return { ok: false, reason: `Aguardando o intervalo mínimo de ${settings.minHoursBetweenPosts}h entre posts.`, nextEligibleAt: new Date(last + minMs) };
  }

  // 1. janela de horário
  const hour = hourInTimeZone(now, settings.timeZone);
  const { windowStartHour: start, windowEndHour: end } = settings;
  const inWindow = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  if (!inWindow) {
    return { ok: false, reason: `Fora da janela de horário (${start}h–${end}h, ${settings.timeZone}).`, nextEligibleAt: null };
  }

  return { ok: true, reason: null, nextEligibleAt: null };
}
