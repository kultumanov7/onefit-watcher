"""Telegram-бот: следит за слотами в 1Fit и пишет, когда открывается запись.

Команды:
  /find therma                         — найти заведение и его id
  /watch <gym_id> <YYYY-MM-DD> [HH:MM-HH:MM]  — следить (время опционально)
  /list                                — что отслеживается
  /rm <N>                              — удалить слежку
  /now                                 — проверить прямо сейчас
"""
import json
import os
import random
import re
import time
from datetime import date, datetime
from pathlib import Path

import requests

import onefit

TG = f"https://api.telegram.org/bot{os.environ['TG_TOKEN']}"
OWNER = int(os.environ["TG_CHAT_ID"])            # бот отвечает только тебе
POLL = int(os.environ.get("POLL_SEC", "120"))    # не ставь слишком часто — заметят
STATE = Path(os.environ.get("STATE_FILE", "watches.json"))


def load():
    return json.loads(STATE.read_text()) if STATE.exists() else []


def save(w):
    STATE.write_text(json.dumps(w, ensure_ascii=False, indent=1))


def send(text):
    requests.post(f"{TG}/sendMessage", json={"chat_id": OWNER, "text": text}, timeout=15)


def in_window(start, window):
    if not window:
        return True
    lo, hi = window.split("-")
    return lo <= start <= hi


def check(watches, announce_empty=False):
    today = date.today().isoformat()
    changed = False
    for w in list(watches):
        if w["date"] < today:            # дата прошла — убираем
            watches.remove(w)
            changed = True
            continue
        try:
            slots = onefit.fetch_slots(w["gym_id"], w["date"])
        except Exception as e:
            print(datetime.now(), "fetch error", w, repr(e))
            if announce_empty:
                send(f"⚠️ {w['name']} {w['date']}: ошибка {e!r}")
            continue
        open_ = [s for s in slots if s["free"] > 0 and in_window(s["start"], w.get("window"))]
        new = [s for s in open_ if s["id"] not in w["seen"]]
        if new:
            lines = "\n".join(f"• {s['start']} {s['title']} — мест: {s['free']}" for s in new)
            send(f"🔥 Открылась запись: {w['name']} на {w['date']}\n{lines}\nБеги в 1Fit!")
        elif announce_empty:
            send(f"{w['name']} {w['date']}: свободных слотов нет")
        # помним только открытые сейчас: если слот закрылся и открылся снова — уведомим ещё раз
        ids = [s["id"] for s in open_]
        if ids != w["seen"]:
            w["seen"] = ids
            changed = True
    if changed:
        save(watches)


def handle(text, watches):
    parts = text.strip().split()
    cmd, args = parts[0].split("@")[0].lower(), parts[1:]
    if cmd in ("/start", "/help"):
        send(__doc__)
    elif cmd == "/find" and args:
        try:
            gyms = onefit.search_gyms(" ".join(args))
            send("\n".join(f"{g['id']} — {g['name']}" for g in gyms[:15]) or "Ничего не найдено")
        except Exception as e:
            send(f"Ошибка: {e!r}")
    elif cmd == "/watch" and len(args) >= 2:
        gym_id, d = args[0], args[1]
        window = args[2] if len(args) > 2 else None
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) or (window and not re.fullmatch(r"\d\d:\d\d-\d\d:\d\d", window)):
            send("Формат: /watch <gym_id> 2026-12-05 [18:00-22:00]")
            return
        watches.append({"gym_id": gym_id, "name": gym_id, "date": d, "window": window, "seen": []})
        save(watches)
        send(f"Слежу: {gym_id} {d} {window or 'любое время'} (каждые ~{POLL}с)")
    elif cmd == "/list":
        send("\n".join(f"{i+1}. {w['name']} {w['date']} {w.get('window') or 'любое время'}"
                       for i, w in enumerate(watches)) or "Пусто")
    elif cmd == "/rm" and args and args[0].isdigit() and 0 < int(args[0]) <= len(watches):
        w = watches.pop(int(args[0]) - 1)
        save(watches)
        send(f"Удалено: {w['name']} {w['date']}")
    elif cmd == "/now":
        check(watches, announce_empty=True)
    else:
        send("Не понял. /help")


def main():
    watches = load()
    offset, next_poll = None, 0
    print("bot started, poll every", POLL, "s")
    while True:
        try:
            r = requests.get(f"{TG}/getUpdates", params={"timeout": 20, "offset": offset}, timeout=30).json()
            for u in r.get("result", []):
                offset = u["update_id"] + 1
                m = u.get("message") or {}
                if m.get("chat", {}).get("id") == OWNER and m.get("text", "").startswith("/"):
                    handle(m["text"], watches)
        except Exception as e:
            print(datetime.now(), "telegram error", repr(e))
            time.sleep(5)
        if time.time() >= next_poll:
            check(watches)
            next_poll = time.time() + POLL * random.uniform(0.8, 1.2)   # джиттер, чтобы не было ровного ритма


if __name__ == "__main__":
    main()
