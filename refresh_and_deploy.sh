#!/usr/bin/env bash
# Автообновление дашборда: тянет свежие данные и выкатывает их на прод.
# Запускается по расписанию через launchd (см. com.scope360.dashboard-refresh.plist).
set -euo pipefail
cd "$(dirname "$0")"

export PATH="$PWD/.local-node/bin:/usr/bin:/bin:/usr/local/bin:$PATH"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') — старт автообновления ==="

python3 fetch_data.py

cd app
npm run build
cd ..

# Артефакт-вьюер оборачивает файл своим <html><head><body> — срезаем нашу обёртку,
# оставляя содержимое head (meta/title/style/script) и body как фрагмент.
python3 - <<'EOF'
import re
s = open('app/dist/index.html').read()
for tag in ['<!doctype html>', '<!DOCTYPE html>']:
    s = s.replace(tag, '')
s = re.sub(r'</?html[^>]*>|</?head[^>]*>|</?body[^>]*>', '', s)
open('dashboard.html', 'w').write(s.strip() + '\n')
EOF

# Коммитим и пушим, только если реально что-то изменилось.
git add dashboard_data.json app/src/data.json app/public/dashboard_data.json dashboard.html
if git diff --cached --quiet; then
  echo "Данные не изменились — пропускаю коммит и деплой."
else
  git commit -m "Автообновление данных дашборда ($(date '+%Y-%m-%d %H:%M'))

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  git push origin main
  curl -s -X POST "https://api.vercel.com/v1/integrations/deploy/prj_b8mTXDA77rgUtBa2ACeuAcd260C1/lBp7WXtIoZ" \
    -o /dev/null -w "Деплой запущен, HTTP %{http_code}\n"
fi

echo "=== $(date '+%Y-%m-%d %H:%M:%S') — готово ==="
