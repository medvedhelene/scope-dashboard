#!/usr/bin/env python3
"""Хелпер для Google Analytics 4 Data API.

  ./ga4.py report '{"dimensions":[{"name":"date"}],"metrics":[{"name":"sessions"}],"dateRanges":[{"startDate":"30daysAgo","endDate":"today"}]}'
"""
import json
import sys
from pathlib import Path

from google.oauth2 import service_account
from google.auth.transport.requests import Request
import requests

HERE = Path(__file__).parent
ENV = dict(
    line.split("=", 1)
    for line in (HERE / ".env").read_text().splitlines()
    if "=" in line
)
KEY_FILE = HERE / "ga4-service-account.json"
PROPERTY_ID = ENV["GA4_PROPERTY_ID"]  # scope360.io — лендинг до логина
PROPERTY_ID_APP = ENV["GA4_PROPERTY_ID_APP"]  # scope360.io/* — приложение после логина
SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]

_creds = None


def _token():
    global _creds
    if _creds is None:
        _creds = service_account.Credentials.from_service_account_file(
            str(KEY_FILE), scopes=SCOPES,
        )
    if not _creds.valid:
        _creds.refresh(Request())
    return _creds.token


def report(body, property_id=None):
    resp = requests.post(
        f"https://analyticsdata.googleapis.com/v1beta/properties/{property_id or PROPERTY_ID}:runReport",
        headers={"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    if not resp.ok:
        sys.exit(f"ERROR {resp.status_code}: {resp.text}")
    return resp.json()


def rows_to_table(data):
    dim_names = [h["name"] for h in data.get("dimensionHeaders", [])]
    met_names = [h["name"] for h in data.get("metricHeaders", [])]
    out = []
    for row in data.get("rows", []):
        rec = {}
        for name, v in zip(dim_names, row.get("dimensionValues", [])):
            rec[name] = v["value"]
        for name, v in zip(met_names, row.get("metricValues", [])):
            rec[name] = v["value"]
        out.append(rec)
    return out


def main():
    if len(sys.argv) < 3 or sys.argv[1] != "report":
        sys.exit("usage: ./ga4.py report '<json body>'")
    data = report(json.loads(sys.argv[2]))
    print(json.dumps(rows_to_table(data), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
