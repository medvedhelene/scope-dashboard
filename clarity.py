#!/usr/bin/env python3
"""Хелпер для Microsoft Clarity (Data Export API).

Ограничения API, о которых надо помнить:
  * отдаёт только агрегаты за последние 1-3 дня (numOfDays=1..3), истории нет;
  * лимит 10 запросов на проект в сутки;
  * доступа к самим записям сессий через API нет — только цифры.

  ./clarity.py            # весь свежий срез за 3 дня
"""
import json
import sys
from pathlib import Path

import requests

HERE = Path(__file__).parent
ENV = dict(
    line.split("=", 1)
    for line in (HERE / ".env").read_text().splitlines()
    if "=" in line and not line.strip().startswith("#")
)
TOKEN = ENV["CLARITY_API_TOKEN"]
BASE = "https://www.clarity.ms/export-data/api/v1/project-live-insights"


def live_insights(num_days=3, dimensions=None, timeout=40):
    """num_days: 1..3. dimensions: до 3 имён (Browser/Device/OS/Country/
    Source/Medium/Campaign/URL и т.п.) — разбивка метрик по ним."""
    params = {"numOfDays": max(1, min(3, num_days))}
    for i, dim in enumerate(dimensions or [], start=1):
        params[f"dimension{i}"] = dim
    resp = requests.get(
        BASE,
        headers={"Authorization": f"Bearer {TOKEN}"},
        params=params,
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


def _metric(rows, name):
    for r in rows:
        if r.get("metricName") == name:
            return r.get("information") or []
    return []


def summary(num_days=3):
    """Плоская выжимка ключевых цифр для дашборда."""
    rows = live_insights(num_days)
    traffic = (_metric(rows, "Traffic") or [{}])[0]
    engagement = (_metric(rows, "EngagementTime") or [{}])[0]
    scroll = (_metric(rows, "ScrollDepth") or [{}])[0]

    def friction(name):
        info = (_metric(rows, name) or [{}])[0]
        return {
            "sessions_pct": info.get("sessionsWithMetricPercentage", 0),
            "count": info.get("subTotal", 0),
            "pages": info.get("pagesViews", 0),
        }

    return {
        "num_days": num_days,
        "sessions": traffic.get("totalSessionCount", 0),
        "bot_sessions": traffic.get("totalBotSessionCount", 0),
        "distinct_users": traffic.get("distinctUserCount", 0),
        "pages_per_session": round(traffic.get("pagesPerSessionPercentage", 0) or 0, 2),
        "total_time_min": engagement.get("totalTime", 0),
        "active_time_min": engagement.get("activeTime", 0),
        "avg_scroll_depth": round(scroll.get("averageScrollDepth", 0) or 0, 1),
        "dead_clicks": friction("DeadClickCount"),
        "rage_clicks": friction("RageClickCount"),
        "quick_backs": friction("QuickbackClick"),
        "excessive_scroll": friction("ExcessiveScroll"),
        "script_errors": friction("ScriptErrorCount"),
        "error_clicks": friction("ErrorClickCount"),
        "top_pages": [
            {"url": p.get("url"), "visits": p.get("visitsCount", 0)}
            for p in _metric(rows, "PopularPages")[:10]
        ],
        "by_device": [
            {"name": d.get("name"), "sessions": d.get("sessionsCount", 0)}
            for d in _metric(rows, "Device")
        ],
    }


def main():
    num = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    print(json.dumps(summary(num), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
