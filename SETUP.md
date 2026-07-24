# Развёртывание scope-metabase на новом устройстве

Требования: Python 3.9+, Node.js 18+ (проверено на 24), npm.

```bash
unzip scope-metabase-*.zip && cd scope-metabase
cd app && npm install && cd ..   # зависимости React-приложения (~1 мин)
./build.sh                        # свежие данные из Metabase + сборка dashboard.html
python3 serve.py                  # http://localhost:8765/dashboard.html
```

## Ключи и доступы

Скопировать `.env.example` в `.env` и заполнить (не коммитить — уже в `.gitignore`):

- **Metabase** — `METABASE_URL` + `METABASE_API_KEY` (Settings → Admin → API Keys).
  Если `fetch_data.py`/`mb.py` падает с 403 — WAF режет дефолтный User-Agent
  питона, в `mb.py` уже стоит подменный на curl; при прямых запросах тоже curl.
- **Google Analytics 4** — `GA4_PROPERTY_ID` (лендинг) + `GA4_PROPERTY_ID_APP`
  (приложение после логина), плюс файл `ga4-service-account.json` в корне
  (сервис-аккаунт с ролью Viewer в обоих GA4-свойствах; тоже в `.gitignore`).
- **Meta Marketing API** (Facebook/Instagram Ads) — `META_ACCESS_TOKEN`
  (System User token, права `ads_read`) + `META_AD_ACCOUNT_ID` (`act_...`).

Без какого-то из доступов дашборд соберётся, но соответствующие виджеты
(GA4-графики / вкладка «Платный трафик») будут пустыми — это не ошибка сборки.

## Структура

`mb.py`, `ga4.py`, `meta.py` — клиенты API Metabase/GA4/Meta Ads;
`fetch_data.py` — SQL-агрегаты и запросы к ним → `dashboard_data.json`;
`app/` — Vite + React + Bklit UI (компоненты в `app/src/components/charts`,
страница — `app/src/App.tsx`); `build.sh` — полная пересборка
(`fetch_data.py` → `npm run build` в `app/` → склейка в `dashboard.html`);
`serve.py` — статика + `POST /api/refresh` (кнопка «Обновить» на дашборде
дергает `fetch_data.py` на лету без пересборки); `dashboard.html` — готовый
самодостаточный билд, можно открыть/раздавать как один файл;
`dashboard-v1.html` — старая версия без React, на всякий случай.

Известные грабли Bklit UI и особенности данных описаны в README.md.
