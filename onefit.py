"""Адаптер к 1Fit. Единственное место, которое зависит от их API.

Публичного API у 1Fit нет, поэтому адрес запроса и формат ответа нужно один раз
подсмотреть в трафике приложения/сайта (см. README.md) и вписать сюда.
Пока это не сделано, работает FAKE-режим (ONEFIT_FAKE=1) для проверки бота.
"""
import os
import random
from datetime import datetime

import requests

BASE = os.environ.get("ONEFIT_BASE", "")        # например https://api.<...>  — из перехваченного запроса
TOKEN = os.environ.get("ONEFIT_TOKEN", "")      # токен ВТОРОГО аккаунта, не основного
FAKE = os.environ.get("ONEFIT_FAKE") == "1"

session = requests.Session()
session.headers.update({
    # Скопируй сюда заголовки из перехваченного запроса (User-Agent, версия приложения и т.п.),
    # чтобы запросы выглядели как обычное приложение.
    "Accept": "application/json",
})
if TOKEN:
    session.headers["Authorization"] = f"Bearer {TOKEN}"


def search_gyms(query: str) -> list[dict]:
    """-> [{'id': str, 'name': str}]"""
    if FAKE:
        return [{"id": "therma", "name": "Therma"}, {"id": "gym42", "name": "Some Gym"}]
    # TODO: вписать реальный эндпоинт поиска заведений, например:
    # r = session.get(f"{BASE}/<path>", params={"search": query, "city": "astana"}, timeout=15)
    # r.raise_for_status()
    # return [{"id": str(x["id"]), "name": x["title"]} for x in r.json()["data"]]
    raise NotImplementedError("search_gyms: впиши эндпоинт из перехваченного трафика")


def fetch_slots(gym_id: str, date: str) -> list[dict]:
    """Слоты заведения на дату YYYY-MM-DD.
    -> [{'id': str, 'start': 'HH:MM', 'title': str, 'free': int}]  (free > 0 = можно записаться)
    """
    if FAKE:
        # каждый опрос с шансом 30% «открывается» слот — для проверки уведомлений
        if random.random() < 0.3:
            return [{"id": f"{gym_id}-{date}-19", "start": "19:00", "title": "Термы", "free": 3}]
        return []
    # TODO: вписать реальный эндпоинт расписания, например:
    # r = session.get(f"{BASE}/<path>/{gym_id}/schedule", params={"date": date}, timeout=15)
    # r.raise_for_status()
    # return [{
    #     "id": str(s["id"]),
    #     "start": datetime.fromisoformat(s["start_time"]).strftime("%H:%M"),
    #     "title": s.get("name", ""),
    #     "free": s["capacity"] - s["booked"],
    # } for s in r.json()["data"]]
    raise NotImplementedError("fetch_slots: впиши эндпоинт из перехваченного трафика")
