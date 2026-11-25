"""Выгружает все заведения города из публичного API сайта 1fit.app (без аккаунта).

    python fetch_gyms.py            # Астана (city_id=2) -> gyms_astana.json
    python fetch_gyms.py 1 almaty   # Алматы (city_id=1) -> gyms_almaty.json
"""
import json
import sys
import urllib.request

URL = "https://api.1fit.app/api/landing/v2/studios/list/"


def fetch(city_id: int) -> list[dict]:
    out = []
    for page in range(1, 100):
        body = json.dumps({"city_id": city_id, "page": page, "limit": 100}).encode()  # limit максимум 100
        req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "Accept-Language": "ru"})
        items = json.load(urllib.request.urlopen(req, timeout=30))["result"]
        if not items:
            break
        out += [{"id": s["id"], "name": s["name"], "kind": s["kind"].strip(), "address": s["address"]} for s in items]
    return sorted(out, key=lambda s: s["id"])


if __name__ == "__main__":
    city_id = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    slug = sys.argv[2] if len(sys.argv) > 2 else "astana"
    gyms = fetch(city_id)
    path = f"gyms_{slug}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(gyms, f, ensure_ascii=False, indent=1)
    print(f"{len(gyms)} заведений -> {path}")
