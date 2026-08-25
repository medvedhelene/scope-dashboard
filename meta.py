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
API = "https://graph.facebook.com/v21.0"


def _accounts():
    """Один или несколько рекламных кабинетов: META_AD_ACCOUNT_ID_1/META_ACCESS_TOKEN_1,
    _2, ... Для обратной совместимости также понимает старые META_AD_ACCOUNT_ID/
    META_ACCESS_TOKEN без суффикса (как один кабинет)."""
    accounts = []
    if "META_AD_ACCOUNT_ID" in ENV and "META_ACCESS_TOKEN" in ENV:
        accounts.append({"id": ENV["META_AD_ACCOUNT_ID"], "token": ENV["META_ACCESS_TOKEN"]})
    i = 1
    while f"META_AD_ACCOUNT_ID_{i}" in ENV:
        accounts.append({
            "id": ENV[f"META_AD_ACCOUNT_ID_{i}"],
            "token": ENV[f"META_ACCESS_TOKEN_{i}"],
        })
        i += 1
    if not accounts:
        sys.exit("ERROR: нет ни META_AD_ACCOUNT_ID/META_ACCESS_TOKEN, ни META_AD_ACCOUNT_ID_1/META_ACCESS_TOKEN_1 в .env")
    return accounts


ACCOUNTS = _accounts()
# Дефолты для обратной совместимости (CLI-вызов ./meta.py insights ... без указания кабинета)
TOKEN = ACCOUNTS[0]["token"]
AD_ACCOUNT_ID = ACCOUNTS[0]["id"]


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


def insights(fields, breakdowns=None, level=None, date_preset=None, time_range=None, time_increment=None,
             limit=200, account_id=None, token=None):
    params = {"fields": ",".join(fields), "limit": limit, "access_token": token or TOKEN}
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
    url = f"{API}/{account_id or AD_ACCOUNT_ID}/insights"
    while url:
        data = _get(url, params)
        rows.extend(data.get("data", []))
        url = data.get("paging", {}).get("next")
        params = None  # next URL already has all params + token encoded
        if url:
            time.sleep(1)
    return rows


def insights_all_accounts(fields, breakdowns=None, level=None, date_preset=None, time_range=None, time_increment=None, limit=200):
    """Как insights(), но по всем кабинетам из .env сразу — строки помечаются
    account_id (нужно для ad_creative_thumbnail, у которого id рекламы привязан
    к конкретному кабинету/токену)."""
    rows = []
    for acc in ACCOUNTS:
        acc_rows = insights(fields, breakdowns=breakdowns, level=level, date_preset=date_preset,
                             time_range=time_range, time_increment=time_increment, limit=limit,
                             account_id=acc["id"], token=acc["token"])
        for r in acc_rows:
            r["_account_id"] = acc["id"]
            r["_token"] = acc["token"]
        rows.extend(acc_rows)
    return rows


def ad_creative_thumbnail(ad_id, size=300, token=None):
    """Превью креатива (картинка/первый кадр видео). None, если недоступно."""
    try:
        resp = requests.get(
            f"{API}/{ad_id}",
            params={
                "fields": f"creative.thumbnail_width({size}).thumbnail_height({size}){{thumbnail_url}}",
                "access_token": token or TOKEN,
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
