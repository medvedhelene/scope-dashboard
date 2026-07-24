#!/usr/bin/env python3
"""Хелпер для Meta Marketing API (Facebook/Instagram Ads).

  ./meta.py insights '{"level":"ad","fields":"ad_name,spend,impressions","date_preset":"last_7d"}'
"""
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import requests

HERE = Path(__file__).parent
ENV = dict(
    line.split("=", 1)
    for line in (HERE / ".env").read_text().splitlines()
    if "=" in line
)
TOKEN = ENV["META_ACCESS_TOKEN"]
AD_ACCOUNT_ID = ENV["META_AD_ACCOUNT_ID"]
API = "https://graph.facebook.com/v21.0"


def _get(url, params=None):
    for attempt in range(6):
        resp = requests.get(url, params=params, timeout=60)
        data = resp.json()
        if "error" in data:
            if data["error"].get("code") == 4 and attempt < 5:
                time.sleep(15)
                continue
            sys.exit(f"ERROR: {data['error']}")
        return data
    return data


def insights(fields, breakdowns=None, level=None, date_preset=None, time_range=None, time_increment=None, limit=200):
    params = {"fields": ",".join(fields), "limit": limit, "access_token": TOKEN}
    if time_range:
        params["time_range"] = json.dumps(time_range)
    else:
        params["date_preset"] = date_preset or "maximum"
    if breakdowns:
        params["breakdowns"] = ",".join(breakdowns)
    if level:
        params["level"] = level
    if time_increment:
        params["time_increment"] = time_increment

    rows = []
    url = f"{API}/{AD_ACCOUNT_ID}/insights"
    while url:
        data = _get(url, params)
        rows.extend(data.get("data", []))
        url = data.get("paging", {}).get("next")
        params = None  # next URL already has all params + token encoded
        if url:
            time.sleep(1)
    return rows


def ad_creative_thumbnail(ad_id, size=300):
    """Превью креатива (картинка/первый кадр видео). None, если недоступно."""
    try:
        resp = requests.get(
            f"{API}/{ad_id}",
            params={
                "fields": f"creative.thumbnail_width({size}).thumbnail_height({size}){{thumbnail_url}}",
                "access_token": TOKEN,
            },
            timeout=30,
        )
        return resp.json().get("creative", {}).get("thumbnail_url")
    except Exception:
        return None


def action_value(row, action_type):
    for a in row.get("actions", []) or []:
        if a["action_type"] == action_type:
            return float(a["value"])
    return 0.0


def main():
    if len(sys.argv) < 3 or sys.argv[1] != "insights":
        sys.exit("usage: ./meta.py insights '<json params>'")
    params = json.loads(sys.argv[2])
    rows = insights(
        fields=params["fields"].split(","),
        breakdowns=params.get("breakdowns", "").split(",") if params.get("breakdowns") else None,
        level=params.get("level"),
        date_preset=params.get("date_preset", "maximum"),
        time_increment=params.get("time_increment"),
    )
    print(json.dumps(rows, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
