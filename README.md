# scope-metabase

Аналитический дашборд Scope360: продажи/подписки из Metabase (Postgres),
трафик и поведение из Google Analytics 4 (два свойства — лендинг и приложение
после логина) и расходы на рекламу из Meta Marketing API (Facebook/Instagram).

Развёртывание на новой машине и все нужные ключи/токены — см. **SETUP.md**.
Шаблон `.env` — в `.env.example`. Ничего из ключей/токенов в git не коммитится
(`.env`, `ga4-service-account.json` — в `.gitignore`).

Metabase: https://metabase.scope360.io (БД id=3, `PSQL-PROD-SCOPE`, PostgreSQL).

## Хелпер

```bash
./mb.py sql "SELECT count(*) FROM analytics.fact_sales_transactions"
./mb.py get /api/database/3/metadata
```

Нюанс: WAF отдаёт 403 на User-Agent `Python-urllib`, поэтому mb.py представляется как curl.

## Дашборд

`dashboard.html` — аналитический дашборд на [Bklit UI](https://bklit.com/docs/components)
(React + shadcn + visx): выручка с переключателем недели/месяцы/кварталы и периодом,
MRR и продлеваемость подписок, когорты регистрация→оплата, воронка (FunnelChart),
time-to-value, зависшие платежи, пользователи, продукт, маркетинг.

Исходники приложения — в `app/` (Vite + React TS, компоненты Bklit лежат в
`app/src/components/charts`, серии перекрашены в `app/src/index.css`).
Сборка склеивает всё в один самодостаточный HTML-фрагмент без обёртки
`<html>` (её добавляет вьюер артефактов).

Обновление одной командой:

```bash
./build.sh   # fetch_data.py -> npm run build (app/) -> dashboard.html
```

Смотреть: `python3 serve.py` → http://localhost:8765/dashboard.html.
serve.py отдаёт статику и `POST /api/refresh` — кнопка «Обновить» на дашборде
через него перезапускает fetch_data.py и подтягивает свежие данные из Metabase
без пересборки (после обновления показывается дата/время). В артефакте и при
открытии файла без serve.py кнопка честно сообщает, что обновление недоступно.
`dashboard-v1.html` — прежняя версия на самописном SVG без React, на всякий случай.
Опубликован как артефакт: https://claude.ai/code/artifact/36e255d9-8491-48d0-af0b-c4c834bef5d8

Известные грабли Bklit: режим `stacked` считает ось по максимуму серии, а не суммы
(горизонтальный стек вообще даёт отрицательные ширины) — поэтому «Платёжные методы»
сделаны сгруппированными колонками; локаль дат захардкожена en-US — заменена на ru-RU
в `chart-formatters.ts`; импорт `../components/shimmering-text` в
`chart-loading-label.tsx` поправлен на `../shimmering-text`.

Нюанс данных: `note_folder_creation_events` (43,5 тыс. событий) — автосоздание
дефолтных папок при регистрации (≈11,8 тыс. юзеров, до 17 на человека), в виджет
«Активность в продукте» не включён как системный шум; серия «Заметки» = создание
заметок + теги.

## Схема analytics (26 таблиц)

Основные: `fact_sales_transactions` (продажи), `agg_sales_daily`, `agg_sales_daily_partner`, `agg_users_overview`, `user_referrals`, `referral_links` / `referral_clicks`, `promo_code_usages`, `user_utm_tracking`, плюс таблицы событий (`*_events`).
