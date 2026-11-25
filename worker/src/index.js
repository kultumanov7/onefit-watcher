// Cloudflare Worker: Telegram-бот, который раз в N минут проверяет слоты 1Fit.
// Секреты (wrangler secret put): TG_TOKEN, ONEFIT_TOKEN. Переменные (wrangler.toml): TG_CHAT_ID, ONEFIT_BASE, ONEFIT_FAKE.

const HELP = `Команды:
/find therma — найти зал и его id
/watch <id> 2026-12-05 [18:00-22:00] — следить
/list — список
/rm N — удалить
/now — проверить сейчас`;

// ---------- 1Fit (единственное, что зависит от их API) ----------
async function oneFit(env, path, params) {
  const url = new URL(env.ONEFIT_BASE + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const r = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${env.ONEFIT_TOKEN}` },
  });
  if (!r.ok) throw new Error(`1Fit ${r.status}`);
  return r.json();
}

async function searchGyms(env, q) {
  if (env.ONEFIT_FAKE === "1") return [{ id: "therma", name: "Therma" }];
  // TODO: реальный эндпоинт из перехваченного запроса
  // const j = await oneFit(env, "/<path>", { search: q });
  // return j.data.map(x => ({ id: String(x.id), name: x.title }));
  throw new Error("searchGyms ещё не подключён к 1Fit");
}

async function fetchSlots(env, gymId, date) {
  // -> [{id, start:'HH:MM', title, free}]
  if (env.ONEFIT_FAKE === "1")
    return Math.random() < 0.3 ? [{ id: `${gymId}-${date}-19`, start: "19:00", title: "Термы", free: 3 }] : [];
  // TODO: реальный эндпоинт из перехваченного запроса
  // const j = await oneFit(env, `/<path>/${gymId}/schedule`, { date });
  // return j.data.map(s => ({ id: String(s.id), start: s.start_time.slice(11, 16), title: s.name, free: s.capacity - s.booked }));
  throw new Error("fetchSlots ещё не подключён к 1Fit");
}

// ---------- Telegram ----------
const send = (env, text) =>
  fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text }),
  });

// ---------- состояние в KV ----------
const load = async (env) => JSON.parse((await env.KV.get("watches")) || "[]");
const save = (env, w) => env.KV.put("watches", JSON.stringify(w));

const inWindow = (start, win) => !win || (start >= win.split("-")[0] && start <= win.split("-")[1]);

async function check(env, verbose = false) {
  const w = await load(env);
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); // Астана UTC+5
  let changed = false;
  for (const x of [...w]) {
    if (x.date < today) { w.splice(w.indexOf(x), 1); changed = true; continue; }
    let slots;
    try { slots = await fetchSlots(env, x.gym_id, x.date); }
    catch (e) { if (verbose) await send(env, `⚠️ ${x.gym_id} ${x.date}: ${e.message}`); continue; }
    const open = slots.filter((s) => s.free > 0 && inWindow(s.start, x.window));
    const fresh = open.filter((s) => !x.seen.includes(s.id));
    if (fresh.length)
      await send(env, `🔥 Открылась запись: ${x.gym_id} на ${x.date}\n` +
        fresh.map((s) => `• ${s.start} ${s.title} — мест: ${s.free}`).join("\n") + "\nБеги в 1Fit!");
    else if (verbose) await send(env, `${x.gym_id} ${x.date}: свободных слотов нет`);
    const ids = open.map((s) => s.id);
    if (JSON.stringify(ids) !== JSON.stringify(x.seen)) { x.seen = ids; changed = true; }
  }
  if (changed) await save(env, w); // пишем в KV только при изменениях — укладываемся в бесплатный лимит
}

async function handle(env, text) {
  const [raw, ...a] = text.trim().split(/\s+/);
  const cmd = raw.split("@")[0].toLowerCase();
  const w = await load(env);
  if (cmd === "/start" || cmd === "/help") return send(env, HELP);
  if (cmd === "/find" && a.length) {
    try { const g = await searchGyms(env, a.join(" ")); return send(env, g.map((x) => `${x.id} — ${x.name}`).join("\n") || "Ничего"); }
    catch (e) { return send(env, `Ошибка: ${e.message}`); }
  }
  if (cmd === "/watch" && a.length >= 2) {
    const [gym_id, date, window = null] = a;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (window && !/^\d\d:\d\d-\d\d:\d\d$/.test(window)))
      return send(env, "Формат: /watch <id> 2026-12-05 [18:00-22:00]");
    w.push({ gym_id, date, window, seen: [] });
    await save(env, w);
    return send(env, `Слежу: ${gym_id} ${date} ${window || "любое время"}`);
  }
  if (cmd === "/list")
    return send(env, w.map((x, i) => `${i + 1}. ${x.gym_id} ${x.date} ${x.window || "любое время"}`).join("\n") || "Пусто");
  if (cmd === "/rm" && +a[0] >= 1 && +a[0] <= w.length) {
    const [x] = w.splice(+a[0] - 1, 1);
    await save(env, w);
    return send(env, `Удалено: ${x.gym_id} ${x.date}`);
  }
  if (cmd === "/now") return check(env, true);
  return send(env, "Не понял. /help");
}

export default {
  // Telegram webhook
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("ok");
    if (req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) return new Response("no", { status: 403 });
    const u = await req.json();
    const m = u.message || {};
    if (String(m.chat?.id) === String(env.TG_CHAT_ID) && m.text?.startsWith("/")) await handle(env, m.text);
    return new Response("ok");
  },
  // cron
  async scheduled(_ev, env, ctx) {
    ctx.waitUntil(check(env));
  },
};
