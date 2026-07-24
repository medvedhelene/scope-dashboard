#!/usr/bin/env bash
# Полная пересборка дашборда: данные из Metabase -> React/Bklit -> dashboard.html
set -euo pipefail
cd "$(dirname "$0")"

python3 fetch_data.py
cd app && npm run build && cd ..

# Артефакт-вьюер оборачивает файл своим <html><head><body> — срезаем нашу обёртку,
# оставляя содержимое head (meta/title/style/script) и body как фрагмент.
python3 - <<'EOF'
import re
s = open('app/dist/index.html').read()
for tag in ['<!doctype html>', '<!DOCTYPE html>']:
    s = s.replace(tag, '')
s = re.sub(r'</?html[^>]*>|</?head[^>]*>|</?body[^>]*>', '', s)
open('dashboard.html', 'w').write(s.strip() + '\n')
print('dashboard.html:', len(s), 'bytes')
EOF
