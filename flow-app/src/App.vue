<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { VueFlow, Handle, Position, MarkerType, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

type FeatureRow = { feat: string; n: number; users: number }
type FunnelRow = { m: string; registered: number; connected: number }
type PaymentRow = { payment_method: string; success: number; pending: number; failed: number }
type PosthogFunnelStep = { name: string; count: number; median_conversion_sec: number | null }
type PosthogEvent = { event: string; name: string; count: number }
type PosthogActivity = { dau: number; wau: number; mau: number }
type AnalyticsData = {
  time_to_value?: Array<{ med_sync_d?: number; activation7_pct?: number }>
  feature_events_summary?: FeatureRow[]
  funnel_by_month?: FunnelRow[]
  pay_attempts_daily?: PaymentRow[]
  stuck_pending?: Array<{ n: number; amount: number }>
  posthog_funnel?: PosthogFunnelStep[]
  posthog_events?: PosthogEvent[]
  posthog_activity?: PosthogActivity
}
type FlowMetrics = {
  activation7: number
  connectionDrop7: number
  recentConnectionRate: number
  syncMinutes: number
  manualUsers: number
  overpayFailureRate: number
  overpayFailed: number
  overpayAttempts: number
  pendingCount: number
  pendingAmount: number
  accountUsers: number
}
type NodeData = {
  title: string
  subtitle?: string
  evidence?: string
  source?: string
  kind: 'action' | 'screen' | 'decision' | 'blocker' | 'solution' | 'lane'
  branch: 'common' | 'connected' | 'manual' | 'payment' | 'engagement'
}

const EMPTY_METRICS: FlowMetrics = {
  activation7: 0,
  connectionDrop7: 0,
  recentConnectionRate: 0,
  syncMinutes: 0,
  manualUsers: 0,
  overpayFailureRate: 0,
  overpayFailed: 0,
  overpayAttempts: 0,
  pendingCount: 0,
  pendingAmount: 0,
  accountUsers: 0,
}

const nodes = ref<Node<NodeData>[]>([])
const edges = ref<Edge[]>([])
const metrics = ref<FlowMetrics>(EMPTY_METRICS)
const posthogFunnel = ref<PosthogFunnelStep[]>([])
const posthogEvents = ref<PosthogEvent[]>([])
const posthogCounts = ref<Record<string, number>>({})
const posthogActivity = ref<PosthogActivity | null>(null)
const selected = ref<Node<NodeData> | null>(null)
const loading = ref(true)
const loadError = ref('')
const loadedAt = ref<Date | null>(null)
const sourceModifiedAt = ref<Date | null>(null)
const autoRefresh = ref(true)
let timer: number | undefined

const { setViewport } = useVueFlow()
const fmtPct = (value: number) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
const fmtMoney = (value: number) => `$${Math.round(value).toLocaleString('ru-RU')}`
const fmtDate = (value: Date | null) => value
  ? value.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—'
const fmtDuration = (sec: number | null) => {
  if (sec == null) return '—'
  if (sec < 90) return `${Math.round(sec)} сек`
  if (sec < 3600) return `${Math.round(sec / 60)} мин`
  return `${(sec / 3600).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч`
}

function deriveMetrics(data: AnalyticsData): FlowMetrics {
  const tv = data.time_to_value?.[0]
  const activation7 = Number(tv?.activation7_pct ?? 0)
  const recent = (data.funnel_by_month ?? []).slice(-4)
  const recentRegistered = recent.reduce((sum, row) => sum + Number(row.registered || 0), 0)
  const recentConnected = recent.reduce((sum, row) => sum + Number(row.connected || 0), 0)
  const manual = (data.feature_events_summary ?? []).find(row => row.feat === 'Ручные позиции')
  const accountUsers = Number((data.feature_events_summary ?? []).find(row => row.feat === 'Подключение аккаунта')?.users ?? 0)
  const overpay = (data.pay_attempts_daily ?? [])
    .filter(row => row.payment_method === 'overpay')
    .reduce((acc, row) => ({
      success: acc.success + Number(row.success || 0),
      pending: acc.pending + Number(row.pending || 0),
      failed: acc.failed + Number(row.failed || 0),
    }), { success: 0, pending: 0, failed: 0 })
  const overpayAttempts = overpay.success + overpay.pending + overpay.failed
  const pending = (data.stuck_pending ?? []).reduce((acc, row) => ({
    count: acc.count + Number(row.n || 0),
    amount: acc.amount + Number(row.amount || 0),
  }), { count: 0, amount: 0 })

  return {
    activation7,
    connectionDrop7: Math.max(0, 100 - activation7),
    recentConnectionRate: recentRegistered ? recentConnected / recentRegistered * 100 : 0,
    syncMinutes: Number(tv?.med_sync_d ?? 0) * 24 * 60,
    manualUsers: Number(manual?.users ?? 0),
    overpayFailureRate: overpayAttempts ? overpay.failed / overpayAttempts * 100 : 0,
    overpayFailed: overpay.failed,
    overpayAttempts,
    pendingCount: pending.count,
    pendingAmount: pending.amount,
    accountUsers,
  }
}

const node = (
  id: string,
  x: number,
  y: number,
  title: string,
  kind: NodeData['kind'],
  branch: NodeData['branch'],
  subtitle?: string,
  evidence?: string,
  source?: string,
): Node<NodeData> => ({ id, type: 'product', position: { x, y }, data: { title, kind, branch, subtitle, evidence, source } })

function buildNodes(m: FlowMetrics, ph: Record<string, number>): Node<NodeData>[] {
  const connectionIsCritical = m.connectionDrop7 >= 60
  const paymentIsCritical = m.overpayFailureRate >= 40 || m.pendingCount >= 10
  const dropEvidence = `${fmtPct(m.connectionDrop7)} не подключили аккаунт за 7 дней; ` +
    `по последним четырём месячным когортам подключились ${fmtPct(m.recentConnectionRate)}. ` +
    `Красный порог: ≥60% без подключения.`
  // PostHog считает клики/действия, а не только завершённые события из БД —
  // подписываем узлы, где это реально измерено, отдельной меткой источника.
  // % считаем от пользователей с подключённым аккаунтом (Metabase,
  // feature_events_summary) — это не «доля юзеров, сделавших действие»
  // (PostHog отдаёт события, не уникальных людей), а грубая интенсивность
  // относительно всей базы с аккаунтом.
  const pctOfAccounts = (count: number) => m.accountUsers ? `${fmtPct(count / m.accountUsers * 100)} от юзеров с аккаунтом` : null
  const ph30 = (event: string) => ph[event] != null
    ? `${ph[event].toLocaleString('ru-RU')} за 30 дней · ${pctOfAccounts(ph[event]) ?? '—'}`
    : null
  // Группа мелких событий одной темы -> заголовочная цифра (топ события) на
  // карточке + полная раскладка по каждому событию в панели деталей.
  const phGroup = (events: Array<[string, string]>) => {
    const rows = events.map(([ev, label]) => ({ ev, label, count: ph[ev] ?? 0 })).sort((a, b) => b.count - a.count)
    const top = rows[0]
    return {
      subtitle: top ? `${top.label}: ${top.count.toLocaleString('ru-RU')} за 30 дней · ${pctOfAccounts(top.count) ?? '—'}` : undefined,
      evidence: rows.map(r => `${r.label} — ${r.count.toLocaleString('ru-RU')} (${pctOfAccounts(r.count) ?? '—'})`).join('; '),
    }
  }
  return [
    node('lane-common', 0, 190, 'ОБЩИЙ ПУТЬ', 'lane', 'common'),
    node('signup', 0, 245, 'Создаёт аккаунт', 'action', 'common', `Email или Google · ${ph30('$identify') ?? '—'}`, 'Единственная точка «Общего пути», которую видит PostHog — дальше до открытия приложения (nav_tab_selected) события не идут.', 'PostHog · $identify'),
    node('confirm', 250, 245, 'Подтверждает вход', 'action', 'common', 'Код / Google / 2FA · нет данных PostHog', 'Слепая зона трекинга: между регистрацией и открытием приложения шаги не инструментированы.', undefined),
    node('session', 500, 245, 'Получает сессию', 'screen', 'common', 'нет данных PostHog'),
    node('promo', 750, 245, 'Промокод', 'action', 'common', 'Применить или пропустить · нет данных PostHog'),
    node('all-set', 1000, 245, 'All Set', 'screen', 'common', 'Trial запущен · нет данных PostHog'),
    node('choose-path', 1250, 245, 'Выбирает действие', 'decision', 'common', 'Подключить аккаунт или ручной журнал · нет данных PostHog', 'Выбор ветки не трекается отдельным событием — видно только по следующему шагу (connect-cta / manual-cta).'),

    node('lane-connected', 1570, 0, 'ПОДКЛЮЧЕННЫЙ АККАУНТ', 'lane', 'connected'),
    node('connect-cta', 1570, 55, 'Нажимает «Подключить»', 'action', 'connected', ph30('trading_account_add_clicked') ?? undefined, 'Клики по CTA «Подключить аккаунт», без разбивки на завершённые подключения.', ph30('trading_account_add_clicked') ? 'PostHog · trading_account_add_clicked' : undefined),
    node('connection-manager', 1820, 55, 'Connection Manager', 'screen', 'connected', 'Открывается с initMode=auto'),
    node('plan-check', 2070, 55, 'Проверка тарифа', 'decision', 'connected', 'Free или платный'),
    node('add-account', 2320, 55, 'Добавляет аккаунт', 'action', 'connected', ph30('api_connect_cta_clicked') ?? undefined, 'Клики по CTA подключения API/провайдера.', ph30('api_connect_cta_clicked') ? 'PostHog · api_connect_cta_clicked' : undefined),
    node('provider-auth', 2570, 55, 'Провайдер и доступы', 'action', 'connected', 'API key / login / wallet'),
    node('connected', 2820, 55, 'Аккаунт подключён', 'screen', 'connected', `${fmtPct(m.activation7)} новых пользователей ≤7 дней`, dropEvidence, 'time_to_value.activation7_pct + funnel_by_month'),
    node('sync', 3070, 55, 'Импорт / первый sync', 'screen', 'connected', `≈${Math.round(m.syncMinutes)} мин среди дошедших`, 'Медиана считается только среди пользователей, достигших sync.', 'time_to_value.med_sync_d'),
    node('manager-stays', 3320, 55, 'Остаётся в Manager', 'screen', 'connected'),
    node('open-journal', 3570, 55, 'Сам открывает Journal', 'action', 'connected'),
    node('positions', 3820, 55, 'Видит позиции', 'screen', 'connected', ph30('trade_opened') ? `Получает первую ценность · ${ph30('trade_opened')}` : 'Получает первую ценность', 'Клики «Открыть сделку» по всем пользователям, не только новым.', ph30('trade_opened') ? 'PostHog · trade_opened' : undefined),

    node('drop-zone', 2320, 230, connectionIsCritical ? 'Главная зона потенциального отвала' : 'Зона подключения', connectionIsCritical ? 'blocker' : 'screen', 'connected', `${fmtPct(m.connectionDrop7)} не доходят до подключения ≤7 дней`, `${dropEvidence} Промежуточные события не трекаются, поэтому точная точка внутри участка неизвестна.`, 'time_to_value.activation7_pct'),
    node('mode-blocker', 1820, 390, 'Режим может остаться manual', 'blocker', 'connected', 'Без существующего auto-аккаунта initMode=auto не гарантирует Connected mode.', 'Подтверждено текущей логикой приложения.', 'код Base/Futures'),
    node('free-blocker', 2070, 390, 'Free → Dashboard', 'blocker', 'connected', 'Пользователь может покинуть сценарий подключения.', 'Доля затронутых новых пользователей не измеряется.', 'код Connection Manager'),
    node('onboarding-state-solution', 2570, 390, 'Сохранять состояние онбординга', 'solution', 'connected', 'registered → path_selected → provider_selected → credentials_submitted → connected → first_value → completed', 'Сохранять onboarding_path, provider, error_code и время входа/завершения каждого состояния. Это позволит в реальном времени локализовать отвал на конкретном действии, а не на всём участке подключения.', 'Потенциальное решение · ещё не реализовано'),
    node('nav-blocker', 3320, 390, 'Нет перехода в Journal', 'blocker', 'connected', 'После подключения пользователь остаётся в Connection Manager.', 'Нужен самостоятельный дополнительный переход.', 'код Connection Manager'),

    node('lane-manual', 1570, 650, 'РУЧНОЙ ЖУРНАЛ', 'lane', 'manual'),
    node('manual-cta', 1570, 705, 'Нажимает «Ручной журнал»', 'action', 'manual'),
    node('manual-journal', 1820, 705, 'Пустой Journal', 'screen', 'manual', 'initMode=manual'),
    node('create-portfolio', 2070, 705, 'Создаёт портфель', 'action', 'manual', ph30('portfolio_created') ?? undefined, 'Портфелей реально создано за период — сравните с кликами по «Ручной журнал» слева, отвал внутри ветки виден напрямую.', ph30('portfolio_created') ? 'PostHog · portfolio_created' : undefined),
    node('manual-account', 2320, 705, 'Ручной аккаунт создан', 'screen', 'manual'),
    node('add-trade', 2570, 705, 'Добавляет сделку', 'action', 'manual'),
    node('save-trade', 2820, 705, 'Сохраняет сделку', 'action', 'manual', ph30('manual_trade_added') ?? undefined, 'Сделок добавлено вручную за период.', ph30('manual_trade_added') ? 'PostHog · manual_trade_added' : undefined),
    node('manual-value', 3070, 705, 'Позиция в Journal', 'screen', 'manual', `${m.manualUsers.toLocaleString('ru-RU')} пользователей создавали ручные позиции`, 'Нет событий открытия ветки и создания портфеля — локальный drop-off не рассчитывается.', 'feature_events_summary'),
    node('copy-blocker', 1820, 900, 'Empty state ведёт к API', 'blocker', 'manual', 'Текст «Подключить API» противоречит выбранному manual-сценарию.', 'Подтверждено текущим экраном Journal.', 'код Journal'),

    node('lane-payment', 3370, 650, 'ПОЗЖЕ: ОПЛАТА', 'lane', 'payment'),
    node('payment-attempt', 3370, 705, 'Пробует оплатить', 'action', 'payment', 'После trial'),
    node('payment-result', 3620, 705, 'Результат платежа', 'decision', 'payment'),
    node('payment-success', 3870, 705, 'Оплата успешна', 'screen', 'payment'),
    node('payment-blocker', 3620, 900, paymentIsCritical ? 'Проблема оплаты' : 'Оплата без критичного сигнала', paymentIsCritical ? 'blocker' : 'screen', 'payment', `Overpay: ${m.overpayFailed} из ${m.overpayAttempts} failed (${fmtPct(m.overpayFailureRate)})`, `${m.pendingCount} pending на ${fmtMoney(m.pendingAmount)}. Красный порог: ≥40% failed или ≥10 pending. Это downstream-блокер, не часть 7-дневной activation.`, 'pay_attempts_daily + stuck_pending'),

    // Дальше: всё, что PostHog видит после первой ценности — 39 оставшихся
    // событий, сгруппированных по темам (иначе на карте было бы 39 карточек
    // с единичными числами). $set и $web_vitals не показаны отдельно — это
    // техническая телеметрия (свойства пользователя, производительность),
    // не действие в интерфейсе.
    node('lane-engagement', 4300, -320, 'ДАЛЬШЕ: ЗАЛУЧЕНІСТЬ (POSTHOG)', 'lane', 'engagement'),
    node('continues-using', 4050, 380, 'Продолжает пользоваться', 'screen', 'engagement', 'Все действия ниже — за 30 дней, по всем пользователям'),

    node('eng-settings', 4300, -260, 'Настройки и профиль', 'screen', 'engagement',
      phGroup([['settings_tab_selected', 'Открыл вкладку настроек'], ['platform_setting_updated', 'Изменил настройку платформы'],
        ['risk_rule_updated', 'Обновил risk-правило'], ['workspace_switched', 'Переключил workspace'],
        ['profile_field_updated', 'Изменил поле профиля'], ['external_auth_credentials_managed', 'Управлял внешними credentials'],
        ['notification_preference_toggled', 'Переключил уведомления'], ['settings_empty_state_cta_clicked', 'Клик по пустому состоянию настроек'],
        ['profile_picture_updated', 'Обновил аватар']]).subtitle,
      phGroup([['settings_tab_selected', 'Открыл вкладку настроек'], ['platform_setting_updated', 'Изменил настройку платформы'],
        ['risk_rule_updated', 'Обновил risk-правило'], ['workspace_switched', 'Переключил workspace'],
        ['profile_field_updated', 'Изменил поле профиля'], ['external_auth_credentials_managed', 'Управлял внешними credentials'],
        ['notification_preference_toggled', 'Переключил уведомления'], ['settings_empty_state_cta_clicked', 'Клик по пустому состоянию настроек'],
        ['profile_picture_updated', 'Обновил аватар']]).evidence, 'PostHog · 9 событий (settings_*, profile_*, workspace_switched, external_auth_credentials_managed)'),

    node('eng-dashboard', 4300, -100, 'Дашборд и календарь', 'screen', 'engagement',
      phGroup([['calendar_day_viewed', 'Открыл день в календаре'], ['date_range_selected', 'Выбрал диапазон дат'],
        ['data_refreshed', 'Обновил данные вручную'], ['calendar_month_navigated', 'Пролистал месяц'],
        ['dashboard_widget_view_toggled', 'Переключил вид виджета'], ['dashboard_layout_toggled', 'Изменил layout дашборда'],
        ['dashboard_widgets_managed', 'Настроил набор виджетов']]).subtitle,
      phGroup([['calendar_day_viewed', 'Открыл день в календаре'], ['date_range_selected', 'Выбрал диапазон дат'],
        ['data_refreshed', 'Обновил данные вручную'], ['calendar_month_navigated', 'Пролистал месяц'],
        ['dashboard_widget_view_toggled', 'Переключил вид виджета'], ['dashboard_layout_toggled', 'Изменил layout дашборда'],
        ['dashboard_widgets_managed', 'Настроил набор виджетов']]).evidence, 'PostHog · 7 событий (calendar_*, dashboard_*, date_range_selected, data_refreshed)'),

    node('eng-journal-ui', 4300, 60, 'Журнал: настройка вида', 'screen', 'engagement',
      phGroup([['journal_view_mode_changed', 'Сменил режим просмотра'], ['journal_mode_switched', 'Переключил режим журнала'],
        ['journal_summary_toggled', 'Показал/скрыл summary'], ['journal_filters_opened', 'Открыл фильтры'],
        ['journal_column_added', 'Добавил колонку']]).subtitle,
      phGroup([['journal_view_mode_changed', 'Сменил режим просмотра'], ['journal_mode_switched', 'Переключил режим журнала'],
        ['journal_summary_toggled', 'Показал/скрыл summary'], ['journal_filters_opened', 'Открыл фильтры'],
        ['journal_column_added', 'Добавил колонку']]).evidence, 'PostHog · 5 событий (journal_*)'),

    node('eng-trade-detail', 4300, 220, 'Детали сделок', 'screen', 'engagement',
      phGroup([['trade_detail_block_added', 'Добавил блок в детали сделки'], ['manual_trade_creation_started', 'Начал создание сделки'],
        ['trade_template_selected', 'Выбрал шаблон сделки'], ['trade_detail_column_added', 'Добавил колонку в детали']]).subtitle,
      phGroup([['trade_detail_block_added', 'Добавил блок в детали сделки'], ['manual_trade_creation_started', 'Начал создание сделки'],
        ['trade_template_selected', 'Выбрал шаблон сделки'], ['trade_detail_column_added', 'Добавил колонку в детали']]).evidence, 'PostHog · 4 события (trade_detail_*, trade_template_selected, manual_trade_creation_started)'),

    node('eng-notes', 4300, 380, 'Заметки', 'screen', 'engagement',
      phGroup([['note_block_added', 'Добавил блок в заметку'], ['note_created', 'Создал заметку'],
        ['note_tag_created', 'Создал тег'], ['note_folder_created', 'Создал папку заметок']]).subtitle,
      phGroup([['note_block_added', 'Добавил блок в заметку'], ['note_created', 'Создал заметку'],
        ['note_tag_created', 'Создал тег'], ['note_folder_created', 'Создал папку заметок']]).evidence, 'PostHog · 4 события (note_*)'),

    node('eng-ai', 4300, 540, 'AI-ассистент', 'screen', 'engagement',
      phGroup([['ai_chat_opened', 'Открыл AI-чат'], ['ai_message_sent', 'Отправил сообщение AI']]).subtitle,
      phGroup([['ai_chat_opened', 'Открыл AI-чат'], ['ai_message_sent', 'Отправил сообщение AI']]).evidence,
      'PostHog · 2 события (ai_chat_opened, ai_message_sent)'),

    node('eng-growth', 4300, 700, 'Рост и шеринг', 'screen', 'engagement',
      phGroup([['content_shared', 'Поделился контентом'], ['app_store_link_clicked', 'Клик по ссылке на app store']]).subtitle,
      phGroup([['content_shared', 'Поделился контентом'], ['app_store_link_clicked', 'Клик по ссылке на app store']]).evidence,
      'PostHog · 2 события (content_shared, app_store_link_clicked)'),

    node('eng-friction', 4300, 860,
      (ph['$dead_click'] ?? 0) >= 200 ? 'UX-трение: мёртвые клики' : 'UX-трение',
      (ph['$dead_click'] ?? 0) >= 200 ? 'blocker' : 'screen', 'engagement',
      `Мёртвые клики: ${(ph['$dead_click'] ?? 0).toLocaleString('ru-RU')} (${pctOfAccounts(ph['$dead_click'] ?? 0) ?? '—'}) · свайпы: ${(ph['$dead_swipe'] ?? 0).toLocaleString('ru-RU')}`,
      'Клики/свайпы без реакции интерфейса — автозахват PostHog ($dead_click, $dead_swipe). Не привязаны к конкретному экрану без доп. разбивки по pathname.',
      'PostHog · $dead_click, $dead_swipe'),

    node('eng-churn-risk', 4300, 1000, 'Запросы на удаление аккаунта', 'blocker', 'engagement',
      `${(ph['account_deletion_requested'] ?? 0).toLocaleString('ru-RU')} за 30 дней · ${pctOfAccounts(ph['account_deletion_requested'] ?? 0) ?? '—'}`,
      'Явный сигнал оттока — стоит трекать причину рядом с этим событием (сейчас не собирается).',
      'PostHog · account_deletion_requested'),
  ]
}

const edge = (id: string, source: string, target: string, label?: string, blocker = false): Edge => ({
  id,
  source,
  target,
  label,
  type: 'smoothstep',
  markerEnd: MarkerType.ArrowClosed,
  class: blocker ? 'flow-edge flow-edge--blocker' : 'flow-edge',
})

function buildEdges(): Edge[] {
  return [
    edge('e-signup-confirm', 'signup', 'confirm'),
    edge('e-confirm-session', 'confirm', 'session'),
    edge('e-session-promo', 'session', 'promo'),
    edge('e-promo-allset', 'promo', 'all-set'),
    edge('e-allset-choose', 'all-set', 'choose-path'),
    edge('e-choose-connect', 'choose-path', 'connect-cta', 'Подключить'),
    edge('e-connect-manager', 'connect-cta', 'connection-manager'),
    edge('e-manager-plan', 'connection-manager', 'plan-check'),
    edge('e-plan-add', 'plan-check', 'add-account', 'не Free'),
    edge('e-add-provider', 'add-account', 'provider-auth'),
    edge('e-provider-connected', 'provider-auth', 'connected'),
    edge('e-connected-sync', 'connected', 'sync'),
    edge('e-sync-manager', 'sync', 'manager-stays'),
    edge('e-manager-journal', 'manager-stays', 'open-journal'),
    edge('e-journal-positions', 'open-journal', 'positions'),
    edge('e-drop-provider', 'drop-zone', 'provider-auth', undefined, metrics.value.connectionDrop7 >= 60),
    {
      ...edge('e-drop-solution', 'drop-zone', 'onboarding-state-solution', 'Локализовать отвал'),
      class: 'flow-edge flow-edge--solution',
    },
    edge('e-mode-manager', 'mode-blocker', 'connection-manager', undefined, true),
    edge('e-free-plan', 'free-blocker', 'plan-check', 'Free', true),
    edge('e-nav-manager', 'nav-blocker', 'manager-stays', undefined, true),
    edge('e-choose-manual', 'choose-path', 'manual-cta', 'Ручной'),
    edge('e-manual-journal', 'manual-cta', 'manual-journal'),
    edge('e-journal-portfolio', 'manual-journal', 'create-portfolio'),
    edge('e-portfolio-account', 'create-portfolio', 'manual-account'),
    edge('e-account-trade', 'manual-account', 'add-trade'),
    edge('e-add-save', 'add-trade', 'save-trade'),
    edge('e-save-value', 'save-trade', 'manual-value'),
    edge('e-copy-journal', 'copy-blocker', 'manual-journal', undefined, true),
    edge('e-value-payment', 'manual-value', 'payment-attempt', 'позже'),
    edge('e-payment-result', 'payment-attempt', 'payment-result'),
    edge('e-result-success', 'payment-result', 'payment-success'),
    edge('e-payment-problem', 'payment-blocker', 'payment-result', undefined, metrics.value.overpayFailureRate >= 40 || metrics.value.pendingCount >= 10),

    edge('e-positions-continues', 'positions', 'continues-using'),
    edge('e-manualvalue-continues', 'manual-value', 'continues-using'),
    edge('e-continues-settings', 'continues-using', 'eng-settings'),
    edge('e-continues-dashboard', 'continues-using', 'eng-dashboard'),
    edge('e-continues-journal-ui', 'continues-using', 'eng-journal-ui'),
    edge('e-continues-trade-detail', 'continues-using', 'eng-trade-detail'),
    edge('e-continues-notes', 'continues-using', 'eng-notes'),
    edge('e-continues-ai', 'continues-using', 'eng-ai'),
    edge('e-continues-growth', 'continues-using', 'eng-growth'),
    edge('e-continues-friction', 'continues-using', 'eng-friction', undefined, (posthogCounts.value['$dead_click'] ?? 0) >= 200),
    edge('e-continues-churn', 'continues-using', 'eng-churn-risk', undefined, true),
  ]
}

function preservePositions(next: Node<NodeData>[]) {
  const current = new Map(nodes.value.map(item => [item.id, item.position]))
  return next.map(item => ({ ...item, position: current.get(item.id) ?? item.position }))
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 1): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if (retries <= 0) throw error
    await new Promise(resolve => window.setTimeout(resolve, 1500))
    return fetchWithRetry(url, init, retries - 1)
  }
}

async function loadData(silent = false) {
  if (!silent) loading.value = true
  loadError.value = ''
  try {
    // Без ?t=Date.now() — cache: 'no-store' уже гарантирует свежий запрос,
    // а вечно меняющийся query-параметр некоторые блокировщики рекламы
    // ошибочно принимают за трекинг-пиксель и режут запрос целиком.
    const response = await fetchWithRetry('/dashboard_data.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json() as AnalyticsData
    const nextMetrics = deriveMetrics(data)
    metrics.value = nextMetrics
    posthogFunnel.value = data.posthog_funnel ?? []
    posthogEvents.value = data.posthog_events ?? []
    posthogCounts.value = Object.fromEntries(posthogEvents.value.map(e => [e.event, e.count]))
    posthogActivity.value = data.posthog_activity ?? null
    nodes.value = preservePositions(buildNodes(nextMetrics, posthogCounts.value))
    edges.value = buildEdges()
    loadedAt.value = new Date()
    const modified = response.headers.get('last-modified')
    sourceModifiedAt.value = modified ? new Date(modified) : null
    if (selected.value) selected.value = nodes.value.find(item => item.id === selected.value?.id) ?? null
  } catch (error) {
    loadError.value = `Не удалось прочитать dashboard_data.json: ${error instanceof Error ? error.message : 'ошибка'}`
  } finally {
    loading.value = false
  }
}

async function focusStart() {
  await nextTick()
  setViewport({ x: 55, y: 125, zoom: 0.62 })
}

function onNodeClick(event: { node: Node<NodeData> }) {
  if (event.node.data.kind !== 'lane') selected.value = event.node
}

const blockerCount = computed(() => nodes.value.filter(item => item.data.kind === 'blocker').length)

const posthogFunnelWithPct = computed(() => {
  const first = posthogFunnel.value[0]?.count || 0
  return posthogFunnel.value.map(step => ({ ...step, pct: first ? step.count / first * 100 : 0 }))
})
const posthogTopEvents = computed(() => [...posthogEvents.value]
  .filter(e => e.event !== '$identify') // регистрация — не действие внутри приложения, показана в воронке выше
  .sort((a, b) => b.count - a.count).slice(0, 10))
const posthogEventsMax = computed(() => Math.max(1, ...posthogTopEvents.value.map(e => e.count)))

onMounted(async () => {
  await loadData()
  await focusStart()
  timer = window.setInterval(() => {
    if (autoRefresh.value) void loadData(true)
  }, 60_000)
})

onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">Scope360 · аналитика продукта</div>
        <h1>Userflow после регистрации</h1>
        <p>Живая карта activation: действия, реальные переходы и потенциальные точки отвала.</p>
      </div>
      <div class="topbar-actions">
        <a class="button button--quiet" href="/">К дашборду</a>
        <a class="button button--quiet" href="/onboarding.html">Onboarding</a>
        <button class="button" type="button" :disabled="loading" @click="loadData(false)">
          {{ loading ? 'Обновляю…' : 'Перечитать данные' }}
        </button>
      </div>
    </header>

    <section class="metrics" aria-label="Ключевые показатели userflow">
      <article>
        <span>Подключили аккаунт ≤7 дней</span>
        <strong>{{ fmtPct(metrics.activation7) }}</strong>
      </article>
      <article class="metric-critical">
        <span>Не дошли до подключения ≤7 дней</span>
        <strong>{{ fmtPct(metrics.connectionDrop7) }}</strong>
      </article>
      <article>
        <span>Первый sync среди дошедших</span>
        <strong>≈{{ Math.round(metrics.syncMinutes) }} мин</strong>
      </article>
      <article>
        <span>Красных зон на карте</span>
        <strong>{{ blockerCount }}</strong>
      </article>
    </section>

    <section v-if="posthogFunnelWithPct.length" class="posthog-section" aria-label="PostHog: путь к первому трейду">
      <h2>PostHog: путь к первому трейду <span class="posthog-badge">факт кликов, 30 дней</span></h2>
      <div v-if="posthogActivity" class="posthog-activity">
        <div class="posthog-activity-tile"><span>DAU</span><strong>{{ posthogActivity.dau }}</strong></div>
        <div class="posthog-activity-tile"><span>WAU</span><strong>{{ posthogActivity.wau }}</strong></div>
        <div class="posthog-activity-tile"><span>MAU</span><strong>{{ posthogActivity.mau }}</strong></div>
        <div class="posthog-activity-note">по «открыл раздел приложения» (nav_tab_selected) — на сегодня</div>
      </div>
      <div class="posthog-funnel">
        <div v-for="(step, i) in posthogFunnelWithPct" :key="step.name" class="posthog-funnel-step">
          <div class="posthog-funnel-bar-track">
            <div class="posthog-funnel-bar" :style="{ width: step.pct + '%' }"></div>
          </div>
          <div class="posthog-funnel-label">
            <span>{{ step.name }}</span>
            <strong>{{ step.count }}</strong>
            <span class="posthog-funnel-pct">{{ fmtPct(step.pct) }}</span>
          </div>
          <div v-if="i > 0" class="posthog-funnel-time">медиана до этого шага: {{ fmtDuration(step.median_conversion_sec) }}</div>
        </div>
      </div>
      <h3>Топ-10 действий в приложении (30 дней) <span class="posthog-badge">из {{ posthogEvents.length }} событий — остальные на карте ниже</span></h3>
      <div class="posthog-events">
        <div v-for="ev in posthogTopEvents" :key="ev.event" class="posthog-event-row">
          <span class="posthog-event-name">{{ ev.name }}</span>
          <div class="posthog-event-bar-track">
            <div class="posthog-event-bar" :style="{ width: (ev.count / posthogEventsMax * 100) + '%' }"></div>
          </div>
          <span class="posthog-event-count">{{ ev.count }}</span>
        </div>
      </div>
    </section>

    <div class="status-row">
      <span class="live-dot" aria-hidden="true"></span>
      <span>Автообновление раз в минуту</span>
      <label class="switch">
        <input v-model="autoRefresh" type="checkbox">
        <span>{{ autoRefresh ? 'включено' : 'выключено' }}</span>
      </label>
      <span class="status-separator">Источник изменён: {{ fmtDate(sourceModifiedAt) }}</span>
      <span>Перечитан: {{ fmtDate(loadedAt) }}</span>
      <span v-if="loadError" class="status-error">{{ loadError }}</span>
    </div>

    <section class="flow-shell" aria-label="Интерактивный userflow">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :min-zoom="0.2"
        :max-zoom="1.6"
        :nodes-draggable="true"
        :nodes-connectable="false"
        :elements-selectable="true"
        class="scope-flow"
        @node-click="onNodeClick"
      >
        <template #node-product="props">
          <div class="flow-node" :class="[`flow-node--${props.data.kind}`, `flow-node--${props.data.branch}`]">
            <Handle v-if="props.data.kind !== 'lane'" type="target" :position="Position.Left" />
            <div v-if="props.data.kind === 'blocker'" class="node-kicker">Потенциальный блокер</div>
            <div v-if="props.data.kind === 'solution'" class="node-kicker node-kicker--solution">Потенциальное решение</div>
            <div v-if="props.data.source?.startsWith('PostHog')" class="node-source-badge">PostHog</div>
            <div class="node-title">{{ props.data.title }}</div>
            <div v-if="props.data.subtitle" class="node-subtitle">{{ props.data.subtitle }}</div>
            <Handle v-if="props.data.kind !== 'lane'" type="source" :position="Position.Right" />
          </div>
        </template>

        <Background pattern-color="#d7dde5" :gap="24" :size="1" />
        <MiniMap node-color="#cbd5e1" node-stroke-color="#64748b" mask-color="rgba(248,250,252,.78)" pannable zoomable />
        <Controls position="bottom-left" />
      </VueFlow>

      <aside v-if="selected" class="details-panel" aria-live="polite">
        <button class="panel-close" type="button" aria-label="Закрыть детали" @click="selected = null">×</button>
        <div class="panel-label" :class="{ 'panel-label--critical': selected.data.kind === 'blocker' }">
          {{ selected.data.kind === 'blocker' ? 'Потенциальный блокер' : selected.data.kind === 'solution' ? 'Потенциальное решение' : 'Шаг userflow' }}
        </div>
        <h2>{{ selected.data.title }}</h2>
        <p v-if="selected.data.subtitle">{{ selected.data.subtitle }}</p>
        <dl>
          <template v-if="selected.data.evidence">
            <dt>Что известно</dt>
            <dd>{{ selected.data.evidence }}</dd>
          </template>
          <template v-if="selected.data.source">
            <dt>Источник</dt>
            <dd>{{ selected.data.source }}</dd>
          </template>
          <dt>Ветка</dt>
          <dd>{{ selected.data.branch }}</dd>
        </dl>
      </aside>

      <div class="legend" aria-label="Легенда">
        <span><i class="legend-action"></i> действие</span>
        <span><i class="legend-screen"></i> экран / результат</span>
        <span><i class="legend-blocker"></i> потенциальный блокер</span>
        <span><i class="legend-solution"></i> потенциальное решение</span>
      </div>
    </section>

    <footer>
      Красное означает потенциальную проблему, подтверждённую агрегатами или текущей логикой продукта. Data-пороги: ≥60% без подключения; ≥40% failed или ≥10 pending. Причинность не доказана; manual-ветка не входит в метрику подключения.
    </footer>
  </main>
</template>
