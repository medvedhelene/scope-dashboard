#!/usr/bin/env python3
"""Локальный сервер дашборда: статика + POST /api/refresh.

/api/refresh перезапускает fetch_data.py (свежие агрегаты из Metabase)
и возвращает новый dashboard_data.json — кнопка «Обновить» на дашборде
работает по-настоящему только через этот сервер.

Запуск: python3 serve.py  →  http://localhost:8765/dashboard.html
"""
import http.server
import os
import subprocess
import sys
from pathlib import Path

DIR = Path(__file__).parent
PORT = int(os.environ.get('PORT', 8765))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIR), **kwargs)

    def do_POST(self):
        if self.path != '/api/refresh':
            self.send_response(404)
            self.end_headers()
            return
        try:
            subprocess.run(
                [sys.executable, 'fetch_data.py'],
                cwd=DIR, check=True, capture_output=True, timeout=180,
            )
            body = (DIR / 'dashboard_data.json').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())


if __name__ == '__main__':
    print(f'http://localhost:{PORT}/dashboard.html')
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
