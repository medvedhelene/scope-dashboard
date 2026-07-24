#!/usr/bin/env python3
"""Хелпер для Metabase API.

  ./mb.py sql "SELECT count(*) FROM analytics.fact_sales_transactions"
  ./mb.py get /api/database/3/metadata
"""
import json
import sys
import urllib.request
from pathlib import Path

ENV = dict(
    line.split("=", 1)
    for line in (Path(__file__).parent / ".env").read_text().splitlines()
    if "=" in line
)
DATABASE_ID = 3


def request(method, path, body=None):
    req = urllib.request.Request(
        ENV["METABASE_URL"] + path,
        method=method,
        data=json.dumps(body).encode() if body else None,
        headers={
            "x-api-key": ENV["METABASE_API_KEY"],
            "Content-Type": "application/json",
            # WAF отдаёт 403 на дефолтный Python-urllib
            "User-Agent": "curl/8.4.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 2 else None
    if cmd == "sql":
        d = request("POST", "/api/dataset", {
            "database": DATABASE_ID,
            "type": "native",
            "native": {"query": sys.argv[2]},
        })
        if d.get("error"):
            sys.exit(f"ERROR: {d['error']}")
        cols = [c["name"] for c in d["data"]["cols"]]
        print("\t".join(cols))
        for row in d["data"]["rows"]:
            print("\t".join(str(x) for x in row))
    elif cmd == "get":
        print(json.dumps(request("GET", sys.argv[2]), indent=2, ensure_ascii=False))
    else:
        sys.exit('usage: ./mb.py sql "<query>" | ./mb.py get <path>')


if __name__ == "__main__":
    main()
