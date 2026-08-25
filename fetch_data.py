#!/usr/bin/env python3
"""Собирает агрегаты из Metabase, GA4 и Meta Ads для дашборда -> dashboard_data.json (без PII)."""
import json
from datetime import datetime, timedelta
from pathlib import Path

from mb import request

QUERIES = {
    # --- Выручка и продажи ---
    "sales_daily": """
        SELECT purchase_date::text AS d,
               count(*) AS sales,
               sum(price) AS revenue
        FROM analytics.fact_sales_transactions
        WHERE status = 'success'
        GROUP BY 1 ORDER BY 1""",
    "sales_monthly": """
        SELECT to_char(purchase_date, 'YYYY-MM') AS m,
               count(*) AS sales,
               sum(price) AS revenue,
               count(DISTINCT user_id) AS buyers,
               round(avg(price), 2) AS avg_check
        FROM analytics.fact_sales_transactions
        WHERE status = 'success'
        GROUP BY 1 ORDER BY 1""",
    "sales_by_plan": """
        SELECT plan_name, subs_period, count(*) AS sales, sum(price) AS revenue
        FROM analytics.fact_sales_transactions
        WHERE status = 'success'
        GROUP BY 1, 2 ORDER BY revenue DESC""",
    "sales_by_method": """
        SELECT payment_method,
               count(*) AS attempts,
               count(*) FILTER (WHERE status = 'success') AS success,
               count(*) FILTER (WHERE status = 'failed') AS failed,
               count(*) FILTER (WHERE status = 'pending') AS pending,
               sum(price) FILTER (WHERE status = 'success') AS revenue
        FROM analytics.fact_sales_transactions
        GROUP BY 1 ORDER BY attempts DESC""",
    "sales_by_status": """
        SELECT status, count(*) AS n FROM analytics.fact_sales_transactions
        GROUP BY 1 ORDER BY n DESC""",
    "repeat_purchases": """
        SELECT purchases, count(*) AS users FROM (
            SELECT user_id, count(*) AS purchases
            FROM analytics.fact_sales_transactions
            WHERE status = 'success' GROUP BY 1) t
        GROUP BY 1 ORDER BY 1""",
    # --- Пользователи ---
    "registrations_weekly": """
        SELECT to_char(date_trunc('week', registration_date), 'YYYY-MM-DD') AS w,
               count(*) AS regs
        FROM analytics.agg_users_overview
        WHERE registration_date IS NOT NULL
        GROUP BY 1 ORDER BY 1""",
    "users_summary": """
        SELECT count(*) AS total_users,
               count(*) FILTER (WHERE total_purchases_count > 0) AS payers,
               round(sum(total_spent), 2) AS ltv_total,
               round(avg(total_spent) FILTER (WHERE total_purchases_count > 0), 2) AS arppu
        FROM analytics.agg_users_overview""",
    "plans_current": """
        SELECT coalesce(current_plan_name, 'нет плана') AS plan, count(*) AS users
        FROM analytics.agg_users_overview
        GROUP BY 1 ORDER BY users DESC""",
    "spent_distribution": """
        SELECT CASE
                 WHEN total_spent = 0 THEN '0'
                 WHEN total_spent < 25 THEN '1-24'
                 WHEN total_spent < 50 THEN '25-49'
                 WHEN total_spent < 100 THEN '50-99'
                 WHEN total_spent < 200 THEN '100-199'
                 ELSE '200+'
               END AS bucket, count(*) AS users
        FROM analytics.agg_users_overview
        WHERE total_purchases_count > 0
        GROUP BY 1""",
    # --- Маркетинг ---
    # pending_payers — пользователи источника с зависшей (не проведённой) оплатой;
    # отдельно от converted/revenue, которые считают только успешные оплаты
    "utm_sources": """
        SELECT coalesce(nullif(u.utm_source, ''), '(не задан)') AS source,
               count(*) AS visitors,
               count(u.registration_at) AS regs,
               count(*) FILTER (WHERE u.is_converted) AS converted,
               round(sum(coalesce(u.total_paid, 0)), 2) AS revenue,
               count(DISTINCT t.user_id) FILTER (WHERE t.status = 'pending') AS pending_payers
        FROM analytics.user_utm_tracking u
        LEFT JOIN analytics.fact_sales_transactions t ON t.user_id = u.user_id
        GROUP BY 1 ORDER BY visitors DESC LIMIT 12""",
    # Успешные продажи по месяцам среди пользователей с utm_source = ovva-meta
    # (это и есть трафик Meta Ads) — для KPI-плитки «Оплаты» в разделе Meta Ads
    "meta_utm_sales_monthly": """
        SELECT to_char(date_trunc('month', t.purchase_date), 'YYYY-MM') AS m,
               count(*) AS payments, round(sum(t.price), 2) AS revenue
        FROM analytics.user_utm_tracking u
        JOIN analytics.fact_sales_transactions t ON t.user_id = u.user_id AND t.status = 'success'
        WHERE u.utm_source ILIKE '%ovva%'
        GROUP BY 1 ORDER BY 1""",
    # Зависшие (pending) платежи среди трафика Meta Ads — снапшот, не по месяцам:
    # статус pending не имеет смысла резать по периоду, это текущее состояние
    "meta_utm_pending": """
        SELECT count(*) AS pending, round(sum(t.price), 2) AS amount
        FROM analytics.user_utm_tracking u
        JOIN analytics.fact_sales_transactions t ON t.user_id = u.user_id AND t.status = 'pending'
        WHERE u.utm_source ILIKE '%ovva%'""",
    "referral_totals": """
        SELECT count(*) AS links,
               count(*) FILTER (WHERE is_active) AS active,
               sum(clicks_count) AS clicks,
               sum(registrations_count) AS regs,
               sum(payments_count) AS payments,
               round(sum(total_revenue), 2) AS revenue
        FROM analytics.referral_links""",
    "referral_top": """
        SELECT campaign_name, clicks_count AS clicks,
               registrations_count AS regs, payments_count AS payments,
               total_revenue AS revenue
        FROM analytics.referral_links
        WHERE registrations_count > 0 OR payments_count > 0
        ORDER BY total_revenue DESC, registrations_count DESC LIMIT 10""",
    "promo_usage": """
        SELECT count(*) AS uses FROM analytics.promo_code_usages""",
    # Каталог трафиковых ссылок: UTM (агрегировано по source+medium+campaign,
    # content/term свёрнуты) + активные партнёрские реферальные ссылки.
    # Партнёр обозначается внутренним ID владельца — без персональных данных.
    # cpc и партнёрские ссылки схлопнуты в одну строку каждый — десятки отдельных
    # utm_campaign/ref_code засоряли таблицу; остальные категории (paid,
    # company_profile и т.д.) остаются как были, по одной строке на кампанию.
    "attribution_links": """
        SELECT 'UTM' AS kind,
               coalesce(nullif(utm_medium, ''), '(не задан)') AS category,
               coalesce(nullif(utm_source, ''), '(не задан)') AS partner,
               coalesce(nullif(utm_campaign, ''), '(без кампании)') AS campaign,
               sum(clicks_count) AS clicks,
               sum(registrations_count) AS regs,
               sum(payments_count) AS payments,
               round(sum(coalesce(total_revenue, 0)), 2) AS revenue,
               max(last_seen_at)::date::text AS last_activity
        FROM analytics.utm_parameters
        WHERE NOT (utm_medium = 'cpc' OR (utm_medium = 'paid' AND utm_source ILIKE 'fb'))
        GROUP BY 1, 2, 3, 4
        UNION ALL
        SELECT 'UTM', 'cpc', '(все источники)', 'вся платная реклама Meta (cpc и paid/fb — один канал)',
               sum(clicks_count), sum(registrations_count), sum(payments_count),
               round(sum(coalesce(total_revenue, 0)), 2), max(last_seen_at)::date::text
        FROM analytics.utm_parameters
        WHERE utm_medium = 'cpc' OR (utm_medium = 'paid' AND utm_source ILIKE 'fb')
        UNION ALL
        SELECT 'Партнёрская', 'referral', '(все партнёры)', 'все активные реферальные ссылки',
               sum(clicks_count), sum(registrations_count), sum(payments_count),
               round(sum(coalesce(total_revenue, 0)), 2),
               max(coalesce(last_payment_at, created_at))::date::text
        FROM analytics.referral_links
        WHERE clicks_count > 0 OR registrations_count > 0 OR payments_count > 0
        ORDER BY revenue DESC, regs DESC""",
    # --- Продуктовые события ---
    "events_weekly": """
        WITH ev AS (
            SELECT 'Синк журнала' AS kind, occurred_at FROM analytics.journal_sync_events
            UNION ALL SELECT 'AI-запросы', occurred_at FROM analytics.ai_message_request_events
            UNION ALL SELECT 'Подключение аккаунта', occurred_at FROM analytics.trading_account_connection_events
            UNION ALL SELECT 'Ручные позиции', occurred_at FROM analytics.journal_manual_position_creation_events
            UNION ALL SELECT 'Экспорт XLSX', occurred_at FROM analytics.journal_xlsx_download_events
            -- заметки: создание + теги; папки исключены — автосоздаются при регистрации
            UNION ALL SELECT 'Заметки', occurred_at FROM analytics.note_creation_events
            UNION ALL SELECT 'Заметки', occurred_at FROM analytics.note_tag_creation_events
        )
        SELECT to_char(date_trunc('week', occurred_at), 'YYYY-MM-DD') AS w,
               kind, count(*) AS n
        FROM ev GROUP BY 1, 2 ORDER BY 1""",
    "sync_by_market": """
        SELECT coalesce(market, '(не указан)') AS market, count(*) AS syncs,
               count(DISTINCT user_id) AS users
        FROM analytics.journal_sync_events
        GROUP BY 1 ORDER BY syncs DESC""",
    "connections_by_provider": """
        SELECT provider, count(*) AS connections, count(DISTINCT user_id) AS users
        FROM analytics.trading_account_connection_events
        GROUP BY 1 ORDER BY connections DESC""",
    # Заметки за всю историю (с февраля 2024) — отдельно от прочих событий продукта,
    # у которых трекинг стартовал только в июне 2026. Папки не считаем — системный шум.
    "notes_monthly": """
        SELECT to_char(date_trunc('month', occurred_at), 'YYYY-MM') AS m,
               count(*) AS notes, count(DISTINCT user_id) AS users
        FROM analytics.note_creation_events
        GROUP BY 1 ORDER BY 1""",
    # Сводка по всем событийным таблицам продукта (все фичи, что вообще трекаются).
    # note_folder_creation_events сюда не включаем — автосоздание при регистрации,
    # не действие пользователя, см. README.
    "feature_events_summary": """
        SELECT 'Синк журнала' AS feat, count(*) AS n, count(DISTINCT user_id) AS users
        FROM analytics.journal_sync_events
        UNION ALL SELECT 'Подключение аккаунта', count(*), count(DISTINCT user_id)
        FROM analytics.trading_account_connection_events
        UNION ALL SELECT 'Создание торг. аккаунта', count(*), count(DISTINCT user_id)
        FROM analytics.trading_account_creation_events
        UNION ALL SELECT 'Ручные позиции', count(*), count(DISTINCT user_id)
        FROM analytics.journal_manual_position_creation_events
        UNION ALL SELECT 'Экспорт XLSX', count(*), count(DISTINCT user_id)
        FROM analytics.journal_xlsx_download_events
        UNION ALL SELECT 'AI-запросы', count(*), count(DISTINCT user_id)
        FROM analytics.ai_message_request_events
        UNION ALL SELECT 'Заметки: создание', count(*), count(DISTINCT user_id)
        FROM analytics.note_creation_events
        UNION ALL SELECT 'Заметки: теги', count(*), count(DISTINCT user_id)
        FROM analytics.note_tag_creation_events
        UNION ALL SELECT 'Применение промокода', count(*), count(DISTINCT user_id)
        FROM analytics.promocode_apply_events
        UNION ALL SELECT 'Смена периода в настройках', count(*), count(DISTINCT user_id)
        FROM analytics.settings_overall_period_creation_events
        UNION ALL SELECT 'Управление виджетами', count(*), count(DISTINCT user_id)
        FROM analytics.dashboard_manage_widgets_button_click_events
        UNION ALL SELECT 'Шеринг дневной статистики', count(*), count(DISTINCT user_id)
        FROM analytics.daily_stats_sharing_button_click_events
        UNION ALL SELECT 'Копирование ссылки share', count(*), count(DISTINCT user_id)
        FROM analytics.share_copy_link_button_click_events
        UNION ALL SELECT 'Скачивание share', count(*), count(DISTINCT user_id)
        FROM analytics.share_download_button_click_events
        ORDER BY n DESC""",
    # --- Дневные разрезы для глобального фильтра периода ---
    "pay_attempts_daily": """
        SELECT purchase_date::text AS d, payment_method,
               count(*) FILTER (WHERE status = 'success') AS success,
               count(*) FILTER (WHERE status = 'pending') AS pending,
               count(*) FILTER (WHERE status = 'failed') AS failed
        FROM analytics.fact_sales_transactions
        GROUP BY 1, 2 ORDER BY 1""",
    "plan_daily": """
        SELECT purchase_date::text AS d, plan_name, subs_period,
               count(*) AS sales, sum(price) AS revenue
        FROM analytics.fact_sales_transactions
        WHERE status = 'success'
        GROUP BY 1, 2, 3 ORDER BY 1""",
    # Воронка по месяцу регистрации: шаги — «когда-либо» для юзеров этой когорты
    "funnel_by_month": """
        SELECT to_char(date_trunc('month', u.registration_date), 'YYYY-MM') AS m,
               count(*) AS registered,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM analytics.trading_account_creation_events e WHERE e.user_id = u.user_id)) AS created,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM analytics.trading_account_connection_events e WHERE e.user_id = u.user_id)) AS connected,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM analytics.fact_sales_transactions t
                   WHERE t.user_id = u.user_id AND t.status = 'success')) AS paid
        FROM analytics.agg_users_overview u
        WHERE u.registration_date IS NOT NULL
        GROUP BY 1 ORDER BY 1""",
    # --- Подписочная экономика ---
    # MRR: снапшот активных подписок на конец каждого месяца (для текущего — на сегодня)
    "mrr_monthly": """
        WITH subs AS (
            SELECT purchase_date AS d, subs_period, price
            FROM analytics.fact_sales_transactions
            WHERE status = 'success' AND subs_period IN ('monthly', 'yearly')
        ), months AS (
            SELECT least((date_trunc('month', gs) + interval '1 month' - interval '1 day')::date,
                         CURRENT_DATE) AS me
            FROM generate_series((SELECT date_trunc('month', min(d)) FROM subs),
                                 date_trunc('month', CURRENT_DATE), interval '1 month') gs
        )
        SELECT to_char(me, 'YYYY-MM') AS m,
               count(*) FILTER (WHERE subs_period = 'monthly') AS monthly_subs,
               count(*) FILTER (WHERE subs_period = 'yearly') AS yearly_subs,
               round(sum(CASE WHEN subs_period = 'monthly' THEN price ELSE price / 12 END), 2) AS mrr
        FROM months
        JOIN subs ON subs.d <= me
            AND subs.d + (CASE WHEN subs_period = 'monthly'
                               THEN interval '1 month' ELSE interval '1 year' END) > me
        GROUP BY 1 ORDER BY 1""",
    # Продления: месячная подписка считается продлённой, если тот же юзер успешно
    # оплатил ещё раз в течение 45 дней после покупки
    "renewals_monthly": """
        WITH m AS (
            SELECT user_id, purchase_date AS d
            FROM analytics.fact_sales_transactions
            WHERE status = 'success' AND subs_period = 'monthly'
        )
        SELECT to_char(d + interval '1 month', 'YYYY-MM') AS due_month,
               count(*) AS due,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM analytics.fact_sales_transactions t2
                   WHERE t2.user_id = m.user_id AND t2.status = 'success'
                     AND t2.purchase_date > m.d
                     AND t2.purchase_date <= m.d + interval '45 days'
               )) AS renewed
        FROM m
        WHERE d + interval '1 month' <= CURRENT_DATE
        GROUP BY 1 ORDER BY 1""",
    # Когорты: продажи в fact начинаются с конца ноября 2025, более старые когорты
    # показывать нельзя — их ранние оплаты не попали в таблицу
    "cohort_conversion": """
        WITH fp AS (
            SELECT user_id, min(purchase_date) AS first_pay
            FROM analytics.fact_sales_transactions
            WHERE status = 'success' GROUP BY 1
        )
        SELECT to_char(date_trunc('month', u.registration_date), 'YYYY-MM') AS cohort,
               count(*) AS users,
               count(*) FILTER (WHERE fp.first_pay <= u.registration_date + 7) AS pay7,
               count(*) FILTER (WHERE fp.first_pay <= u.registration_date + 30) AS pay30,
               count(*) FILTER (WHERE fp.first_pay <= u.registration_date + 90) AS pay90,
               count(fp.first_pay) AS pay_ever
        FROM analytics.agg_users_overview u
        LEFT JOIN fp ON fp.user_id = u.user_id
        WHERE u.registration_date >= '2025-11-01'
        GROUP BY 1 ORDER BY 1""",
    "time_to_value": """
        WITH firsts AS (
            SELECT u.user_id, u.registered_at,
                   (SELECT min(occurred_at) FROM analytics.trading_account_creation_events e
                    WHERE e.user_id = u.user_id) AS f_create,
                   (SELECT min(occurred_at) FROM analytics.trading_account_connection_events e
                    WHERE e.user_id = u.user_id) AS f_conn,
                   (SELECT min(occurred_at) FROM analytics.journal_sync_events e
                    WHERE e.user_id = u.user_id) AS f_sync
            FROM analytics.agg_users_overview u
            WHERE u.registered_at IS NOT NULL
        ), fp AS (
            SELECT user_id, min(purchase_date) AS first_pay
            FROM analytics.fact_sales_transactions
            WHERE status = 'success' GROUP BY 1
        )
        SELECT
          round((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM f_create - registered_at) / 86400)
                 FROM firsts WHERE f_create >= registered_at AND registered_at >= '2026-01-01')::numeric, 2) AS med_create_d,
          round((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM f_conn - registered_at) / 86400)
                 FROM firsts WHERE f_conn >= registered_at AND registered_at >= '2026-01-01')::numeric, 2) AS med_conn_d,
          round((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM f_sync - registered_at) / 86400)
                 FROM firsts WHERE f_sync >= registered_at AND registered_at >= '2026-06-15')::numeric, 2) AS med_sync_d,
          (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY fp.first_pay - u.registration_date)
           FROM fp JOIN analytics.agg_users_overview u USING (user_id)
           WHERE fp.first_pay >= u.registration_date AND u.registration_date >= '2025-11-01') AS med_pay_d,
          (SELECT round(100.0 * count(*) FILTER (WHERE f_conn <= registered_at + interval '7 days') / count(*), 1)
           FROM firsts
           WHERE registered_at >= CURRENT_DATE - interval '97 days'
             AND registered_at < CURRENT_DATE - interval '7 days') AS activation7_pct""",
    "stuck_pending": """
        SELECT payment_method, count(*) AS n, round(sum(price), 2) AS amount,
               min(purchase_date)::text AS oldest
        FROM analytics.fact_sales_transactions
        WHERE status = 'pending'
        GROUP BY 1 ORDER BY amount DESC""",
    # --- Воронка ---
    "funnel": """
        SELECT
          (SELECT count(*) FROM analytics.agg_users_overview) AS registered,
          (SELECT count(DISTINCT user_id) FROM analytics.trading_account_creation_events) AS created_account,
          (SELECT count(DISTINCT user_id) FROM analytics.trading_account_connection_events) AS connected,
          (SELECT count(DISTINCT user_id) FROM analytics.journal_sync_events) AS synced,
          (SELECT count(DISTINCT user_id) FROM analytics.fact_sales_transactions WHERE status = 'success') AS paid""",
}


# Начало трекинга GA4 на сайте scope360.io
GA4_START = "2024-04-01"


def _ga4_daily(property_id):
    """date/sessions/totalUsers/screenPageViews -> список дневных строк с датой YYYY-MM-DD."""
    import ga4

    rows = ga4.rows_to_table(ga4.report({
        "dimensions": [{"name": "date"}],
        "metrics": [{"name": "sessions"}, {"name": "totalUsers"}, {"name": "screenPageViews"}],
        "dateRanges": [{"startDate": GA4_START, "endDate": "today"}],
        "orderBys": [{"dimension": {"dimensionName": "date"}}],
        "limit": 100000,
    }, property_id=property_id))
    for r in rows:
        d = datetime.strptime(r["date"], "%Y%m%d").date()
        r["date"] = d.isoformat()
        r["sessions"] = int(r["sessions"])
        r["totalUsers"] = int(r["totalUsers"])
        r["screenPageViews"] = int(r["screenPageViews"])
    return rows


def _bucket_weekly(daily):
    weekly = {}
    for r in daily:
        d = datetime.strptime(r["date"], "%Y-%m-%d").date()
        wk = (d - timedelta(days=d.weekday())).isoformat()  # понедельник, как date_trunc('week') в Postgres
        o = weekly.setdefault(wk, {"w": wk, "sessions": 0, "users": 0, "pageviews": 0})
        o["sessions"] += r["sessions"]
        o["users"] += r["totalUsers"]
        o["pageviews"] += r["screenPageViews"]
    return [weekly[k] for k in sorted(weekly)]


def _bucket_monthly(daily):
    monthly = {}
    for r in daily:
        m = r["date"][:7]
        o = monthly.setdefault(m, {"m": m, "sessions": 0, "users": 0})
        o["sessions"] += r["sessions"]
        o["users"] += r["totalUsers"]
    return [monthly[k] for k in sorted(monthly)]


# Явно нерелевантный трафик для таблицы UTM: dev-окружение и спам-рефереры
# (аномальный users/sessions — типичный паттерн реферального спам-бота в GA4).
UTM_JUNK_SOURCES = {"localhost:5173", "goggle"}
# GA4 сам ставит эти плейсхолдеры, когда параметр не пришёл — не настоящие кампании,
# схлопываем их в один "(не указано)" в рамках одного source×medium.
UTM_AUTO_PLACEHOLDERS = {"(not set)", "(referral)", "(organic)", "(direct)"}
# У этих источников есть отдельная детальная секция дашборда — здесь достаточно
# одной суммарной строки, разбивку по конкретным кампаниям смотреть там.
UTM_SUMMARIZE_SOURCES = {"ovva-meta": "все кампании — см. «Платный трафик (Meta Ads)» выше"}
# Короткие домены-редиректоры, которые непонятны без пояснения
UTM_SOURCE_LABEL = {"t.co": "t.co (ссылки из X/Twitter)"}
# Свои узнаваемые каналы — вместо обезличенного medium ("соцсети", "переход с
# сайта") показываем, что это на самом деле по бизнес-контексту
UTM_CHANNEL_OVERRIDE = {("ig", None): "Instagram Scope", ("youtube", "vlog_to_scope"): "Vlog Man"}


def _channel_override(source, campaign):
    return UTM_CHANNEL_OVERRIDE.get((source, campaign)) or UTM_CHANNEL_OVERRIDE.get((source, None))


def _clean_utm_campaigns(rows):
    grouped = {}
    for r in rows:
        source = r["sessionSource"]
        medium = r["sessionMedium"]
        campaign = r["sessionCampaignName"].replace("+", " ")
        content = r.get("sessionManualAdContent", "(not set)")

        if source in UTM_JUNK_SOURCES:
            continue
        # cpc/meta и ovva-meta/cpc — один и тот же Meta Ads трафик, разошедшийся
        # из-за непоследовательной UTM-разметки на части ссылок
        if source == "cpc" and medium == "meta":
            source, medium = "ovva-meta", "cpc"
        if campaign in UTM_AUTO_PLACEHOLDERS:
            # utm_campaign пуст — берём utm_content, если он содержательный
            # (напр. у Instagram bio-ссылок кампания не проставлена, а content — да)
            campaign = content if content not in UTM_AUTO_PLACEHOLDERS else "(не указано)"
        if source in UTM_SUMMARIZE_SOURCES:
            campaign = UTM_SUMMARIZE_SOURCES[source]
        if source == "bit.ly":
            campaign = "без UTM в ссылке — конкретный источник не определить"
        medium = _channel_override(source, campaign) or medium
        source = UTM_SOURCE_LABEL.get(source, source)

        key = (source, medium, campaign)
        o = grouped.setdefault(key, {
            "sessionSource": source, "sessionMedium": medium, "sessionCampaignName": campaign,
            "sessions": 0, "totalUsers": 0,
        })
        o["sessions"] += int(r["sessions"])
        o["totalUsers"] += int(r["totalUsers"])

    # Сортируем по пользователям, а не по сессиям: у бот/спам-трафика сессий
    # много, а живых людей мало — так реальные каналы всплывают наверх сами.
    return sorted(grouped.values(), key=lambda r: r["totalUsers"], reverse=True)[:18]


def fetch_ga4():
    """Веб-аналитика GA4: лендинг scope360.io (до логина) + приложение (после логина)."""
    import ga4

    landing_daily = _ga4_daily(ga4.PROPERTY_ID)
    app_daily = _ga4_daily(ga4.PROPERTY_ID_APP)

    ga4_channels = ga4.rows_to_table(ga4.report({
        "dimensions": [{"name": "sessionDefaultChannelGroup"}],
        "metrics": [{"name": "sessions"}, {"name": "totalUsers"}, {"name": "engagementRate"}],
        "dateRanges": [{"startDate": GA4_START, "endDate": "today"}],
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
    }))
    for r in ga4_channels:
        r["sessions"] = int(r["sessions"])
        r["totalUsers"] = int(r["totalUsers"])
        r["engagementRate"] = round(float(r["engagementRate"]) * 100, 1)

    ga4_top_pages = ga4.rows_to_table(ga4.report({
        "dimensions": [{"name": "pagePath"}],
        "metrics": [{"name": "screenPageViews"}, {"name": "totalUsers"}],
        "dateRanges": [{"startDate": GA4_START, "endDate": "today"}],
        "orderBys": [{"metric": {"metricName": "screenPageViews"}, "desc": True}],
        "limit": 10,
    }))
    for r in ga4_top_pages:
        r["screenPageViews"] = int(r["screenPageViews"])
        r["totalUsers"] = int(r["totalUsers"])

    # UTM по всем сессиям лендинга (source/medium/campaign читаются GA4 из URL
    # перехода — работает независимо от того, что ссылки идут через bitly:
    # bitly просто редиректит на адрес с уже проставленными utm_* параметрами).
    # Полное покрытие трафика, в отличие от utm_sources в БД (там только 5.6%
    # пользователей — метка пишется в аккаунт лишь при регистрации).
    ga4_utm_campaigns = ga4.rows_to_table(ga4.report({
        "dimensions": [{"name": "sessionSource"}, {"name": "sessionMedium"}, {"name": "sessionCampaignName"},
                       {"name": "sessionManualAdContent"}],
        "metrics": [{"name": "sessions"}, {"name": "totalUsers"}],
        "dateRanges": [{"startDate": GA4_START, "endDate": "today"}],
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
        "limit": 50,
    }))
    ga4_utm_campaigns = _clean_utm_campaigns(ga4_utm_campaigns)

    return {
        "ga4_sessions_weekly": _bucket_weekly(landing_daily),
        "ga4_sessions_monthly": _bucket_monthly(landing_daily),
        "ga4_app_sessions_weekly": _bucket_weekly(app_daily),
        "ga4_app_sessions_monthly": _bucket_monthly(app_daily),
        "ga4_channels": ga4_channels,
        "ga4_top_pages": ga4_top_pages,
        "ga4_utm_campaigns": ga4_utm_campaigns,
    }


# Начало реальных трат в рекламном кабинете Meta
META_START = "2026-03-01"
# Название результата рекламных кампаний (objective = COMPLETE REG)
META_RESULT_ACTION = "complete_registration"
# Второй ключевой ивент пикселя — лиды (обращения), из Events Manager
META_LEAD_ACTION = "lead"


def fetch_meta():
    """Платный трафик Meta Ads: динамика, креативы, гео, плейсменты.

    date_preset=maximum с breakdowns у Meta Insights API нестабилен на длинных
    интервалах (иногда отдаёт нулевой spend) — поэтому для гео/плейсментов
    берём надёжное окно last_90d, а не всю историю.
    """
    import time
    import meta

    def insights_nonzero(*args, account=None, retries=4, **kwargs):
        """Meta Insights иногда отдаёт spend=0/impressions=0 при непустых actions —
        воспроизводимый глюк API на длинных интервалах. Перезапрашиваем.

        account: если задан (dict {"id", "token"}) — запрос только по этому
        кабинету, а не по всем сразу (см. meta.ACCOUNTS)."""
        def _fetch():
            if account:
                return meta.insights(*args, account_id=account["id"], token=account["token"], **kwargs)
            return meta.insights_all_accounts(*args, **kwargs)
        rows = _fetch()
        for _ in range(retries):
            if sum(float(r.get("spend", 0)) for r in rows) > 0 or not rows:
                return rows
            time.sleep(12)
            rows = _fetch()
        return rows

    # Новый активный кабинет (Scope Reserve) — топ креативов считаем только по
    # нему: старый (Scope 360) заблокирован Meta и содержит только историю.
    NEW_ACCOUNT = meta.ACCOUNTS[-1]

    # Внимание: если запросить spend/impressions/clicks и actions ОДНИМ вызовом
    # с time_increment=1 на длинном интервале — Meta воспроизводимо отдаёт
    # spend=impressions=clicks=0 (actions при этом приходят нормально). Баг именно
    # в этой комбинации полей; разносим на два вызова и склеиваем по дате.
    daily_stats_raw = insights_nonzero(["spend", "impressions", "clicks"], date_preset="maximum", time_increment=1)
    daily_actions_raw = insights_nonzero(["actions"], date_preset="maximum", time_increment=1)
    # По нескольким кабинетам на одну дату приходит по строке за кабинет — суммируем
    regs_by_date = {}
    leads_by_date = {}
    for r in daily_actions_raw:
        regs_by_date[r["date_start"]] = regs_by_date.get(r["date_start"], 0) + int(meta.action_value(r, META_RESULT_ACTION))
        leads_by_date[r["date_start"]] = leads_by_date.get(r["date_start"], 0) + int(meta.action_value(r, META_LEAD_ACTION))

    daily_by_date = {}
    for r in daily_stats_raw:
        if r["date_start"] < META_START:
            continue
        o = daily_by_date.setdefault(r["date_start"], {"spend": 0.0, "impressions": 0, "clicks": 0})
        o["spend"] += float(r.get("spend", 0))
        o["impressions"] += int(r.get("impressions", 0))
        o["clicks"] += int(r.get("clicks", 0))
    daily = [
        {"date": d, "spend": round(o["spend"], 2), "impressions": o["impressions"], "clicks": o["clicks"],
         "regs": regs_by_date.get(d, 0), "leads": leads_by_date.get(d, 0)}
        for d, o in sorted(daily_by_date.items())
    ]

    weekly = {}
    monthly = {}
    for r in daily:
        d = datetime.strptime(r["date"], "%Y-%m-%d").date()
        wk = (d - timedelta(days=d.weekday())).isoformat()
        m = r["date"][:7]
        for bucket, key in ((weekly, wk), (monthly, m)):
            o = bucket.setdefault(key, {"spend": 0.0, "impressions": 0, "clicks": 0, "regs": 0, "leads": 0})
            o["spend"] += r["spend"]; o["impressions"] += r["impressions"]
            o["clicks"] += r["clicks"]; o["regs"] += r["regs"]; o["leads"] += r["leads"]
    meta_spend_weekly = [{"w": k, **{kk: round(vv, 2) if kk == "spend" else vv for kk, vv in v.items()}}
                         for k, v in sorted(weekly.items())]
    meta_spend_monthly = [{"m": k, **{kk: round(vv, 2) if kk == "spend" else vv for kk, vv in v.items()}}
                          for k, v in sorted(monthly.items())]

    creatives_raw = insights_nonzero(
        ["ad_id", "ad_name", "campaign_name", "spend", "impressions", "clicks", "actions"],
        level="ad", date_preset="maximum", account=NEW_ACCOUNT,
    )
    creatives = []
    for r in creatives_raw:
        spend = float(r.get("spend", 0))
        regs = int(meta.action_value(r, META_RESULT_ACTION))
        leads = int(meta.action_value(r, META_LEAD_ACTION))
        creatives.append({
            "ad_id": r.get("ad_id"),
            "ad_name": r.get("ad_name", "(без имени)"),
            "campaign_name": r.get("campaign_name", ""),
            "spend": round(spend, 2),
            "impressions": int(r.get("impressions", 0)),
            "clicks": int(r.get("clicks", 0)),
            "regs": regs,
            "leads": leads,
            "cost_per_reg": round(spend / regs, 2) if regs else None,
        })
    creatives = [r for r in creatives if r["regs"] > 0 or r["leads"] > 0]
    creatives.sort(key=lambda r: r["spend"], reverse=True)
    meta_creatives = creatives[:12]
    for r in meta_creatives:
        r["thumbnail_url"] = meta.ad_creative_thumbnail(r["ad_id"], token=NEW_ACCOUNT["token"]) if r["ad_id"] else None

    geo_raw = insights_nonzero(
        ["spend", "impressions", "clicks", "actions"],
        breakdowns=["country"], date_preset="last_90d",
    )
    geo_by_country = {}
    for r in geo_raw:
        o = geo_by_country.setdefault(r.get("country", "??"), {"spend": 0.0, "impressions": 0, "clicks": 0, "regs": 0, "leads": 0})
        o["spend"] += float(r.get("spend", 0))
        o["impressions"] += int(r.get("impressions", 0))
        o["clicks"] += int(r.get("clicks", 0))
        o["regs"] += int(meta.action_value(r, META_RESULT_ACTION))
        o["leads"] += int(meta.action_value(r, META_LEAD_ACTION))
    geo = [{"country": c, "spend": round(o["spend"], 2), "impressions": o["impressions"],
            "clicks": o["clicks"], "regs": o["regs"], "leads": o["leads"]} for c, o in geo_by_country.items()]
    geo.sort(key=lambda r: r["spend"], reverse=True)
    meta_geo = geo  # без обрезки — для карты нужны все страны с рекламой

    # Только платформа (Instagram/Facebook/Threads) — без разбивки по ленте/сторис/рилс
    placement_raw = insights_nonzero(
        ["spend", "impressions", "clicks"],
        breakdowns=["publisher_platform"], date_preset="last_90d",
    )
    PLATFORM_NAMES = {"facebook": "Facebook", "instagram": "Instagram", "threads": "Threads",
                      "messenger": "Messenger", "audience_network": "Audience Network"}
    placement_by_platform = {}
    for r in placement_raw:
        platform = PLATFORM_NAMES.get(r.get("publisher_platform", "?"), r.get("publisher_platform", "?"))
        o = placement_by_platform.setdefault(platform, {"spend": 0.0, "impressions": 0, "clicks": 0})
        o["spend"] += float(r.get("spend", 0))
        o["impressions"] += int(r.get("impressions", 0))
        o["clicks"] += int(r.get("clicks", 0))
    placement = [{"platform": p, "spend": round(o["spend"], 2), "impressions": o["impressions"],
                  "clicks": o["clicks"]} for p, o in placement_by_platform.items()]
    placement.sort(key=lambda r: r["spend"], reverse=True)
    meta_placement = placement

    # Возраст + пол аудитории
    demo_raw = insights_nonzero(
        ["spend", "impressions", "clicks"],
        breakdowns=["age", "gender"], date_preset="last_90d",
    )
    GENDER_NAMES = {"male": "Мужчины", "female": "Женщины", "unknown": "Не указан"}
    demo_by_key = {}
    for r in demo_raw:
        key = (r.get("age", "?"), GENDER_NAMES.get(r.get("gender", "?"), "Не указан"))
        o = demo_by_key.setdefault(key, {"spend": 0.0, "impressions": 0, "clicks": 0})
        o["spend"] += float(r.get("spend", 0))
        o["impressions"] += int(r.get("impressions", 0))
        o["clicks"] += int(r.get("clicks", 0))
    meta_demographics = [
        {"age": age, "gender": gender, "spend": round(o["spend"], 2),
         "impressions": o["impressions"], "clicks": o["clicks"]}
        for (age, gender), o in demo_by_key.items()
    ]
    meta_demographics.sort(key=lambda r: (r["age"], r["gender"]))

    return {
        "meta_spend_weekly": meta_spend_weekly,
        "meta_spend_monthly": meta_spend_monthly,
        "meta_creatives": meta_creatives,
        "meta_geo": meta_geo,
        "meta_placement": meta_placement,
        "meta_demographics": meta_demographics,
    }


def main():
    out = {}
    for name, sql in QUERIES.items():
        d = request("POST", "/api/dataset", {
            "database": 3, "type": "native", "native": {"query": sql},
        })
        if d.get("error"):
            print(f"{name}: ERROR {d['error']}")
            continue
        cols = [c["name"] for c in d["data"]["cols"]]
        out[name] = [dict(zip(cols, r)) for r in d["data"]["rows"]]
        print(f"{name}: {len(out[name])} rows")

    data_path = Path(__file__).with_name("dashboard_data.json")
    try:
        ga4_out = fetch_ga4()
        out.update(ga4_out)
        for name, rows in ga4_out.items():
            print(f"{name}: {len(rows)} rows")
    except Exception as e:
        print(f"GA4: ERROR {e}")
        if data_path.exists():
            prev = json.loads(data_path.read_text())
            for k in ("ga4_sessions_weekly", "ga4_sessions_monthly",
                      "ga4_app_sessions_weekly", "ga4_app_sessions_monthly",
                      "ga4_channels", "ga4_top_pages", "ga4_utm_campaigns"):
                out[k] = prev.get(k, [])

    try:
        meta_out = fetch_meta()
        out.update(meta_out)
        for name, rows in meta_out.items():
            print(f"{name}: {len(rows)} rows")
    except Exception as e:
        print(f"Meta Ads: ERROR {e}")
        if data_path.exists():
            prev = json.loads(data_path.read_text())
            for k in ("meta_spend_weekly", "meta_spend_monthly", "meta_creatives",
                      "meta_geo", "meta_placement", "meta_demographics"):
                out[k] = prev.get(k, [])

    data_path.write_text(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
