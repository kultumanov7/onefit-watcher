// Cloudflare Worker: Telegram-бот, который раз в N минут проверяет слоты 1Fit.
// Секреты (wrangler secret put): TG_TOKEN, ONEFIT_TOKEN. Переменные (wrangler.toml): TG_CHAT_ID, ONEFIT_BASE, ONEFIT_FAKE.

import GYMS from "./gyms.js";

const HELP = `Привет! Я слежу за слотами в 1Fit и пишу, когда открывается запись.

Просто напиши в одну строку через запятую:
  Therma, пятница
  Therma, завтра, 18-22
  Therma, 5 декабря

Зал — название как в 1Fit (можно часть). День — сегодня / завтра / день недели / дата. Время — по желанию.

/list — за чем слежу
/stop 1 — выключить слежку №1 (/stop — выключить все)
/now — проверить прямо сейчас`;

// ---------- разбор "Therma, пятница, 18-22" ----------
const WEEKDAYS = [["вс", "воскр"], ["пн", "понед"], ["вт", "вторн"], ["ср", "сред", "среду"], ["чт", "четв"], ["пт", "пятн"], ["сб", "субб"]];
const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const astanaNow = () => new Date(Date.now() + 5 * 3600e3); // UTC+5, читать через getUTC*
const iso = (d) => d.toISOString().slice(0, 10);
const human = (s) => {
  const d = new Date(s + "T00:00:00Z");
  return `${["вс", "пн", "вт", "ср", "чт", "пт", "сб"][d.getUTCDay()]} ${d.getUTCDate()} ${["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][d.getUTCMonth()]}`;
};

function findGym(q) {
  const n = (s) => s.toLowerCase().replace(/ё/g, "е").replace(/[«»"'"]/g, "").trim();
  q = n(q);
  if (/^\d+$/.test(q)) return GYMS.filter(([id]) => String(id) === q);
  const search = (q) => {
    const exact = GYMS.filter(([, name]) => n(name) === q);
    return exact.length ? exact : GYMS.filter(([, name]) => n(name).includes(q));
  };
  let r = search(q);
  if (!r.length) { // "терма" -> "terma"/"therma"
    const t = [...q].map((c) => TR[c] ?? c).join("");
    r = search(t);
    if (!r.length) r = search(t.replace(/t/g, "th"));
  }
  return r;
}
const TR = Object.fromEntries("а a б b в v г g д d е e ж zh з z и i й y к k л l м m н n о o п p р r с s т t у u ф f х h ц ts ч ch ш sh щ sch ы y э e ю yu я ya ь  ъ ".split(" ").reduce((acc, x, i, arr) => (i % 2 ? acc : [...acc, [x, arr[i + 1]]]), []));

function parseDay(s) {
  s = s.toLowerCase().trim();
  const today = astanaNow();
  today.setUTCHours(0, 0, 0, 0);
  const plus = (k) => new Date(today.getTime() + k * 864e5);
  if (s === "сегодня") return iso(today);
  if (s === "завтра") return iso(plus(1));
  if (s === "послезавтра") return iso(plus(2));
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return s;
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/)) || (m = s.match(/^(\d{1,2})\s+([а-я]+)/))) {
    const day = +m[1];
    const mon = /^\d+$/.test(m[2]) ? +m[2] - 1 : MONTHS.findIndex((p) => m[2].startsWith(p));
    if (mon < 0 || day < 1 || day > 31) return null;
    let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : today.getUTCFullYear();
    let d = new Date(Date.UTC(y, mon, day));
    if (!m[3] && d < today) d = new Date(Date.UTC(y + 1, mon, day));
    return iso(d);
  }
  const wd = WEEKDAYS.findIndex((v) => v.some((p) => s.startsWith(p)));
  if (wd >= 0) return iso(plus((wd - today.getUTCDay() + 7) % 7)); // ближайший такой день, сегодня включительно
  return null;
}

function parseWindow(s) {
  const m = s.replace(/\s/g, "").match(/^(?:с)?(\d{1,2})(?::(\d{2}))?(?:-|до|–)(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const p = (h, mm) => `${String(+h).padStart(2, "0")}:${mm || "00"}`;
  return `${p(m[1], m[2])}-${p(m[3], m[4])}`;
}

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
    return Math.random() < 0.3 ? [{ id: `${gymId}-${date}-19`, start: "19:00", title: "Термы", free: 3, state: "open" }] : [];
  if (!env.ONEFIT_TOKEN) throw new Error("нет токена 1Fit (секрет ONEFIT_TOKEN)");
  const r = await fetch("https://api.1fit.app/api/classes/v7/list/by-studio/", {
    method: "POST",
    headers: { "Auth-Token": env.ONEFIT_TOKEN, "Content-Type": "application/json", "Accept-Language": "ru" },
    body: JSON.stringify({ studio_id: +gymId, start_date: `${date}T00:00:00+05:00` }),
  });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error("токен 1Fit больше не работает"), { auth: true });
  if (!r.ok) throw new Error(`1Fit ответил ${r.status}`);
  const j = await r.json();
  const CLOSED = ["PASSED", "NOT_AVAILABLE", "CANCELED", "CANCELLED", "FINISHED"];
  const slots = [];
  for (const c of j.result || [])
    for (const s of c.class_schedules || []) {
      const local = new Date(Date.parse(s.start_date) + 5 * 3600e3); // Астана
      if (iso(local) !== date) continue;
      const st = s.status?.status || "";
      const count = s.available_places_context?.count ?? 0;
      const hidden = s.available_places_context?.needs_to_hide_count;
      const open = st === "AVAILABLE" || (!CLOSED.includes(st) && (count > 0 || hidden));
      const state = open ? "open" : st === "PASSED" ? "passed" : "full";
      slots.push({ id: String(s.id), start: local.toISOString().slice(11, 16), title: c.name, state,
        free: open ? Math.max(count, 1) : 0,
        freeText: open ? (hidden ? "есть места" : `мест: ${count}`) : (s.status?.reason || "нет мест") });
    }
  // до какой даты 1Fit уже выложил расписание зала
  slots.availableUntil = j.class_schedule_available_date ? iso(new Date(Date.parse(j.class_schedule_available_date) + 5 * 3600e3)) : null;
  return slots;
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
    catch (e) {
      if (e.auth) { // предупреждаем один раз, а не каждую проверку
        if (!(await env.KV.get("auth_warned"))) {
          await env.KV.put("auth_warned", "1");
          await send(env, "⚠️ Токен 1Fit больше не работает — обнови ONEFIT_TOKEN в Cloudflare. Слежки сохранены.");
        }
        else if (verbose) await send(env, "⚠️ Токен 1Fit не работает — обнови ONEFIT_TOKEN в Cloudflare.");
        return;
      }
      if (verbose) await send(env, `⚠️ ${label(x)}: ${e.message}`);
      continue;
    }
    if (await env.KV.get("auth_warned")) await env.KV.delete("auth_warned");
    const inWin = slots.filter((s) => inWindow(s.start, x.window));
    const open = inWin.filter((s) => s.free > 0);
    const fresh = open.filter((s) => !x.seen.includes(s.id));
    const line = (s) => `• ${s.start} ${s.title} — ${s.freeText}`;
    const published = inWin.length > 0; // сеансы на этот день уже выложены
    if (fresh.length)
      await send(env, `🔥 Открылась запись!\n${x.name || x.gym_id}, ${human(x.date)}\n` + fresh.map(line).join("\n") + "\nБеги в 1Fit!");
    else if (published && !x.published && !open.length && !verbose) // один раз: расписание появилось, но мест нет
      await send(env, `📅 Появилось расписание: ${label(x)}\n` + inWin.map(line).join("\n") + "\nМест пока нет — слежу дальше, напишу, если освободится.");
    if (!fresh.length && verbose) {
      if (open.length) await send(env, `✅ ${label(x)}: можно записаться —\n` + open.map(line).join("\n"));
      else if (published) await send(env, `🚫 ${label(x)}: расписание есть, но мест нет —\n` + inWin.map(line).join("\n"));
      else await send(env, `⏳ ${label(x)}: запись ещё не открылась` +
        (slots.availableUntil ? ` (сейчас расписание выложено до ${human(slots.availableUntil)})` : "") + ". Слежу.");
    }
    if (published !== !!x.published) { x.published = published; changed = true; }
    const ids = open.map((s) => s.id);
    if (JSON.stringify(ids) !== JSON.stringify(x.seen)) { x.seen = ids; changed = true; }
  }
  if (changed) await save(env, w); // пишем в KV только при изменениях — укладываемся в бесплатный лимит
}

// Интервал между проверками: случайно от MIN_MINUTES до MAX_MINUTES (по умолчанию 8–15 мин),
// плюс случайная задержка 0–60 с с точностью до миллисекунд. Вне ACTIVE_HOURS (по Астане) не проверяем; "7-2" = с 7:00 до 2:00.
async function maybeCheck(env) {
  const min = +(env.MIN_MINUTES || 8), max = +(env.MAX_MINUTES || 15);
  const [from, to] = (env.ACTIVE_HOURS || "7-24").split("-").map(Number);
  const hour = new Date(Date.now() + 5 * 3600e3).getUTCHours(); // Астана UTC+5
  const active = from <= to ? hour >= from && hour < to : hour >= from || hour < to; // "7-2" = с 7:00 до 2:00 ночи
  if (!active) return;

  const next = +((await env.KV.get("next_check_at")) || 0);
  if (Date.now() < next) return;

  const interval = (min + Math.random() * (max - min)) * 60e3;
  await env.KV.put("next_check_at", String(Date.now() + interval));

  await new Promise((r) => setTimeout(r, Math.random() * 60e3)); // 0–60 с, разные миллисекунды
  await check(env);
}

const label = (x) => `${x.name || x.gym_id}, ${human(x.date)}, ${x.window || "любое время"}`;

async function handle(env, text) {
  text = text.trim();
  const w = await load(env);

  if (text.startsWith("/")) {
    const [raw, ...a] = text.split(/\s+/);
    const cmd = raw.split("@")[0].toLowerCase();
    if (cmd === "/start" || cmd === "/help") return send(env, HELP);
    if (cmd === "/list")
      return send(env, w.length ? "Слежу за:\n" + w.map((x, i) => `${i + 1}. ${label(x)}`).join("\n") : "Пока ни за чем не слежу. Напиши, например: Therma, пятница");
    if (cmd === "/stop" || cmd === "/rm") {
      if (!a.length) { await save(env, []); return send(env, "🔕 Все уведомления выключены."); }
      const i = +a[0];
      if (!(i >= 1 && i <= w.length)) return send(env, "Нет такого номера. Посмотри /list");
      const [x] = w.splice(i - 1, 1);
      await save(env, w);
      return send(env, `🔕 Выключил: ${label(x)}`);
    }
    if (cmd === "/now") {
      if (!w.length) return send(env, "Пока ни за чем не слежу.");
      await send(env, "Проверяю…");
      return check(env, true);
    }
    return send(env, "Не знаю такую команду. /start — подсказка");
  }

  // "Therma, пятница, 18-22"
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return send(env, "Напиши через запятую зал и день, например:\nTherma, пятница\n\n/start — подсказка");
  const gyms = findGym(parts[0]);
  if (!gyms.length) return send(env, `Не нашёл зал «${parts[0]}» в 1Fit Астаны. Попробуй написать название иначе.`);
  if (gyms.length > 1)
    return send(env, `Нашёл несколько, уточни (можно написать номер вместо названия):\n` +
      gyms.slice(0, 10).map(([id, n]) => `${id} — ${n}`).join("\n"));
  const date = parseDay(parts[1]);
  if (!date) return send(env, `Не понял день «${parts[1]}». Примеры: сегодня, завтра, пятница, 5 декабря, 05.12`);
  let window = null;
  if (parts[2]) {
    window = parseWindow(parts[2]);
    if (!window) return send(env, `Не понял время «${parts[2]}». Пример: 18-22 или 18:30-21:00`);
  }
  const [gym_id, name] = gyms[0];
  if (w.some((x) => String(x.gym_id) === String(gym_id) && x.date === date && x.window === window))
    return send(env, `Уже слежу: ${name}, ${human(date)}. /list — все слежки`);
  const x = { gym_id: String(gym_id), name, date, window, seen: [] };

  // Сначала смотрим, что там прямо сейчас
  let slots = null, note = "";
  try { slots = await fetchSlots(env, gym_id, date); }
  catch (e) { note = e.auth ? "\n\n⚠️ Проверить сейчас не смог: токен 1Fit не работает." : `\n\n⚠️ Проверить сейчас не смог: ${e.message}`; }

  const line = (s) => `• ${s.start} ${s.title} — ${s.freeText}`;
  let status = "";
  if (slots) {
    const inWin = slots.filter((s) => inWindow(s.start, x.window));
    const open = inWin.filter((s) => s.free > 0);
    const upcoming = inWin.filter((s) => s.state !== "passed");
    if (open.length)
      return send(env, `✅ Уже можно записаться!\n${label(x)}\n` + open.map(line).join("\n") + "\n\nБеги в 1Fit. Слежку не включал — если всё займут, напиши ещё раз.");
    if (inWin.length && !upcoming.length)
      return send(env, `${label(x)}: все сеансы на этот день уже прошли. Слежку не включал.`);
    if (inWin.length) {
      status = "🚫 Расписание есть, но мест нет:\n" + inWin.map(line).join("\n") + "\nНапишу, если место освободится.";
      x.published = true;
    } else {
      status = "⏳ Запись на этот день ещё не открылась" +
        (slots.availableUntil ? ` (сейчас расписание выложено до ${human(slots.availableUntil)})` : "") + ".\nНапишу, как только откроется.";
    }
  }
  w.push(x);
  await save(env, w);
  return send(env, `🔔 Слежка включена: ${label(x)}\n\n${status || "Как только появится свободный слот — сразу напишу."}${note}\n\n/list — все слежки, /stop — выключить`);
}

export default {
  // Telegram webhook
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("ok");
    if (req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) return new Response("no", { status: 403 });
    const u = await req.json();
    const m = u.message || {};
    if (String(m.chat?.id) === String(env.TG_CHAT_ID) && m.text) await handle(env, m.text);
    return new Response("ok");
  },
  // cron срабатывает каждые 5 минут, но реальная проверка — со случайным интервалом
  async scheduled(_ev, env, ctx) {
    ctx.waitUntil(maybeCheck(env));
  },
};
