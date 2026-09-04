#!/usr/bin/env python3
"""Хелпер для PostHog (продуктовая аналитика внутри приложения).

  ./posthog.py trends '["trade_opened","note_created"]'
"""
import json
import sys
from pathlib import Path

import requests

HERE = Path(__file__).parent
ENV = dict(
    line.split("=", 1)
    for line in (HERE / ".env").read_text().splitlines()
    if "=" in line
)
HOST = ENV.get("POSTHOG_HOST", "https://eu.posthog.com")
PROJECT_ID = ENV["POSTHOG_PROJECT_ID"]
API_KEY = ENV["POSTHOG_API_KEY"]


def query(body, timeout=30):
    resp = requests.post(
        f"{HOST}/api/projects/{PROJECT_ID}/query/",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json={"query": body},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


def funnel(steps, date_from="-30d", window_days=14):
    """steps: список [(event, custom_name), ...] в нужном порядке."""
    data = query({
        "kind": "FunnelsQuery",
        "series": [
            {"kind": "EventsNode", "event": ev, "custom_name": name}
            for ev, name in steps
        ],
        "dateRange": {"date_from": date_from},
        "funnelsFilter": {
            "funnelWindowInterval": window_days,
            "funnelWindowIntervalUnit": "day",
            "funnelOrderType": "ordered",
        },
        "filterTestAccounts": True,
    })
    return data.get("results", [])


def trends(events, date_from="-30d"):
    """events: список имён событий. Возвращает {event: total_count}."""
    data = query({
        "kind": "TrendsQuery",
        "series": [{"event": ev} for ev in events],
        "dateRange": {"date_from": date_from},
        "interval": "day",
        "filterTestAccounts": True,
    })
    return {r["label"]: r.get("count", 0) for r in data.get("results", [])}


def raw_events(event, limit=200):
    """Сырые события с полным набором properties (для нестандартных полей —
    план, сумма, провайдер и т.п., которые не агрегируешь через TrendsQuery,
    т.к. они вложены в объект, а не плоское свойство). Без date-фильтра —
    просто последние `limit` штук, объём событий пока небольшой."""
    resp = requests.get(
        f"{HOST}/api/projects/{PROJECT_ID}/events/",
        headers={"Authorization": f"Bearer {API_KEY}"},
        params={"event": event, "limit": limit, "orderBy": '["-timestamp"]'},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("results", [])


def active_users(event, date_from="-30d"):
    """Текущие DAU/WAU/MAU по событию-индикатору активности (последняя точка
    скользящего окна на сегодня, не среднее за период)."""
    out = {}
    for math, key in [("dau", "dau"), ("weekly_active", "wau"), ("monthly_active", "mau")]:
        data = query({
            "kind": "TrendsQuery",
            "series": [{"event": event, "math": math}],
            "dateRange": {"date_from": date_from},
            "interval": "day",
            "filterTestAccounts": True,
        })
        series = (data.get("results") or [{}])[0].get("data", [])
        out[key] = series[-1] if series else 0
    return out


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: ./posthog.py trends '[\"event1\",\"event2\"]'")
    cmd, arg = sys.argv[1], json.loads(sys.argv[2])
    if cmd == "trends":
        print(json.dumps(trends(arg), ensure_ascii=False, indent=2))
    else:
        sys.exit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main()
