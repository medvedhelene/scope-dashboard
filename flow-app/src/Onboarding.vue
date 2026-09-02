<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { Handle, MarkerType, Position, VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

type Section = 'current' | 'target' | 'data'
type NodeKind = 'lane' | 'current' | 'gap' | 'target' | 'decision' | 'event' | 'survey' | 'system' | 'store' | 'sink'
type NodeData = {
  title: string
  subtitle?: string
  kind: NodeKind
  section: Section
  problem?: string
  recommendation?: string
  events?: string
  trigger?: string
  source?: string
}

const nodes = ref<Node<NodeData>[]>([])
const edges = ref<Edge[]>([])
const selected = ref<Node<NodeData> | null>(null)
const activeView = ref<'overview' | Section>('overview')
const { setViewport } = useVueFlow()

const node = (
  id: string,
  x: number,
  y: number,
  title: string,
  kind: NodeKind,
  section: Section,
  subtitle?: string,
  details: Partial<Omit<NodeData, 'title' | 'kind' | 'section' | 'subtitle'>> = {},
  width = kind === 'lane' ? 3020 : 220,
): Node<NodeData> => ({
  id,
  type: 'onboarding',
  position: { x, y },
  data: { title, subtitle, kind, section, ...details },
  style: { width: `${width}px` },
  draggable: kind !== 'lane',
  selectable: kind !== 'lane',
})

const edge = (
  id: string,
  source: string,
  target: string,
  label?: string,
  kind: 'current' | 'gap' | 'target' | 'data' | 'feedback' = 'current',
): Edge => ({
  id,
  source,
  target,
  label,
  type: 'smoothstep',
  markerEnd: MarkerType.ArrowClosed,
  class: `onboarding-edge onboarding-edge--${kind}`,
})

function buildNodes(): Node<NodeData>[] {
  return [
    node('lane-current', 0, 0, '1 · КАК ОНБОРДИНГ РАБОТАЕТ СЕЙЧАС', 'lane', 'current', 'Реальная логика Base → Futures → API. Красным отмечены отсутствующие состояния и события.'),
    node('cur-register', 0, 90, 'Создаёт аккаунт', 'current', 'current', 'API создаёт пользователя', {
      events: 'Факт регистрации определяется по users.created_at; API однократно возвращает is_new_user.',
      source: 'scope360-api · LogInOrRegisterService',
    }),
    node('cur-base-state', 250, 90, 'Проходит локальные шаги Base', 'current', 'current', 'Form → Authentication → Promo → All Set', {
      problem: 'Шаг хранится только в Pinia/ref и теряется после reload, другой вкладки или устройства.',
      source: 'base/store/authStore.js',
    }),
    node('cur-promo', 500, 90, 'Применяет или пропускает промокод', 'current', 'current', 'После действия открывается All Set', {
      events: 'promocode.applied существует только для успешного применения; skip и просмотр шага отдельно не измеряются.',
      source: 'Base + analytics.promocode_apply_events',
    }),
    node('cur-choice', 750, 90, 'Выбирает путь', 'decision', 'current', 'Подключить аккаунт или ручной Journal', {
      problem: 'Выбор не сохраняется как продуктовый onboarding state и не связан с отдельным onboarding_id.',
      source: 'base/components/authorization/AllSet.vue',
    }),
    node('cur-redirect', 1000, 90, 'Переходит в Futures', 'current', 'current', 'initMode=auto или initMode=manual', {
      problem: 'Query-параметр задаёт направление, но не является долговечным состоянием пользователя.',
      source: 'AllSet.vue → Futures URL',
    }),
    node('cur-manager', 1250, 90, 'Открывает Connection Manager', 'current', 'current', 'Free может уйти в Dashboard', {
      problem: 'initMode=auto не гарантирует auto без существующего аккаунта; Free-сценарий прерывает путь.',
      source: 'platformModeStore.js + ConnectionManager.vue',
    }),
    node('cur-provider', 1500, 90, 'Выбирает провайдера', 'current', 'current', 'Например, Bybit', {
      problem: 'Не фиксируются attempt_id, время выбора, открытие инструкции, уход вкладки и возврат.',
      source: 'Futures · connection form',
    }),
    node('cur-connected', 1750, 90, 'Отправляет доступы', 'current', 'current', 'API отвечает успехом или ошибкой', {
      events: 'Серверное событие trading_account.connected есть только после успешного подключения.',
      problem: 'Нет полного набора started / failed / cancelled / retry и нормализованного error_code.',
      source: 'scope360-api · trading_account.connected.v1',
    }),
    node('cur-sync', 2000, 90, 'Ждёт первый sync', 'current', 'current', 'Импорт позиций', {
      events: 'Серверное journal.sync уже существует.',
      problem: 'Нет связи sync с конкретной onboarding-попыткой и нет статуса ожидания для UI.',
      source: 'scope360-api · journal.sync.v1',
    }),
    node('cur-journal', 2250, 90, 'Сам открывает Journal', 'current', 'current', 'После подключения остаётся в Manager', {
      problem: 'Автоматического перехода к первой ценности нет; выход между sync и Journal не измеряется.',
      source: 'Текущая логика Connection Manager',
    }),
    node('cur-value', 2500, 90, 'Видит позиции', 'current', 'current', 'Первая продуктовая ценность', {
      problem: 'Нет first_value_viewed и onboarding.completed, поэтому activation подменяется подключением.',
      source: 'Futures · Journal',
    }),
    node('cur-analytics', 2750, 90, 'Аналитика видит широкий разрыв', 'current', 'current', 'Регистрация → подключение', {
      problem: '78,5% объединяются в одну красную зону: точный шаг, причина и попытка неизвестны.',
      source: 'Текущий dashboard_data.json / userflow',
    }, 270),
    node('cur-manual', 1000, 250, 'Ручная ветка', 'current', 'current', 'Journal → портфель → ручная сделка', {
      problem: 'Открытие ветки и создание портфеля не трекаются; есть только более поздние события ручного аккаунта/позиции.',
      source: 'Futures + analytics event tables',
    }),

    node('gap-new-user', 0, 350, 'MISSING · устойчивый старт', 'gap', 'current', 'is_new_user живёт только в ответе API', {
      recommendation: 'Создавать onboarding_run в момент фактического создания пользователя.',
    }),
    node('gap-state', 250, 350, 'MISSING · persisted state', 'gap', 'current', 'Нельзя восстановить шаг после reload', {
      recommendation: 'GET /auth/onboarding должен возвращать current_stage, path и flow_version.',
    }),
    node('gap-choice', 750, 350, 'MISSING · path_selected', 'gap', 'current', 'Неизвестно, что выбрал пользователь', {
      events: 'onboarding.path_selected',
      recommendation: 'Сохранять connected/manual на сервере, а не только в URL.',
    }),
    node('gap-mode', 1000, 350, 'MISSING · подтверждение входа в ветку', 'gap', 'current', 'initMode и cookie могут расходиться', {
      events: 'onboarding.branch_opened',
      recommendation: 'После загрузки Futures подтвердить реально открывшуюся ветку.',
    }),
    node('gap-free', 1250, 520, 'MISSING · plan_blocked', 'gap', 'current', 'Free → Dashboard без объяснённого исхода', {
      events: 'onboarding.plan_blocked',
      recommendation: 'Фиксировать тариф, показанный блокер и выбранное следующее действие.',
    }),
    node('gap-intent', 1500, 350, 'MISSING · контекст попытки', 'gap', 'current', 'Нет attempt_id и session intent', {
      events: 'provider_selected · docs_opened · tab_hidden · tab_visible · form_started',
      recommendation: 'Одна попытка подключения должна иметь стабильный attempt_id от выбора провайдера до результата.',
    }),
    node('gap-errors', 1750, 350, 'MISSING · ошибки и retry', 'gap', 'current', 'Неясно, почему подключение не завершилось', {
      events: 'connection.attempt_failed · retry_clicked · cancelled',
      recommendation: 'Нормализовать error_code; не отправлять raw error, API key или login.',
    }),
    node('gap-nav', 2250, 350, 'MISSING · переход к ценности', 'gap', 'current', 'Manager → Journal не наблюдается', {
      events: 'journal_opened_after_connection',
      recommendation: 'Добавить CTA/автопереход и измерять его результат.',
    }),
    node('gap-value', 2500, 350, 'MISSING · activation', 'gap', 'current', 'Нет first_value и completed', {
      events: 'onboarding.first_value_viewed · onboarding.completed',
      recommendation: 'Завершать onboarding только после первой ценности, отдельно по connected/manual.',
    }),
    node('gap-blind', 2750, 520, 'MISSING · причина отвала', 'gap', 'current', 'Нет опроса, баг-репорта и ссылки на запись', {
      recommendation: 'Собирать feedback_reason и связывать его с attempt_id и Clarity custom session.',
    }, 270),

    node('lane-target', 0, 720, '2 · ЦЕЛЕВОЙ ONBOARDING И СОБЫТИЯ', 'lane', 'target', 'Сервер восстанавливает прогресс; каждое важное действие связано с onboarding_id и attempt_id.'),
    node('tar-register', 0, 810, 'Регистрация подтверждена', 'target', 'target', 'API создаёт onboarding_run', {
      events: 'onboarding.started',
      recommendation: 'flow_key=initial_activation, flow_version=1.',
    }),
    node('tar-resume', 250, 810, 'Base загружает прогресс', 'target', 'target', 'GET /auth/onboarding', {
      events: 'onboarding.step_viewed',
      recommendation: 'Возвращать пользователя на незавершённый шаг после reload и на другом устройстве.',
    }),
    node('tar-promo', 500, 810, 'Промокод решён', 'target', 'target', 'Применил или пропустил', {
      events: 'onboarding.promo_resolved',
      recommendation: 'reason=applied|skipped; сам код в аналитику не дублировать.',
    }),
    node('tar-path', 750, 810, 'Выбирает путь', 'decision', 'target', 'connected или manual', {
      events: 'onboarding.path_selected',
      recommendation: 'API сохраняет path и время перехода.',
    }),

    node('tar-provider', 1000, 930, 'Выбирает Bybit', 'target', 'target', 'Начинается attempt_id', {
      events: 'onboarding.provider_selected',
      recommendation: 'provider=bybit, attempt_number, source_surface; без credential data.',
    }),
    node('tar-attempt', 1250, 930, 'Готовит доступы', 'target', 'target', 'Инструкция, API keys, permissions', {
      events: 'connection.form_started · connection.docs_opened',
      recommendation: 'Клик по нашей ссылке на Bybit — доказанный сигнал; background вкладки — только косвенный.',
    }),
    node('tar-context', 1500, 930, 'Наблюдаем попытку', 'event', 'target', 'duration + visibility + form activity', {
      events: 'tab_hidden · tab_visible · field_focused · submit_clicked',
      recommendation: 'Считать active_duration и background_duration отдельно; не писать значения полей.',
    }),
    node('tar-result', 1750, 930, 'Результат попытки', 'decision', 'target', 'success или нормализованная ошибка', {
      events: 'connection.attempt_succeeded · connection.attempt_failed',
      recommendation: 'Сервер является источником истины; клиент не объявляет success.',
    }),
    node('tar-connected', 2000, 930, 'Аккаунт подключён', 'target', 'target', 'Серверный milestone', {
      events: 'trading_account.connected',
      recommendation: 'Связать существующее событие с onboarding_id и attempt_id.',
    }),
    node('tar-sync', 2250, 930, 'Первый sync завершён', 'target', 'target', 'Позиции готовы', {
      events: 'onboarding.first_sync_completed',
      recommendation: 'Переиспользовать journal.sync, если он гарантирует успешный первый импорт.',
    }),
    node('tar-value', 2500, 930, 'Показывает первую ценность', 'target', 'target', 'Journal с позициями', {
      events: 'onboarding.first_value_viewed',
      recommendation: 'Фиксировать только после успешного рендера непустого результата.',
    }),
    node('tar-complete', 2750, 930, 'Онбординг завершён', 'target', 'target', 'Activation достигнута', {
      events: 'onboarding.completed',
      recommendation: 'completed_at выставляет API; отдельно хранить path и flow_version.',
    }, 270),

    node('tar-failed', 1750, 1110, 'Ошибка классифицирована', 'event', 'target', 'error_code + retryable + stage', {
      events: 'connection.attempt_failed',
      recommendation: 'Коды: invalid_credentials, permission_missing, provider_unavailable, timeout, rate_limited, unknown.',
    }),
    node('tar-feedback', 2000, 1110, 'Контекстный опрос / баг-репорт', 'survey', 'target', 'Один короткий вопрос', {
      events: 'feedback.prompt_shown · feedback.submitted · bug_report.submitted',
      recommendation: 'Передавать attempt_id, provider, error_code, app_version и Clarity custom session; не передавать ключи.',
    }),
    node('tar-retry', 2250, 1110, 'Повторяет или откладывает', 'target', 'target', 'Новая попытка — новый attempt_id', {
      events: 'connection.retry_clicked · onboarding.deferred',
      recommendation: 'Сохранять связь parent_attempt_id для анализа цепочки повторов.',
    }),
    node('tar-clarity', 2500, 1110, 'Clarity связывает запись', 'event', 'target', 'user_id + attempt_id + tags', {
      events: 'identify(custom user/session) · set(provider, stage, error_code) · event(...) · upgrade(reason)',
      recommendation: 'При ошибке или сильном сигнале фрустрации приоритизировать запись; credential form полностью маскировать.',
      source: 'Microsoft Clarity Client API',
    }, 270),

    node('survey-fast', 1000, 1290, '≤5 сек и закрыл', 'survey', 'target', 'Быстрый отказ после provider_selected', {
      trigger: 'Нет form_started/submit; внутреннее закрытие сразу или возврат в следующей сессии.',
      events: 'connection.quick_exit',
      recommendation: 'Не пытаться показывать modal в beforeunload. Спросить при следующем возвращении: «Что остановило?»',
    }),
    node('survey-away', 1250, 1290, 'Долго был вне вкладки', 'survey', 'target', 'Вероятно искал API keys', {
      trigger: 'tab_hidden после выбора провайдера, затем tab_visible; порог откалибровать по baseline.',
      events: 'connection.external_research_inferred',
      recommendation: 'После возврата: «Удалось найти API-ключи?» Не утверждать, что пользователь открывал Bybit.',
    }),
    node('survey-docs', 1500, 1290, 'Открыл нашу инструкцию, но не отправил', 'survey', 'target', 'Намерение подтверждено кликом', {
      trigger: 'docs_opened=true, затем нет submit в разумное окно.',
      events: 'connection.docs_abandoned',
      recommendation: 'Варианты: не нашёл ключи; не понял permissions; решил позже; выбрал другой provider.',
    }),
    node('survey-error', 1750, 1290, 'Ошибка / rage click / dead click', 'survey', 'target', 'Предложить сообщить о проблеме', {
      trigger: 'Серверный failure или сигнал фрустрации Clarity.',
      events: 'bug_report.opened · bug_report.submitted',
      recommendation: 'Предзаполнить технический контекст и оставить только описание пользователя/согласие отправить.',
    }),
    node('survey-policy', 2000, 1290, 'Правила показа опроса', 'event', 'target', 'Не раздражать и не ломать задачу', {
      trigger: 'Не чаще одного prompt на attempt; cooldown после ответа; не во время ввода или активного submit.',
      recommendation: 'Сначала baseline 2–4 недели, затем калибровать 5 сек / long-away / abandonment окна.',
    }, 450),

    node('tar-manual-account', 1000, 1490, 'Создаёт ручной аккаунт', 'target', 'target', 'Manual-ветка', {
      events: 'onboarding.manual_account_created',
      recommendation: 'Связать существующее trading_account.created с onboarding_id.',
    }),
    node('tar-manual-trade', 1250, 1490, 'Добавляет первую сделку', 'target', 'target', 'Первое действие', {
      events: 'onboarding.first_manual_trade_created',
      recommendation: 'Переиспользовать journal.manual_position_created.',
    }),
    node('tar-manual-value', 1500, 1490, 'Видит позицию в Journal', 'target', 'target', 'Первая ценность manual', {
      events: 'onboarding.first_value_viewed',
    }),
    node('tar-manual-complete', 1750, 1490, 'Manual onboarding completed', 'target', 'target', 'Activation по ручной ветке', {
      events: 'onboarding.completed',
    }, 270),

    node('lane-data', 0, 1730, '3 · ЦЕЛЕВОЙ ПОТОК ДАННЫХ С БЭКЕНДА', 'lane', 'data', 'Продуктовое состояние и аналитика разделены; PostHog, Clarity и Pixel не становятся источником истины.'),
    node('data-client', 0, 1830, 'Base / Futures', 'system', 'data', 'Команды пользователя + UI-сигналы', {
      events: 'path_selected, provider_selected, visibility, docs, feedback',
      recommendation: 'Критические success/failure подтверждает API; UI-сигналы идут через единый tracking adapter.',
    }, 260),
    node('data-api', 320, 1830, 'scope360-api', 'system', 'data', 'Валидирует переход state machine', {
      recommendation: 'Проверяет user ownership, допустимый transition, event_id и expected lock_version.',
    }, 240),
    node('data-tx', 610, 1830, 'Одна DB-транзакция', 'system', 'data', 'Состояние + outbox', {
      recommendation: 'Изменение onboarding state и запись события должны завершиться вместе или откатиться вместе.',
    }, 260),
    node('data-state', 930, 1745, 'user_onboarding_runs', 'store', 'data', 'Текущее восстанавливаемое состояние', {
      recommendation: 'user_id, flow_version, path, current_stage, attempt_id, timestamps, lock_version.',
    }, 240),
    node('data-outbox', 930, 1920, 'outbox_events', 'store', 'data', 'Надёжная доставка event.v1', {
      source: 'Существующий API outbox',
    }, 240),
    node('data-rabbit', 1220, 1920, 'RabbitMQ', 'system', 'data', 'Асинхронная событийная шина', {
      recommendation: 'Retry и idempotency по event_id; продуктовый запрос не ждёт PostHog/Meta.',
    }),
    node('data-sanitize', 1490, 1920, 'Analytics sanitizer', 'system', 'data', 'Allowlist полей и нормализация', {
      problem: 'Доменные события могут содержать email/raw account и не должны форвардиться целиком.',
      recommendation: 'Оставлять user_id, attempt_id, provider, stage, error_code и timestamps. Удалять credentials/PII/raw errors.',
    }, 260),
    node('data-postgres', 1800, 1800, 'analytics.onboarding_events', 'store', 'data', 'Append-only fact для Metabase', {
      recommendation: 'Хранить occurred_at и received_at; не переписывать исторические события.',
    }, 270),
    node('data-posthog', 1800, 1950, 'PostHog', 'sink', 'data', 'Funnels, paths, cohorts, replay', {
      recommendation: 'Server events — authoritative milestones; client events — UX-диагностика.',
    }, 270),
    node('data-meta', 1800, 2100, 'Meta Pixel / CAPI', 'sink', 'data', 'Только ключевые конверсии', {
      events: 'CompleteRegistration · AccountConnected · Activated',
      recommendation: 'Не отправлять туда полный продуктовый event stream.',
    }, 270),
    node('data-aggregate', 2130, 1920, 'Onboarding aggregates', 'system', 'data', 'Step conversion + duration + errors', {
      recommendation: 'Считать только зрелые когорты; добавлять sample_size и data_freshness.',
    }, 260),
    node('data-flow-api', 2440, 1920, 'GET /analytics/onboarding-flow', 'system', 'data', 'Без приватных ключей в браузере', {
      recommendation: 'Возвращать users, drop_rate, median_duration, top_errors, severity и freshness по stable step_id.',
    }, 280),
    node('data-canvas', 2770, 1920, 'onboarding.html', 'sink', 'data', 'Живой canvas подсвечивает проблемы', {
      recommendation: 'Красный только при достаточной выборке и подтверждённом отклонении от baseline.',
    }, 250),
    node('data-feedback', 320, 2130, 'Опрос / баг-репорт', 'system', 'data', 'Причина словами пользователя', {
      events: 'feedback.submitted · bug_report.submitted',
      recommendation: 'Сохранять answer_code, optional comment, attempt_id и clarity_custom_session_id.',
    }, 260),
    node('data-clarity', 650, 2130, 'Microsoft Clarity', 'sink', 'data', 'Запись и UX-сигналы', {
      events: 'identify · set custom tags · event · upgrade',
      recommendation: 'Связать запись с attempt_id; маскировать credential form; запись — диагностика, не бизнес-истина.',
      source: 'Microsoft Learn · Clarity Client API',
    }, 260),
    node('data-privacy', 1220, 2130, 'Privacy boundary', 'event', 'data', 'Никаких API keys, login, token и raw provider payload', {
      recommendation: 'Consent, masking, retention и allowlist должны быть частью acceptance, а не пост-фактум проверкой.',
    }, 530),
  ]
}

function buildEdges(): Edge[] {
  return [
    edge('c-1', 'cur-register', 'cur-base-state'),
    edge('c-2', 'cur-base-state', 'cur-promo'),
    edge('c-3', 'cur-promo', 'cur-choice'),
    edge('c-4', 'cur-choice', 'cur-redirect', 'Подключить'),
    edge('c-5', 'cur-redirect', 'cur-manager'),
    edge('c-6', 'cur-manager', 'cur-provider'),
    edge('c-7', 'cur-provider', 'cur-connected'),
    edge('c-8', 'cur-connected', 'cur-sync'),
    edge('c-9', 'cur-sync', 'cur-journal'),
    edge('c-10', 'cur-journal', 'cur-value'),
    edge('c-11', 'cur-value', 'cur-analytics'),
    edge('c-manual', 'cur-choice', 'cur-manual', 'Ручной'),
    edge('g-1', 'cur-register', 'gap-new-user', undefined, 'gap'),
    edge('g-2', 'cur-base-state', 'gap-state', undefined, 'gap'),
    edge('g-3', 'cur-choice', 'gap-choice', undefined, 'gap'),
    edge('g-4', 'cur-redirect', 'gap-mode', undefined, 'gap'),
    edge('g-5', 'cur-manager', 'gap-free', undefined, 'gap'),
    edge('g-6', 'cur-provider', 'gap-intent', undefined, 'gap'),
    edge('g-7', 'cur-connected', 'gap-errors', undefined, 'gap'),
    edge('g-8', 'cur-journal', 'gap-nav', undefined, 'gap'),
    edge('g-9', 'cur-value', 'gap-value', undefined, 'gap'),
    edge('g-10', 'cur-analytics', 'gap-blind', undefined, 'gap'),

    edge('t-1', 'tar-register', 'tar-resume', undefined, 'target'),
    edge('t-2', 'tar-resume', 'tar-promo', undefined, 'target'),
    edge('t-3', 'tar-promo', 'tar-path', undefined, 'target'),
    edge('t-4', 'tar-path', 'tar-provider', 'Подключить', 'target'),
    edge('t-5', 'tar-provider', 'tar-attempt', undefined, 'target'),
    edge('t-6', 'tar-attempt', 'tar-context', undefined, 'target'),
    edge('t-7', 'tar-context', 'tar-result', undefined, 'target'),
    edge('t-8', 'tar-result', 'tar-connected', 'success', 'target'),
    edge('t-9', 'tar-connected', 'tar-sync', undefined, 'target'),
    edge('t-10', 'tar-sync', 'tar-value', undefined, 'target'),
    edge('t-11', 'tar-value', 'tar-complete', undefined, 'target'),
    edge('t-fail', 'tar-result', 'tar-failed', 'failed', 'feedback'),
    edge('t-feedback', 'tar-failed', 'tar-feedback', undefined, 'feedback'),
    edge('t-retry', 'tar-feedback', 'tar-retry', 'retry / позже', 'feedback'),
    edge('t-clarity', 'tar-feedback', 'tar-clarity', 'session context', 'feedback'),
    edge('t-retry-loop', 'tar-retry', 'tar-provider', 'новая попытка', 'feedback'),
    edge('s-fast', 'tar-provider', 'survey-fast', undefined, 'feedback'),
    edge('s-away', 'tar-attempt', 'survey-away', undefined, 'feedback'),
    edge('s-docs', 'tar-attempt', 'survey-docs', undefined, 'feedback'),
    edge('s-error', 'tar-failed', 'survey-error', undefined, 'feedback'),
    edge('s-policy', 'survey-error', 'survey-policy', undefined, 'feedback'),
    edge('tm-1', 'tar-path', 'tar-manual-account', 'Ручной', 'target'),
    edge('tm-2', 'tar-manual-account', 'tar-manual-trade', undefined, 'target'),
    edge('tm-3', 'tar-manual-trade', 'tar-manual-value', undefined, 'target'),
    edge('tm-4', 'tar-manual-value', 'tar-manual-complete', undefined, 'target'),

    edge('d-1', 'data-client', 'data-api', 'command', 'data'),
    edge('d-2', 'data-api', 'data-tx', 'validated transition', 'data'),
    edge('d-state', 'data-tx', 'data-state', 'snapshot', 'data'),
    edge('d-outbox', 'data-tx', 'data-outbox', 'event.v1', 'data'),
    edge('d-resume', 'data-state', 'data-client', 'GET resume state', 'target'),
    edge('d-3', 'data-outbox', 'data-rabbit', undefined, 'data'),
    edge('d-4', 'data-rabbit', 'data-sanitize', undefined, 'data'),
    edge('d-5', 'data-sanitize', 'data-postgres', undefined, 'data'),
    edge('d-6', 'data-sanitize', 'data-posthog', undefined, 'data'),
    edge('d-7', 'data-sanitize', 'data-meta', 'selected conversions', 'data'),
    edge('d-8', 'data-postgres', 'data-aggregate', undefined, 'data'),
    edge('d-9', 'data-posthog', 'data-aggregate', undefined, 'data'),
    edge('d-10', 'data-aggregate', 'data-flow-api', undefined, 'data'),
    edge('d-11', 'data-flow-api', 'data-canvas', 'poll / refresh', 'data'),
    edge('d-feedback-1', 'data-client', 'data-feedback', undefined, 'feedback'),
    edge('d-feedback-2', 'data-feedback', 'data-api', 'feedback event', 'feedback'),
    edge('d-clarity-1', 'data-client', 'data-clarity', 'UI recording', 'feedback'),
    edge('d-clarity-2', 'data-clarity', 'data-feedback', 'custom session id', 'feedback'),
    edge('d-privacy', 'data-sanitize', 'data-privacy', 'allowlist', 'feedback'),
  ]
}

const viewports = {
  overview: { x: 54, y: 52, zoom: 0.27 },
  current: { x: 48, y: 132, zoom: 0.42 },
  target: { x: 48, y: -155, zoom: 0.38 },
  data: { x: 48, y: -570, zoom: 0.4 },
}

async function focus(view: keyof typeof viewports) {
  activeView.value = view
  selected.value = null
  await nextTick()
  await setViewport(viewports[view], { duration: 420 })
}

function onNodeClick(event: { node: Node<NodeData> }) {
  if (event.node.data.kind !== 'lane') selected.value = event.node
}

function miniMapColor(item: Node) {
  const kind = item.data?.kind as NodeKind | undefined
  if (kind === 'gap') return '#fecaca'
  if (kind === 'target') return '#99f6e4'
  if (kind === 'survey' || kind === 'event') return '#dbeafe'
  if (kind === 'store' || kind === 'system' || kind === 'sink') return '#cbd5e1'
  return '#bfdbfe'
}

function kindLabel(kind: NodeKind) {
  const labels: Record<NodeKind, string> = {
    lane: 'Раздел',
    current: 'Текущий шаг',
    gap: 'Missing gap',
    target: 'Целевой шаг',
    decision: 'Развилка',
    event: 'Рекомендуемая аналитика',
    survey: 'Триггер опроса',
    system: 'Сервис',
    store: 'Хранилище',
    sink: 'Потребитель данных',
  }
  return labels[kind]
}

const gapCount = computed(() => nodes.value.filter(item => item.data.kind === 'gap').length)

onMounted(async () => {
  nodes.value = buildNodes()
  edges.value = buildEdges()
  await focus('overview')
})
</script>

<template>
  <main class="app-shell onboarding-page">
    <header class="topbar onboarding-topbar">
      <div>
        <div class="eyebrow">Scope360 · архитектура activation</div>
        <h1>Onboarding</h1>
        <p>Текущее поведение, missing gaps, целевой flow, события и движение данных.</p>
      </div>
      <div class="topbar-actions onboarding-links">
        <a class="button button--quiet" href="/">Дашборд</a>
        <a class="button button--quiet" href="/userflow.html">Userflow</a>
      </div>
    </header>

    <div class="onboarding-toolbar">
      <div class="onboarding-summary">
        <strong>{{ gapCount }}</strong> missing gaps
        <span>·</span>
        <strong>3</strong> схемы на одном холсте
        <span>·</span>
        события и пороги — предложения для калибровки
      </div>
      <div class="onboarding-view-buttons" aria-label="Навигация по холсту">
        <button class="button button--quiet" :class="{ 'button--active': activeView === 'overview' }" type="button" @click="focus('overview')">Обзор</button>
        <button class="button button--quiet" :class="{ 'button--active': activeView === 'current' }" type="button" @click="focus('current')">Сейчас</button>
        <button class="button button--quiet" :class="{ 'button--active': activeView === 'target' }" type="button" @click="focus('target')">Цель</button>
        <button class="button button--quiet" :class="{ 'button--active': activeView === 'data' }" type="button" @click="focus('data')">Данные</button>
      </div>
    </div>

    <section class="flow-shell onboarding-canvas" aria-label="Onboarding architecture canvas">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :min-zoom="0.18"
        :max-zoom="1.6"
        :nodes-draggable="true"
        :nodes-connectable="false"
        :elements-selectable="true"
        class="scope-flow onboarding-flow"
        @node-click="onNodeClick"
      >
        <template #node-onboarding="props">
          <div class="onboarding-node" :class="[`onboarding-node--${props.data.kind}`, `onboarding-node--${props.data.section}`]">
            <Handle v-if="props.data.kind !== 'lane'" type="target" :position="Position.Left" />
            <div v-if="props.data.kind === 'gap'" class="onboarding-node-kicker">Missing gap</div>
            <div v-else-if="props.data.kind === 'survey'" class="onboarding-node-kicker onboarding-node-kicker--proposal">Триггер опроса</div>
            <div v-else-if="props.data.kind === 'event'" class="onboarding-node-kicker onboarding-node-kicker--proposal">Аналитика / правило</div>
            <div class="onboarding-node-title">{{ props.data.title }}</div>
            <div v-if="props.data.subtitle" class="onboarding-node-subtitle">{{ props.data.subtitle }}</div>
            <Handle v-if="props.data.kind !== 'lane'" type="source" :position="Position.Right" />
          </div>
        </template>

        <Background pattern-color="#d7dde5" :gap="24" :size="1" />
        <MiniMap :node-color="miniMapColor" node-stroke-color="#64748b" mask-color="rgba(248,250,252,.78)" pannable zoomable />
        <Controls position="bottom-left" />
      </VueFlow>

      <aside v-if="selected" class="details-panel onboarding-details" aria-live="polite">
        <button class="panel-close" type="button" aria-label="Закрыть детали" @click="selected = null">×</button>
        <div class="panel-label" :class="{ 'panel-label--critical': selected.data.kind === 'gap' }">
          {{ kindLabel(selected.data.kind) }}
        </div>
        <h2>{{ selected.data.title }}</h2>
        <p v-if="selected.data.subtitle">{{ selected.data.subtitle }}</p>
        <dl>
          <template v-if="selected.data.problem">
            <dt>Проблема</dt>
            <dd>{{ selected.data.problem }}</dd>
          </template>
          <template v-if="selected.data.events">
            <dt>События / поля</dt>
            <dd>{{ selected.data.events }}</dd>
          </template>
          <template v-if="selected.data.trigger">
            <dt>Когда срабатывать</dt>
            <dd>{{ selected.data.trigger }}</dd>
          </template>
          <template v-if="selected.data.recommendation">
            <dt>Рекомендация</dt>
            <dd>{{ selected.data.recommendation }}</dd>
          </template>
          <template v-if="selected.data.source">
            <dt>Источник</dt>
            <dd>{{ selected.data.source }}</dd>
          </template>
        </dl>
      </aside>

      <div class="legend onboarding-legend" aria-label="Легенда">
        <span><i class="legend-current"></i> сейчас</span>
        <span><i class="legend-gap"></i> missing gap</span>
        <span><i class="legend-target"></i> целевое состояние</span>
        <span><i class="legend-proposal"></i> событие / опрос</span>
        <span><i class="legend-data"></i> поток данных</span>
      </div>
    </section>

    <footer>
      Background вкладки показывает потерю фокуса, но не доказывает открытие Bybit. Значения полей, API keys, login, tokens и raw provider payload не должны попадать в PostHog, Clarity, Pixel или баг-репорт.
    </footer>
  </main>
</template>

<style scoped>
.onboarding-page { min-height: 100vh; }
.onboarding-topbar { align-items: center; }
.onboarding-links { flex-shrink: 0; }
.onboarding-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 16px 0 8px; }
.onboarding-summary { color: #64748b; font-size: 12px; }
.onboarding-summary strong { color: #111827; }
.onboarding-summary span { margin: 0 4px; }
.onboarding-view-buttons { display: flex; gap: 6px; }
.onboarding-view-buttons .button { padding: 7px 10px; }
.onboarding-view-buttons .button--active { border-color: #111827; background: #111827; color: #fff; }
.onboarding-canvas { height: calc(100vh - 190px); min-height: 720px; margin-top: 0; }

:deep(.vue-flow__node-onboarding) { border: 0; background: transparent; box-shadow: none; }
:deep(.vue-flow__node-onboarding.selected .onboarding-node:not(.onboarding-node--lane)) { box-shadow: 0 0 0 3px rgba(37, 99, 235, .15); }
:deep(.vue-flow__handle) { width: 7px; height: 7px; border: 1px solid #fff; background: #64748b; }

.onboarding-node { min-height: 96px; display: flex; flex-direction: column; justify-content: center; border: 1.5px solid #94a3b8; border-radius: 10px; background: #fff; padding: 14px; color: #111827; text-align: center; }
.onboarding-node--current { border-color: #2563eb; background: #eff6ff; }
.onboarding-node--decision { border-color: #475569; background: #f8fafc; }
.onboarding-node--gap { min-height: 116px; border: 2px solid #dc2626; background: #fef2f2; color: #991b1b; }
.onboarding-node--target { border-color: #0f766e; background: #f0fdfa; }
.onboarding-node--event,
.onboarding-node--survey { min-height: 116px; border: 1.5px dashed #475569; background: #f8fafc; }
.onboarding-node--system,
.onboarding-node--store,
.onboarding-node--sink { border-color: #64748b; background: #f8fafc; }
.onboarding-node--store { border-width: 2px; border-radius: 22px; }
.onboarding-node--sink { border-color: #0f766e; }
.onboarding-node--lane { min-height: 48px; align-items: flex-start; border: 0; border-bottom: 1px solid #cbd5e1; border-radius: 0; background: transparent; padding: 0 0 10px; color: #0f172a; text-align: left; }
.onboarding-node--lane .onboarding-node-title { font-size: 17px; letter-spacing: .035em; }
.onboarding-node--lane .onboarding-node-subtitle { max-width: 1000px; font-size: 12px; }
.onboarding-node-kicker { margin-bottom: 5px; color: #dc2626; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.onboarding-node-kicker--proposal { color: #475569; }
.onboarding-node-title { font-size: 14px; font-weight: 700; line-height: 1.25; }
.onboarding-node-subtitle { margin-top: 5px; color: #64748b; font-size: 11px; line-height: 1.35; }
.onboarding-node--gap .onboarding-node-subtitle { color: #991b1b; }

:deep(.onboarding-edge .vue-flow__edge-path) { stroke-width: 2; }
:deep(.onboarding-edge--current .vue-flow__edge-path) { stroke: #64748b; }
:deep(.onboarding-edge--gap .vue-flow__edge-path) { stroke: #dc2626; stroke-dasharray: 6 5; }
:deep(.onboarding-edge--target .vue-flow__edge-path) { stroke: #0f766e; }
:deep(.onboarding-edge--data .vue-flow__edge-path) { stroke: #334155; }
:deep(.onboarding-edge--feedback .vue-flow__edge-path) { stroke: #475569; stroke-dasharray: 4 4; }
:deep(.vue-flow__edge-text) { fill: #475569; font-size: 11px; }
:deep(.vue-flow__edge-textbg) { fill: #fff; }

.onboarding-details { width: min(370px, calc(100% - 28px)); max-height: calc(100% - 28px); overflow-y: auto; }
.onboarding-details dd { white-space: pre-line; }
.onboarding-legend i { width: 12px; height: 9px; }
.onboarding-legend .legend-current { border-color: #2563eb; background: #eff6ff; }
.onboarding-legend .legend-gap { border: 2px solid #dc2626; background: #fef2f2; }
.onboarding-legend .legend-target { border-color: #0f766e; background: #f0fdfa; }
.onboarding-legend .legend-proposal { border: 1px dashed #475569; background: #f8fafc; }
.onboarding-legend .legend-data { border-color: #64748b; background: #e2e8f0; }

@media (max-width: 900px) {
  .onboarding-topbar { align-items: flex-start; }
  .onboarding-toolbar { align-items: flex-start; flex-direction: column; }
  .onboarding-canvas { height: 720px; }
}

@media (max-width: 520px) {
  .onboarding-view-buttons { width: 100%; overflow-x: auto; }
  .onboarding-view-buttons .button { flex: 1; }
  .onboarding-summary { line-height: 1.5; }
}
</style>
