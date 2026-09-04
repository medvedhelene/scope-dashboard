import { useMemo, useState, type ReactNode } from 'react'
import DATA from './data.json'
import { BarChart } from '@/components/charts/bar-chart'
import { Bar } from '@/components/charts/bar'
import { BarXAxis } from '@/components/charts/bar-x-axis'
import { BarYAxis } from '@/components/charts/bar-y-axis'
import { AreaChart } from '@/components/charts/area-chart'
import { Area } from '@/components/charts/area'
import { XAxis } from '@/components/charts/x-axis'
import { YAxis } from '@/components/charts/y-axis'
import { Grid } from '@/components/charts/grid'
import { ChartTooltip } from '@/components/charts/tooltip'
import { FunnelChart } from '@/components/charts/funnel-chart'
import { WorldSpendMap } from '@/components/charts/world-spend-map'

declare const __BUILT_AT__: string

type Row = Record<string, any>
type Range = [string | null, string | null]

const CalendarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)
const RefreshIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" />
  </svg>
)
const fmtDT = (d: Date) => d.toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

// ---------- форматирование ----------
const fmtN = (n: number) => Math.round(n).toLocaleString('ru-RU')
const fmtM = (n: number) => '$' + Math.round(n).toLocaleString('ru-RU')
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MEDIUM_LABEL: Row = {
  cpc: 'платная реклама', organic: 'органика', referral: 'переход с сайта',
  social: 'соцсети', '(none)': 'прямой заход', '(not set)': 'не определено',
}
const mediumLabel = (m: string) => MEDIUM_LABEL[m] ?? m
// Короткое пояснение «что это» для источников, которые не говорят сами за себя
const utmExplain = (source: string, campaign: string): string | null => {
  if (source === '(direct)') return 'Нет referrer и UTM: прямой заход, репост в мессенджере или потерянная метка'
  if (source === 'ovva-meta') return 'Вся платная реклама Meta (Facebook+Instagram) — детали в «Платный трафик»'
  if (source === 'ig') return 'Переход по ссылке в шапке профиля (link in bio) Instagram Scope'
  if (source.startsWith('t.co')) return 'Клик по ссылке из твита/ретвита в X (Twitter) — UTM не сохранился'
  if (source === 'youtube' && campaign === 'vlog_to_scope') return 'Видео у блогера Vlog Man с упоминанием Scope360'
  if (source === 'google') return 'Обычная органическая выдача Google'
  if (source === 'bing') return 'Обычная органическая выдача Bing'
  if (source === '(not set)') return 'GA4 не смог определить источник перехода'
  if (source.includes('instagram.com')) return 'Переход из Instagram (сторис, посты, директ)'
  if (source.includes('facebook.com')) return 'Переход из Facebook (посты, группы, репосты)'
  if (source === 'yandex.ru') return 'Органическая выдача Яндекса'
  if (source === 'x') return 'Платная реклама в X (Twitter)'
  return null
}
const mLabel = (m: string) => MONTHS[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4)
const wLabel = (w: string) => +w.slice(8) + ' ' + MONTHS[+w.slice(5, 7) - 1] + ' ' + w.slice(2, 4)
const comma = (s: string | number) => String(s).replace('.', ',')
const shiftDays = (iso: string, days: number) => {
  const dt = new Date(iso + 'T00:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}
const TODAY = new Date().toISOString().slice(0, 10)
const MIN_DATE = '2024-03-01'

const TABS = [
  { id: 'kpi', label: 'Ключевые показатели' },
  { id: 'users', label: 'Пользователи и продукт' },
  { id: 'marketing', label: 'Маркетинг' },
  { id: 'ads', label: 'Платный трафик' },
  { id: 'conclusions', label: 'Выводы' },
  { id: 'subscriptions', label: 'Подписки' },
] as const

const inRange = (d: string, [f, t]: Range) => (!f || d >= f) && (!t || d <= t)
const monthInRange = (m: string, [f, t]: Range) => (!f || m >= f.slice(0, 7)) && (!t || m <= t.slice(0, 7))
// неделя попадает, если пересекается с периодом
const weekInRange = (w: string, [f, t]: Range) => (!f || w >= shiftDays(f, -6)) && (!t || w <= t)

// цвета серий — из темы; статусы — фиксированные
const C = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)']
const GOOD = '#16a34a'
const WARN = '#f59e0b'
const CRIT = '#dc2626'

// ---------- каркас ----------
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3.5 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function Card({ title, note, wide, right, stretch, children }: {
  title: string; note?: string; wide?: boolean; right?: ReactNode; stretch?: boolean; children: ReactNode
}) {
  return (
    <div className={'min-w-0 rounded-xl border border-border bg-card text-card-foreground p-4 pb-5 '
      + (wide ? 'md:col-span-2 ' : '') + (stretch ? 'flex flex-col' : '')}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        {right}
      </div>
      {stretch ? <div className="min-h-0 flex-1">{children}</div> : children}
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground px-4 py-3">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[26px] font-semibold leading-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded-r-xl border-l-[3px] bg-card text-sm text-muted-foreground px-4 py-2.5"
      style={{ borderLeftColor: WARN }}>
      {children}
    </div>
  )
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

// ---------- плитка креатива с превью по наведению ----------
function CreativeTile({ r }: { r: Row }) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3"
      onMouseEnter={e => r.thumbnail_url && setHover({ x: e.clientX, y: e.clientY })}
      onMouseMove={e => setHover(h => (h ? { x: e.clientX, y: e.clientY } : h))}
      onMouseLeave={() => setHover(null)}>
      <div className="truncate text-[13px] font-semibold" title={r.ad_name}>{r.ad_name}</div>
      <div className="truncate text-[11px] text-muted-foreground" title={r.campaign_name}>{r.campaign_name}</div>
      <div className="mt-2 space-y-1 text-[12.5px]">
        <div className="flex justify-between"><span className="text-muted-foreground">расходы</span><b>{fmtM(r.spend)}</b></div>
        <div className="flex justify-between"><span className="text-muted-foreground">регистраций</span><b>{fmtN(r.regs)}</b></div>
        {r.leads > 0 && (
          <div className="flex justify-between"><span className="text-muted-foreground">лидов</span><b>{fmtN(r.leads)}</b></div>
        )}
        <div className="flex justify-between"><span className="text-muted-foreground">цена рег.</span>
          <b>{r.cost_per_reg != null ? '$' + comma(r.cost_per_reg) : '—'}</b></div>
      </div>
      {hover && r.thumbnail_url && (
        <div className="pointer-events-none fixed z-30 rounded-lg border border-border bg-card p-1.5 shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <img src={r.thumbnail_url} alt={r.ad_name} className="h-40 w-40 rounded-md object-cover" />
        </div>
      )}
    </div>
  )
}

function EmptyNote() {
  return <p className="py-10 text-center text-sm text-muted-foreground">Нет данных за выбранный период.</p>
}

// ---------- глобальный фильтр периода ----------
function FilterBar({ preset, setPreset, from, setFrom, to, setTo }: {
  preset: string; setPreset: (v: string) => void
  from: string; setFrom: (v: string) => void
  to: string; setTo: (v: string) => void
}) {
  const opt = (v: string, name: ReactNode, label?: string) => (
    <button type="button" onClick={() => setPreset(v)} aria-pressed={preset === v}
      aria-label={label} title={label}
      className={'px-3 py-1.5 text-[13px] transition-colors ' +
        (preset === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
      {name}
    </button>
  )
  return (
    <div className="sticky top-0 z-20 -mx-6 mt-6 border-y border-border bg-background/95 px-6 py-2.5 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[13px] font-medium text-muted-foreground">Период</span>
        <div className="flex overflow-hidden rounded-lg border border-border [&>button+button]:border-l [&>button+button]:border-border">
          {opt('all', 'Всё время')}{opt('365', 'Год')}{opt('90', '90 дней')}{opt('30', '30 дней')}{opt('custom', <CalendarIcon />, 'Свой период')}
        </div>
        {preset === 'custom' && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <input type="date" value={from} min={MIN_DATE} max={TODAY} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-border bg-card px-2 py-1 text-[13px] text-foreground" />
            —
            <input type="date" value={to} min={MIN_DATE} max={TODAY} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-border bg-card px-2 py-1 text-[13px] text-foreground" />
          </span>
        )}
      </div>
    </div>
  )
}

// ---------- виджет выручки ----------
type Gran = 'week' | 'month' | 'quarter'

function RevenueCard({ range, daily }: { range: Range; daily: Row[] }) {
  const [gran, setGran] = useState<Gran>('month')

  const rows = useMemo(() => {
    const key = (d: string) => {
      if (gran === 'month') return d.slice(0, 7)
      if (gran === 'quarter') return d.slice(0, 4) + '-Q' + (Math.floor((+d.slice(5, 7) - 1) / 3) + 1)
      return shiftDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7))
    }
    const label = (k: string) =>
      gran === 'month' ? mLabel(k)
        : gran === 'quarter' ? 'Q' + k.slice(6) + ' ' + k.slice(2, 4)
        : +k.slice(8) + ' ' + MONTHS[+k.slice(5, 7) - 1]
    const map = new Map<string, Row>()
    for (const r of daily) {
      if (!inRange(r.d as string, range)) continue
      const k = key(r.d as string)
      const o = map.get(k) ?? { k, label: label(k), sales: 0, revenue: 0 }
      o.sales += r.sales; o.revenue += r.revenue
      map.set(k, o)
    }
    return [...map.values()].sort((a, b) => (a.k < b.k ? -1 : 1))
  }, [gran, range, daily])

  const seg = (g: Gran, name: string) => (
    <button type="button" onClick={() => setGran(g)} aria-pressed={gran === g}
      className={'px-3 py-1.5 text-[13px] transition-colors ' +
        (gran === g ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
      {name}
    </button>
  )

  return (
    <Card wide title="Выручка, $" note="Успешные платежи. Крайний период может быть неполным."
      right={
        <div className="flex overflow-hidden rounded-lg border border-border [&>button+button]:border-l [&>button+button]:border-border">
          {seg('week', 'Недели')}{seg('month', 'Месяцы')}{seg('quarter', 'Кварталы')}
        </div>
      }>
      {rows.length ? (
        <BarChart key={gran + range.join()} data={rows} xDataKey="label" aspectRatio="16 / 5"
          margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
          <Grid horizontal />
          <YAxis orientation="right" numTicks={4} formatValue={v => fmtM(v)} />
          <Bar dataKey="revenue" fill={C[0]} lineCap={3} />
          <BarXAxis maxLabels={12} />
          <ChartTooltip showDatePill={false} rows={(p: Row) => [
            { color: C[0], label: 'выручка', value: fmtM(p.revenue as number) },
            { color: 'transparent', label: 'оплат', value: fmtN(p.sales as number) },
            { color: 'transparent', label: 'средний чек', value: '$' + comma(((p.revenue as number) / (p.sales as number)).toFixed(2)) },
          ]} />
        </BarChart>
      ) : <EmptyNote />}
    </Card>
  )
}

// ---------- когорты ----------
function CohortTable({ range, cohorts }: { range: Range; cohorts: Row[] }) {
  const today = new Date()
  const rows: Row[] = cohorts.filter((r: Row) => monthInRange(r.cohort, range))
  if (!rows.length) return <EmptyNote />
  const max = Math.max(...rows.flatMap(r => [r.pay7, r.pay30, r.pay90].map(v => v / r.users * 100)), 0.01)
  const windows = [{ n: 7, k: 'pay7' }, { n: 30, k: 'pay30' }, { n: 90, k: 'pay90' }] as const
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13.5px] tabular-nums">
        <thead>
          <tr className="text-muted-foreground [&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-semibold">
            <th className="!text-left">Когорта</th><th>Юзеров</th><th>≤7 дней</th><th>≤30 дней</th><th>≤90 дней</th><th>Оплатили всего</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const [y, m] = (r.cohort as string).split('-').map(Number)
            const monthEnd = new Date(Date.UTC(y, m, 0))
            return (
              <tr key={r.cohort} className="[&>td]:border-b [&>td]:border-border [&>td]:px-3 [&>td]:py-2 [&>td]:text-right">
                <td className="!text-left">{mLabel(r.cohort)}</td>
                <td>{fmtN(r.users)}</td>
                {windows.map(w => {
                  const mature = new Date(monthEnd.getTime() + w.n * 86400000) <= today
                  if (!mature) return <td key={w.k} className="text-muted-foreground">—</td>
                  const pct = (r[w.k] as number) / r.users * 100
                  return (
                    <td key={w.k} title={r[w.k] + ' чел.'}
                      style={pct > 0 ? { background: `rgba(57,135,229,${(0.06 + 0.36 * pct / max).toFixed(2)})` } : undefined}>
                      {comma(pct.toFixed(2))}%
                    </td>
                  )
                })}
                <td>{r.pay_ever} · {comma((r.pay_ever / r.users * 100).toFixed(2))}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- приложение ----------
export default function App() {
  const [D, setD] = useState<Row>(DATA as Row)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshErr, setRefreshErr] = useState<string | null>(null)
  const [preset, setPreset] = useState('all')

  const refresh = async () => {
    setRefreshing(true); setRefreshErr(null)
    try {
      const res = await fetch('/api/refresh', { method: 'POST' })
      if (!res.ok) throw new Error('api')
      setD(await res.json()); setUpdatedAt(new Date())
    } catch {
      try {
        const res = await fetch('dashboard_data.json?' + Date.now())
        if (!res.ok) throw new Error('static')
        setD(await res.json()); setUpdatedAt(new Date())
        setRefreshErr('сервер Metabase недоступен — загружена последняя локальная выгрузка')
      } catch {
        setRefreshErr('обновление недоступно в этой среде — запустите serve.py локально')
      }
    } finally {
      setRefreshing(false)
    }
  }
  const [from, setFrom] = useState(MIN_DATE)
  const [to, setTo] = useState(TODAY)
  const [tab, setTab] = useState(TABS[0].id)

  const range = useMemo((): Range => {
    if (preset === 'all') return [null, null]
    if (preset === 'custom') return [from, to]
    return [shiftDays(TODAY, -(+preset) + 1), TODAY]
  }, [preset, from, to])
  const rkey = range.join()

  // Платный трафик по умолчанию смотрим за текущий месяц — отдельно от
  // глобального фильтра периода, чтобы не менять дефолт для других разделов.
  const [adsPreset, setAdsPreset] = useState('month')
  const adsRange = useMemo((): Range => {
    if (adsPreset === 'month') return [TODAY.slice(0, 7) + '-01', TODAY]
    if (adsPreset === 'all') return [null, null]
    return [shiftDays(TODAY, -(+adsPreset) + 1), TODAY]
  }, [adsPreset])
  const adsRkey = adsRange.join()

  const us = D.users_summary[0]
  const tv = D.time_to_value[0]
  const revTotal = D.sales_daily.reduce((a: number, r: Row) => a + r.revenue, 0)
  const salesTotal = D.sales_daily.reduce((a: number, r: Row) => a + r.sales, 0)
  const curMrr = D.mrr_monthly[D.mrr_monthly.length - 1]
  const renClosed = D.renewals_monthly.slice(0, -1)
  const renDue = renClosed.reduce((a: number, r: Row) => a + r.due, 0)
  const renOk = renClosed.reduce((a: number, r: Row) => a + r.renewed, 0)
  const utmTotal = D.utm_sources.reduce((a: number, r: Row) => a + r.visitors, 0)
  const rt = D.referral_totals[0]
  const ovva = D.utm_sources[0]
  const metaPending = D.meta_utm_pending[0]
  const pendingTotal = D.stuck_pending.reduce((a: number, r: Row) => a + r.amount, 0)

  // --- производные, зависящие от периода ---
  const salesMonthly = useMemo(() => D.sales_monthly
    .filter((r: Row) => monthInRange(r.m, range))
    .map((r: Row) => ({ ...r, label: mLabel(r.m) })), [rkey])

  const methods = useMemo(() => {
    const map = new Map<string, Row>()
    for (const r of D.pay_attempts_daily) {
      if (!inRange(r.d, range)) continue
      const o = map.get(r.payment_method) ?? { payment_method: r.payment_method, success: 0, pending: 0, failed: 0 }
      o.success += r.success; o.pending += r.pending; o.failed += r.failed
      map.set(r.payment_method, o)
    }
    return [...map.values()].sort((a, b) => (b.success + b.pending + b.failed) - (a.success + a.pending + a.failed))
  }, [rkey, D])

  const plans = useMemo(() => {
    const names: Row = { monthly: 'мес.', yearly: 'год.', unlimited: 'безлим.' }
    const map = new Map<string, Row>()
    for (const r of D.plan_daily) {
      if (!inRange(r.d, range)) continue
      const key = r.plan_name + ' · ' + (names[r.subs_period] ?? r.subs_period)
      const o = map.get(key) ?? { name: key, sales: 0, revenue: 0 }
      o.sales += r.sales; o.revenue += r.revenue
      map.set(key, o)
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue)
  }, [rkey, D])

  const mrrRows = useMemo(() => D.mrr_monthly
    .filter((r: Row) => monthInRange(r.m, range))
    .map((r: Row) => ({ ...r, label: mLabel(r.m) })), [rkey])

  const renRows = useMemo(() => D.renewals_monthly
    .filter((r: Row) => monthInRange(r.due_month, range))
    .map((r: Row) => ({ ...r, label: mLabel(r.due_month), rate: r.due ? r.renewed / r.due * 100 : 0 })), [rkey])

  const funnel = useMemo(() => {
    const acc = { visitors: 0, registered: 0, created: 0, connected: 0, paid: 0 }
    for (const r of D.ga4_sessions_monthly ?? []) {
      if (!monthInRange(r.m, range)) continue
      acc.visitors += r.users
    }
    for (const r of D.funnel_by_month) {
      if (!monthInRange(r.m, range)) continue
      acc.registered += r.registered; acc.created += r.created
      acc.connected += r.connected; acc.paid += r.paid
    }
    return acc
  }, [rkey, D])

  const regs = useMemo(() => D.registrations_weekly
    .filter((r: Row) => weekInRange(r.w, range))
    .map((r: Row) => ({ date: new Date(r.w), regs: r.regs })), [rkey])

  const conns = useMemo(() => D.events_weekly
    .filter((r: Row) => r.kind === 'Подключение аккаунта' && r.w >= '2024-05-01' && weekInRange(r.w, range))
    .map((r: Row) => ({ date: new Date(r.w), n: r.n })), [rkey])

  const ga4Weekly = useMemo(() => (D.ga4_sessions_weekly ?? [])
    .filter((r: Row) => weekInRange(r.w, range))
    .map((r: Row) => ({ date: new Date(r.w), sessions: r.sessions, users: r.users, pageviews: r.pageviews })), [rkey])

  const ga4AppWeekly = useMemo(() => (D.ga4_app_sessions_weekly ?? [])
    .filter((r: Row) => weekInRange(r.w, range))
    .map((r: Row) => ({ date: new Date(r.w), sessions: r.sessions, users: r.users, pageviews: r.pageviews })), [rkey])

  const webFunnel = useMemo(() => {
    const sum = (rows: Row[]) => rows.filter((r: Row) => monthInRange(r.m, range)).reduce((a: number, r: Row) => a + r.users, 0)
    return { landing: sum(D.ga4_sessions_monthly ?? []), app: sum(D.ga4_app_sessions_monthly ?? []) }
  }, [rkey, D])

  // Платный/реферальный трафик vs органика → регистрация. GA4 не трекает регистрацию
  // как событие на лендинге, поэтому регистрации по каналам считаем из того, что
  // реально измеримо: Meta Ads (пиксель) + реферальная система; органика — остаток
  // от общего числа юзеров. Всё за всю историю (сессии по периоду GA4 не хранятся
  // помесячно по каналам).
  const channelFunnels = useMemo(() => {
    const channels = D.ga4_channels ?? []
    const PAID_REF = ['Paid Other', 'Paid Social', 'Display', 'Referral']
    const sumUsers = (groups: string[]) => channels
      .filter((r: Row) => groups.includes(r.sessionDefaultChannelGroup))
      .reduce((a: number, r: Row) => a + r.totalUsers, 0)

    const paidUsers = sumUsers(PAID_REF)
    const allUsers = channels.reduce((a: number, r: Row) => a + r.totalUsers, 0)
    const organicUsers = allUsers - paidUsers
    // Direct — не доказанная органика, а «неизвестно»: GA4 пишет сюда сессии без
    // referrer и без UTM — сюда попадают и репосты в мессенджерах платного контента,
    // и потерянные UTM-метки, и настоящие прямые заходы. Показываем состав честно.
    const directUsers = sumUsers(['Direct'])
    const trueOrganicUsers = sumUsers(['Organic Search', 'Organic Social', 'Organic Video', 'Organic Shopping'])
    const unknownUsers = organicUsers - directUsers - trueOrganicUsers

    const metaRegsTotal = (D.meta_spend_monthly ?? []).reduce((a: number, r: Row) => a + r.regs, 0)
    const referralRegs = rt.regs
    const paidRegs = metaRegsTotal + referralRegs
    const organicRegs = Math.max(0, us.total_users - paidRegs)

    // Показы/клики — только Meta Ads (за всю историю, без привязки к периоду —
    // так же, как остальные шаги этой воронки)
    const paidImpressions = (D.meta_spend_monthly ?? []).reduce((a: number, r: Row) => a + r.impressions, 0)
    const paidClicks = (D.meta_spend_monthly ?? []).reduce((a: number, r: Row) => a + r.clicks, 0)

    return { paidUsers, paidRegs, organicUsers, organicRegs, directUsers, trueOrganicUsers, unknownUsers, paidImpressions, paidClicks }
  }, [D])

  const metaMonthly = useMemo(() => (D.meta_spend_monthly ?? [])
    .filter((r: Row) => monthInRange(r.m, range))
    .map((r: Row) => ({
      ...r, label: mLabel(r.m),
      cost_per_reg: r.regs ? r.spend / r.regs : null,
    })), [rkey])

  const metaKpi = useMemo(() => {
    const acc = { spend: 0, impressions: 0, clicks: 0, regs: 0, leads: 0, payments: 0, revenue: 0 }
    for (const r of D.meta_spend_monthly ?? []) {
      if (!monthInRange(r.m, range)) continue
      acc.spend += r.spend; acc.impressions += r.impressions; acc.clicks += r.clicks; acc.regs += r.regs; acc.leads += r.leads
    }
    for (const r of D.meta_utm_sales_monthly ?? []) {
      if (!monthInRange(r.m, range)) continue
      acc.payments += r.payments; acc.revenue += r.revenue
    }
    return acc
  }, [rkey, D])

  // То же самое, но только для раздела «Платный трафик» — своим периодом
  // (по умолчанию текущий месяц), не завязанным на глобальный фильтр сверху.
  const adsMonthly = useMemo(() => (D.meta_spend_monthly ?? [])
    .filter((r: Row) => monthInRange(r.m, adsRange))
    .map((r: Row) => ({
      ...r, label: mLabel(r.m),
      cost_per_reg: r.regs ? r.spend / r.regs : null,
    })), [adsRkey])

  const adsKpi = useMemo(() => {
    const acc = { spend: 0, impressions: 0, clicks: 0, regs: 0, leads: 0, payments: 0, revenue: 0 }
    for (const r of D.meta_spend_monthly ?? []) {
      if (!monthInRange(r.m, adsRange)) continue
      acc.spend += r.spend; acc.impressions += r.impressions; acc.clicks += r.clicks; acc.regs += r.regs; acc.leads += r.leads
    }
    for (const r of D.meta_utm_sales_monthly ?? []) {
      if (!monthInRange(r.m, adsRange)) continue
      acc.payments += r.payments; acc.revenue += r.revenue
    }
    return acc
  }, [adsRkey, D])

  const AGE_ORDER = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']
  const metaDemographics = useMemo(() => {
    const rows = (D.meta_demographics ?? []).filter((r: Row) => AGE_ORDER.includes(r.age))
    const totalSpend = rows.reduce((a: number, r: Row) => a + r.spend, 0)
    return AGE_ORDER.map(age => {
      const female = rows.find((r: Row) => r.age === age && r.gender === 'Женщины')?.spend ?? 0
      const male = rows.find((r: Row) => r.age === age && r.gender === 'Мужчины')?.spend ?? 0
      return { age, female, male, total: female + male }
    }).filter(r => r.total > 0).map(r => ({ ...r, share: totalSpend ? r.total / totalSpend * 100 : 0 }))
  }, [D])

  const KINDS = ['Синк журнала', 'Подключение аккаунта', 'Ручные позиции', 'AI-запросы', 'Экспорт XLSX', 'Заметки']
  const evWeeks = useMemo(() => {
    const weeks = [...new Set(D.events_weekly
      .filter((r: Row) => r.w >= '2026-06-15' && weekInRange(r.w, range))
      .map((r: Row) => r.w as string))].sort()
    return weeks.map(w => {
      const o: Row = { w, label: wLabel(w).slice(0, -3) }
      for (const k of KINDS) o[k] = D.events_weekly.find((r: Row) => r.w === w && r.kind === k)?.n ?? 0
      return o
    })
  }, [rkey, D])

  const provRaw = D.connections_by_provider.map((r: Row) => ({ ...r, provider: r.provider || '(не указан)' }))
  const provTop = [...provRaw.slice(0, 6),
    { provider: `прочие (${provRaw.length - 6})`,
      users: provRaw.slice(6).reduce((a: number, r: Row) => a + r.users, 0),
      connections: provRaw.slice(6).reduce((a: number, r: Row) => a + r.connections, 0) }]

  const notesMonthly = useMemo(() => (D.notes_monthly ?? [])
    .filter((r: Row) => monthInRange(r.m, range))
    .map((r: Row) => ({ ...r, label: mLabel(r.m) })), [rkey])

  const spentOrder = ['1-24', '25-49', '50-99', '100-199', '200+']
  const spent = spentOrder.map(b => ({ bucket: '$' + b, users: D.spent_distribution.find((r: Row) => r.bucket === b)?.users ?? 0 }))

  const fmtDays = (d: number | null) => d == null ? '—'
    : d < 0.005 ? 'сразу'
    : d < 1 ? '≈' + Math.round(d * 1440) + ' мин'
    : comma(d) + ' дн.'

  const statusLegend = [
    { label: 'успех', color: GOOD }, { label: 'в ожидании', color: WARN }, { label: 'отказ', color: CRIT }]

  const ovAll = D.sales_by_method.find((r: Row) => r.payment_method === 'overpay')

  // PostHog: воронки онбординга и trial — за последние 30 дней (окно фиксирует
  // сам PostHog при выгрузке), не привязаны к глобальному фильтру периода.
  const posthogEvent = (id: string) => (D.posthog_events ?? []).find((r: Row) => r.event === id)?.count ?? 0
  const onboardingFunnelData = [
    { label: 'Регистрация', value: posthogEvent('user_signed_up'), displayValue: fmtN(posthogEvent('user_signed_up')) },
    { label: 'Онбординг начат', value: posthogEvent('onboarding_started'), displayValue: fmtN(posthogEvent('onboarding_started')) },
    { label: 'Выбрал ветку', value: posthogEvent('onboarding_path_selected'), displayValue: fmtN(posthogEvent('onboarding_path_selected')) },
  ]
  const trialFunnelData = [
    { label: 'Оформление trial', value: posthogEvent('trial_checkout_started'), displayValue: fmtN(posthogEvent('trial_checkout_started')) },
    { label: 'Trial активен', value: posthogEvent('trial_started'), displayValue: fmtN(posthogEvent('trial_started')) },
  ]
  const onboardingResumed = posthogEvent('onboarding_resumed')

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-[1400px] items-start gap-6 px-6 pb-16 pt-8">
        <nav className="sticky top-8 hidden w-52 shrink-0 space-y-1 md:block">
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={'block w-full rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors ' +
                (tab === t.id ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
              {t.label}
            </button>
          ))}
          <a href="/userflow.html"
            className="mt-3 block w-full rounded-lg border border-border px-3 py-2 text-left text-[13.5px] font-medium text-foreground transition-colors hover:bg-accent">
            Userflow
          </a>
          <a href="/onboarding.html"
            className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-left text-[13.5px] font-medium text-foreground transition-colors hover:bg-accent">
            Onboarding
          </a>
        </nav>
        <div className="min-w-0 flex-1 text-[15px]">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <h1 className="text-[26px] font-semibold text-balance">Scope360 — аналитика продукта и продаж</h1>
          <div className="flex flex-col items-end gap-1 pt-1.5">
            <button type="button" onClick={refresh} disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent disabled:opacity-60">
              <span className={refreshing ? 'animate-spin' : ''}><RefreshIcon /></span>
              {refreshing ? 'Обновляю…' : 'Обновить'}
            </button>
            <span className="text-xs text-muted-foreground">
              Данные: {fmtDT(updatedAt ?? new Date(__BUILT_AT__))}
            </span>
            {refreshErr && <span className="max-w-72 text-right text-xs text-amber-500">{refreshErr}</span>}
          </div>
        </header>

        <div className="mt-4 flex overflow-x-auto rounded-lg border border-border md:hidden [&>button+button]:border-l [&>button+button]:border-border">
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={'flex-1 whitespace-nowrap px-3 py-2 text-[13px] transition-colors ' +
                (tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
              {t.label}
            </button>
          ))}
          <a href="/userflow.html"
            className="flex-1 whitespace-nowrap border-l border-border px-3 py-2 text-center text-[13px] font-medium text-foreground">
            Userflow
          </a>
          <a href="/onboarding.html"
            className="flex-1 whitespace-nowrap border-l border-border px-3 py-2 text-center text-[13px] font-medium text-foreground">
            Onboarding
          </a>
        </div>

        <FilterBar preset={preset} setPreset={setPreset} from={from} setFrom={setFrom} to={to} setTo={setTo} />

        {tab === 'kpi' && (<>
        <Section title="Ключевые показатели">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Пользователи" value={fmtN(us.total_users)} sub="регистрации с марта 2024" />
            <Tile label="Платящие" value={fmtN(us.payers)}
              sub={<>конверсия <b className="text-emerald-600 dark:text-emerald-400">{comma((us.payers / us.total_users * 100).toFixed(2))}%</b></>} />
            <Tile label="Выручка" value={fmtM(revTotal)} sub={fmtN(salesTotal) + ' успешных оплат'} />
            <Tile label="Средний чек" value={'$' + comma((revTotal / salesTotal).toFixed(2))} sub="на успешную оплату" />
            <Tile label="ARPPU" value={'$' + comma(us.arppu.toFixed(2))} sub="на платящего за всё время" />
            <Tile label="MRR сейчас" value={fmtM(curMrr.mrr)} sub={`${curMrr.monthly_subs} месячных + ${curMrr.yearly_subs} годовых`} />
            <Tile label="Продлеваемость месячных" value={renDue ? Math.round(renOk / renDue * 100) + '%' : '—'}
              sub={`${renOk} продлений из ${renDue} истёкших`} />
            <Tile label="Применений промокодов" value={fmtN(D.promo_usage[0].uses)} sub="за всю историю" />
          </div>
        </Section>

        <Section title="Деньги">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <RevenueCard range={range} daily={D.sales_daily} />
            <Card title="Платежи по месяцам" note="Число успешных оплат; покупатели — в подсказке.">
              {salesMonthly.length ? (
                <BarChart key={rkey} data={salesMonthly} xDataKey="label"
                  aspectRatio="16 / 7" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                  <Grid horizontal />
                  <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                  <Bar dataKey="sales" fill={C[0]} lineCap={3} />
                  <BarXAxis maxLabels={8} />
                  <ChartTooltip showDatePill={false} rows={(p: Row) => [
                    { color: C[0], label: 'оплат', value: fmtN(p.sales) },
                    { color: 'transparent', label: 'покупателей', value: fmtN(p.buyers) },
                  ]} />
                </BarChart>
              ) : <EmptyNote />}
            </Card>
            <Card title="Платёжные методы: исходы попыток" note="Попытки оплаты по статусам за период.">
              {methods.length ? (
                <>
                  <BarChart key={rkey} data={methods} xDataKey="payment_method" barWidth={26}
                    aspectRatio="16 / 7" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                    <Grid horizontal />
                    <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                    <Bar dataKey="success" fill={GOOD} lineCap={2} />
                    <Bar dataKey="pending" fill={WARN} lineCap={2} />
                    <Bar dataKey="failed" fill={CRIT} lineCap={2} />
                    <BarXAxis showAllLabels />
                    <ChartTooltip showDatePill={false} rows={(p: Row) => [
                      { color: GOOD, label: 'успех', value: fmtN(p.success) },
                      { color: WARN, label: 'в ожидании', value: fmtN(p.pending) },
                      { color: CRIT, label: 'отказ', value: fmtN(p.failed) },
                    ]} />
                  </BarChart>
                  <Legend items={statusLegend} />
                </>
              ) : <EmptyNote />}
            </Card>
            <Card title="Выручка по тарифам" note="Успешные платежи за период, план × период подписки.">
              {plans.length ? (
                <BarChart key={rkey} data={plans} xDataKey="name" orientation="horizontal" aspectRatio="16 / 7"
                  margin={{ top: 8, right: 24, bottom: 8, left: 84 }}>
                  <Bar dataKey="revenue" fill={C[0]} lineCap={3} />
                  <BarYAxis />
                  <ChartTooltip showDatePill={false} rows={(p: Row) => [
                    { color: C[0], label: 'выручка', value: fmtM(p.revenue) },
                    { color: 'transparent', label: 'оплат', value: fmtN(p.sales) },
                  ]} />
                </BarChart>
              ) : <EmptyNote />}
            </Card>
            <Card title="Зависшие платежи (pending)" note="За всю историю — кандидаты на восстановление.">
              <BarChart data={D.stuck_pending} xDataKey="payment_method" orientation="horizontal"
                aspectRatio="16 / 7" margin={{ top: 8, right: 24, bottom: 8, left: 70 }}>
                <Bar dataKey="amount" fill={WARN} lineCap={3} />
                <BarYAxis />
                <ChartTooltip showDatePill={false} rows={(p: Row) => [
                  { color: WARN, label: 'зависло', value: fmtM(p.amount) },
                  { color: 'transparent', label: 'платежей', value: fmtN(p.n) },
                  { color: 'transparent', label: 'старейший', value: (p.oldest as string).split('-').reverse().join('.') },
                ]} />
              </BarChart>
            </Card>
          </div>
          <Callout>
            <b className="text-foreground">Отказы платежей.</b> У overpay из {ovAll.attempts} попыток за всю историю провалились {ovAll.failed} ({Math.round(ovAll.failed / ovAll.attempts * 100)}%) —
            это до {fmtM(ovAll.failed * (revTotal / salesTotal))} потенциально потерянной выручки в среднем чеке.
            В pending висит {fmtM(pendingTotal)}.
          </Callout>
        </Section>

        <Section title="Подписочная экономика">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card title="MRR по месяцам, $" note="Активные подписки на конец месяца; годовые — как цена/12.">
              {mrrRows.length ? (
                <BarChart key={rkey} data={mrrRows} xDataKey="label"
                  aspectRatio="16 / 7" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                  <Grid horizontal />
                  <YAxis orientation="right" numTicks={4} formatValue={v => fmtM(v)} />
                  <Bar dataKey="mrr" fill={C[0]} lineCap={3} />
                  <BarXAxis maxLabels={8} />
                  <ChartTooltip showDatePill={false} rows={(p: Row) => [
                    { color: C[0], label: 'MRR', value: fmtM(p.mrr) },
                    { color: 'transparent', label: 'месячных', value: fmtN(p.monthly_subs) },
                    { color: 'transparent', label: 'годовых', value: fmtN(p.yearly_subs) },
                  ]} />
                </BarChart>
              ) : <EmptyNote />}
            </Card>
            <Card title="Продлеваемость месячных подписок" note="Повторная оплата в течение 45 дней. Последний месяц предварительный.">
              {renRows.length ? (
                <BarChart key={rkey} data={renRows} xDataKey="label" aspectRatio="16 / 7"
                  margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                  <Grid horizontal />
                  <YAxis orientation="right" numTicks={4} formatValue={v => Math.round(v) + '%'} />
                  <Bar dataKey="rate" fill={C[0]} lineCap={3} />
                  <BarXAxis maxLabels={8} />
                  <ChartTooltip showDatePill={false} rows={(p: Row) => [
                    { color: C[0], label: 'продлеваемость', value: Math.round(p.rate) + '%' },
                    { color: 'transparent', label: 'истекло', value: fmtN(p.due) },
                    { color: 'transparent', label: 'продлено', value: fmtN(p.renewed) },
                  ]} />
                </BarChart>
              ) : <EmptyNote />}
            </Card>
            <Card wide title="Когорты: регистрация → первая оплата"
              note="Доля когорты, оплатившей за N дней. Продажи трекаются с конца ноября 2025; «—» — окно ещё не закрылось.">
              <CohortTable range={range} cohorts={D.cohort_conversion} />
            </Card>
          </div>
        </Section>

        <Section title="Воронка">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card wide title="От посетителя сайта до оплаты"
              note="Посетители — уникальные пользователи лендинга (GA4) за период; остальные шаги — пользователи, зарегистрированные в периоде, достигшие шага когда-либо.">
              {funnel.registered ? (
                <FunnelChart key={rkey}
                  data={[
                    ...(funnel.visitors ? [{ label: 'Посетил сайт', value: funnel.visitors, displayValue: fmtN(funnel.visitors) }] : []),
                    { label: 'Зарегистрировался', value: funnel.registered, displayValue: fmtN(funnel.registered) },
                    { label: 'Создал торговый аккаунт', value: funnel.created, displayValue: fmtN(funnel.created) },
                    { label: 'Подключил аккаунт', value: funnel.connected, displayValue: fmtN(funnel.connected) },
                    { label: 'Оплатил', value: funnel.paid, displayValue: fmtN(funnel.paid) },
                  ]}
                  color="var(--chart-1)" orientation="horizontal" className="w-full"
                  formatPercentage={(p: number) => comma(p.toFixed(p < 1 ? 2 : 1)) + '%'}
                />
              ) : <EmptyNote />}
            </Card>
            <Card wide title="Скорость пути к ценности"
              note="Медианное время от регистрации до шага, за всю историю — по пользователям, зарегистрированным при живом трекинге шага.">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Tile label="До создания аккаунта" value={fmtDays(tv.med_create_d)} sub="медиана" />
                <Tile label="До подключения" value={fmtDays(tv.med_conn_d)} sub="медиана" />
                <Tile label="До первого синка" value={fmtDays(tv.med_sync_d)} sub="медиана, рег. после 15.06" />
                <Tile label="До первой оплаты" value={fmtDays(tv.med_pay_d)} sub="медиана по платящим" />
                <Tile label="Активация за 7 дней" value={comma(tv.activation7_pct) + '%'} sub="подключили аккаунт, рег. за 90 дней" />
              </div>
            </Card>
          </div>
        </Section>
        </>)}

        {tab === 'users' && (<>
        <Section title="Пользователи">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card wide title="Регистрации по неделям" note="Последняя неделя неполная.">
              {regs.length ? (
                <AreaChart key={rkey} data={regs} xDataKey="date" aspectRatio="16 / 5" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                  <Grid horizontal />
                  <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                  <Area dataKey="regs" fill={C[0]} />
                  <XAxis />
                  <ChartTooltip rows={(p: Row) => [{ color: C[0], label: 'регистраций', value: fmtN(p.regs) }]} />
                </AreaChart>
              ) : <EmptyNote />}
            </Card>
            <Card title="Текущие тарифы" note={fmtN(us.total_users) + ' пользователей сейчас.'}>
              <BarChart data={D.plans_current} xDataKey="plan" orientation="horizontal"
                aspectRatio="16 / 7" margin={{ top: 8, right: 24, bottom: 8, left: 76 }}>
                <Bar dataKey="users" fill={C[0]} lineCap={3} />
                <BarYAxis />
                <ChartTooltip showDatePill={false} rows={(p: Row) => [
                  { color: C[0], label: 'пользователей', value: fmtN(p.users) },
                  { color: 'transparent', label: 'доля', value: comma((p.users / us.total_users * 100).toFixed(1)) + '%' },
                ]} />
              </BarChart>
            </Card>
            <Card title="Сколько потратил платящий, $" note="По сумме всех покупок за всю историю.">
              <BarChart data={spent} xDataKey="bucket" aspectRatio="16 / 7" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                <Grid horizontal />
                <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                <Bar dataKey="users" fill={C[0]} lineCap={3} />
                <BarXAxis showAllLabels />
                <ChartTooltip showDatePill={false} rows={(p: Row) => [{ color: C[0], label: 'платящих', value: fmtN(p.users) }]} />
              </BarChart>
            </Card>
          </div>
        </Section>

        <Section title="Продукт">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card wide title="Подключения торговых аккаунтов по неделям" note="Последняя неделя неполная.">
              {conns.length ? (
                <AreaChart key={rkey} data={conns} xDataKey="date" aspectRatio="16 / 5" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                  <Grid horizontal />
                  <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                  <Area dataKey="n" fill={C[0]} />
                  <XAxis />
                  <ChartTooltip rows={(p: Row) => [{ color: C[0], label: 'подключений', value: fmtN(p.n) }]} />
                </AreaChart>
              ) : <EmptyNote />}
            </Card>
            <Card title="Провайдеры: уникальные пользователи" note="За всю историю.">
              <BarChart data={provTop} xDataKey="provider" orientation="horizontal"
                aspectRatio="16 / 9" margin={{ top: 8, right: 24, bottom: 8, left: 92 }}>
                <Bar dataKey="users" fill={C[0]} lineCap={3} />
                <BarYAxis />
                <ChartTooltip showDatePill={false} rows={(p: Row) => [
                  { color: C[0], label: 'пользователей', value: fmtN(p.users) },
                  { color: 'transparent', label: 'подключений', value: fmtN(p.connections) },
                ]} />
              </BarChart>
            </Card>
            <Card title="Активность в продукте" note="Последние недели. Синк, AI и экспорт трекаются с 15 июня 2026; заметки — с 2024 года.">
              {evWeeks.length ? (
                <>
                  <BarChart key={rkey} data={evWeeks} xDataKey="label" aspectRatio="16 / 9" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                    <Grid horizontal />
                    <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                    {KINDS.map((k, i) => <Bar key={k} dataKey={k} fill={C[i]} lineCap={2} />)}
                    <BarXAxis showAllLabels />
                    <ChartTooltip showDatePill={false} rows={(p: Row) =>
                      KINDS.map((k, i) => ({ color: C[i], label: k, value: fmtN(p[k]) }))} />
                  </BarChart>
                  <Legend items={KINDS.map((k, i) => ({ label: k, color: C[i] }))} />
                </>
              ) : <EmptyNote />}
            </Card>
            <Card title="Все функции по событиям" note="За всю историю. Без автосозданных папок заметок (системный шум при регистрации).">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(D.feature_events_summary ?? []).map((r: Row, i: number) => (
                  <div key={i} className="rounded-lg border border-border bg-background/40 p-2.5">
                    <div className="truncate text-[11.5px] leading-tight text-muted-foreground" title={r.feat}>{r.feat}</div>
                    <div className="mt-1 text-[18px] font-semibold leading-tight">{fmtN(r.n)}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtN(r.users)} польз.</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card stretch title="Заметки: создание по месяцам" note="С февраля 2024. Без тегов и автопапок.">
              {notesMonthly.length ? (
                <BarChart key={rkey} data={notesMonthly} xDataKey="label" className="h-full" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                  <Grid horizontal />
                  <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                  <Bar dataKey="notes" fill={C[0]} lineCap={3} />
                  <BarXAxis maxLabels={12} />
                  <ChartTooltip showDatePill={false} rows={(p: Row) => [
                    { color: C[0], label: 'заметок', value: fmtN(p.notes) },
                    { color: 'transparent', label: 'авторов', value: fmtN(p.users) },
                  ]} />
                </BarChart>
              ) : <EmptyNote />}
            </Card>
          </div>
        </Section>
        </>)}

        {tab === 'marketing' && (<>
        <Section title="Маркетинг">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="Реферальных ссылок" value={fmtN(rt.links)} sub="все активны" />
            <Tile label="Кликов по ссылкам" value={fmtN(rt.clicks)} sub="за всю историю" />
            <Tile label="Регистраций по рефам" value={fmtN(rt.regs)} />
            <Tile label="Оплат по рефам" value={fmtN(rt.payments)} sub={'на ' + fmtM(rt.revenue)} />
            <Tile label="Юзеров с UTM-метками" value={fmtN(utmTotal)}
              sub={`из ${fmtN(us.total_users)} — ${comma((utmTotal / us.total_users * 100).toFixed(1))}%`} />
            <Tile label="Расходы на рекламу" value={fmtM(metaKpi.spend)} sub="Meta Ads, за период" />
            <Tile label="Показы" value={fmtN(metaKpi.impressions)} sub="Meta Ads, за период" />
            <Tile label="Клики" value={fmtN(metaKpi.clicks)}
              sub={metaKpi.impressions ? `CTR ${comma((metaKpi.clicks / metaKpi.impressions * 100).toFixed(2))}%` : undefined} />
            <Tile label="Регистраций с рекламы" value={fmtN(metaKpi.regs)}
              sub={metaKpi.regs ? `по $${comma((metaKpi.spend / metaKpi.regs).toFixed(2))} за рег.` : 'нет данных'} />
          </div>
        </Section>
        </>)}

        {tab === 'ads' && (<>
        <Section title="Платный трафик (Meta Ads)">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[13px] font-medium text-muted-foreground">Период (только этот раздел)</span>
            <div className="flex overflow-hidden rounded-lg border border-border [&>button+button]:border-l [&>button+button]:border-border">
              {[['month', 'Текущий месяц'], ['30', '30 дней'], ['90', '90 дней'], ['all', 'Всё время']].map(([v, label]) => (
                <button key={v} type="button" onClick={() => setAdsPreset(v)} aria-pressed={adsPreset === v}
                  className={'px-3 py-1.5 text-[13px] transition-colors ' +
                    (adsPreset === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <Tile label="Расходы" value={fmtM(adsKpi.spend)} sub="Facebook + Instagram" />
            <Tile label="Показы" value={fmtN(adsKpi.impressions)} />
            <Tile label="Клики" value={fmtN(adsKpi.clicks)}
              sub={adsKpi.impressions ? `CTR ${comma((adsKpi.clicks / adsKpi.impressions * 100).toFixed(2))}%` : undefined} />
            <Tile label="CPM" value={adsKpi.impressions ? '$' + comma((adsKpi.spend / adsKpi.impressions * 1000).toFixed(2)) : '—'}
              sub="за 1000 показов" />
            <Tile label="CPC" value={adsKpi.clicks ? '$' + comma((adsKpi.spend / adsKpi.clicks).toFixed(2)) : '—'}
              sub="за клик" />
            <Tile label="Регистраций" value={fmtN(adsKpi.regs)}
              sub={adsKpi.regs ? `по $${comma((adsKpi.spend / adsKpi.regs).toFixed(2))} за рег.` : 'нет данных'} />
            <Tile label="Лидов" value={fmtN(adsKpi.leads)} sub="заявки с рекламы" />
            <Tile label="Оплаты" value={fmtN(adsKpi.payments)}
              sub={adsKpi.payments
                ? fmtM(adsKpi.revenue) + ' выручки'
                : metaPending?.pending ? `${metaPending.pending} в pending` : 'ни одной успешной'} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card wide title="Расходы и цена регистрации по месяцам" note="Facebook + Instagram Ads. Цена за регистрацию — в подсказке, отдельно на каждый месяц.">
              {adsMonthly.length ? (
                <BarChart key={adsRkey} data={adsMonthly} xDataKey="label" aspectRatio="16 / 6" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                  <Grid horizontal />
                  <YAxis orientation="right" numTicks={4} formatValue={v => fmtM(v)} />
                  <Bar dataKey="spend" fill={C[2]} lineCap={3} />
                  <BarXAxis showAllLabels />
                  <ChartTooltip showDatePill={false} rows={(p: Row) => [
                    { color: C[2], label: 'расходы', value: fmtM(p.spend) },
                    { color: 'transparent', label: 'регистраций', value: fmtN(p.regs) },
                    { color: 'transparent', label: 'лидов', value: fmtN(p.leads) },
                    { color: 'transparent', label: 'цена рег.', value: p.cost_per_reg != null ? '$' + comma(p.cost_per_reg.toFixed(2)) : '—' },
                    { color: 'transparent', label: 'CTR', value: p.impressions ? comma((p.clicks / p.impressions * 100).toFixed(2)) + '%' : '—' },
                  ]} />
                </BarChart>
              ) : <EmptyNote />}
            </Card>

            <Card wide title="Топ креативов" note="По расходам за всю историю. Наведите — покажется картинка креатива.">
              {(D.meta_creatives ?? []).length ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                  {D.meta_creatives.map((r: Row, i: number) => <CreativeTile key={i} r={r} />)}
                </div>
              ) : <EmptyNote />}
            </Card>

            <Card title="География" note="Расходы за последние 90 дней. Наведите на страну.">
              {(D.meta_geo ?? []).length ? (
                <WorldSpendMap data={D.meta_geo} fmtMoney={fmtM} fmtNum={fmtN} />
              ) : <EmptyNote />}
            </Card>

            <Card title="Плейсменты" note="Расходы за последние 90 дней, по платформам.">
              {(D.meta_placement ?? []).filter((r: Row) => r.spend > 0).length ? (
                <BarChart data={D.meta_placement.filter((r: Row) => r.spend > 0)} xDataKey="platform" orientation="horizontal"
                  aspectRatio="16 / 9" margin={{ top: 8, right: 24, bottom: 8, left: 96 }}>
                  <Bar dataKey="spend" fill={C[2]} lineCap={3} />
                  <BarYAxis />
                  <ChartTooltip showDatePill={false} rows={(p: Row) => [
                    { color: C[2], label: 'расходы', value: fmtM(p.spend) },
                    { color: 'transparent', label: 'показы', value: fmtN(p.impressions) },
                    { color: 'transparent', label: 'клики', value: fmtN(p.clicks) },
                  ]} />
                </BarChart>
              ) : <EmptyNote />}
            </Card>

            <Card title="Возраст и пол аудитории" note="Расходы за последние 90 дней, по кликнувшим на рекламу.">
              {metaDemographics.length ? (
                <div className="space-y-1.5">
                  {metaDemographics.map(r => (
                    <div key={r.age} className="flex items-center gap-2 text-[12.5px]">
                      <span className="w-12 shrink-0 text-muted-foreground">{r.age}</span>
                      <div className="flex h-4 flex-1 overflow-hidden rounded-full bg-accent">
                        <div className="h-full bg-[var(--chart-1)]" style={{ width: `${r.total ? r.female / r.total * 100 : 0}%` }} />
                        <div className="h-full bg-[var(--chart-3)]" style={{ width: `${r.total ? r.male / r.total * 100 : 0}%` }} />
                      </div>
                      <span className="w-16 shrink-0 text-right font-medium">{fmtM(r.total)}</span>
                      <span className="w-12 shrink-0 text-right text-muted-foreground">{comma(r.share.toFixed(0))}%</span>
                    </div>
                  ))}
                  <div className="mt-2 flex items-center gap-4 text-[11.5px] text-muted-foreground">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--chart-1)]" />женщины</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--chart-3)]" />мужчины</span>
                  </div>
                </div>
              ) : <EmptyNote />}
            </Card>
          </div>
        </Section>
        </>)}

        {tab === 'marketing' && (<>
        <Section title="Веб-аналитика (GA4)">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card wide title="До логина и после" note="Уникальные пользователи за выбранный период. Два разных ресурса GA4: сайт до логина и сайт после логина.">
              {webFunnel.landing ? (
                <FunnelChart key={rkey}
                  data={[
                    { label: 'scope360.io — до логина', value: webFunnel.landing, displayValue: fmtN(webFunnel.landing) },
                    { label: 'scope360.io/futures — после логина', value: webFunnel.app, displayValue: fmtN(webFunnel.app) },
                  ]}
                  color="var(--chart-1)" orientation="horizontal" className="w-full"
                  formatPercentage={(p: number) => comma(p.toFixed(p < 1 ? 2 : 1)) + '%'}
                />
              ) : <EmptyNote />}
            </Card>
            <Card title="Сессии по неделям" note="scope360.io — до логина (лендинг). Последняя неделя неполная.">
              {ga4Weekly.length ? (
                <AreaChart key={rkey} data={ga4Weekly} xDataKey="date" aspectRatio="16 / 7" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                  <Grid horizontal />
                  <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                  <Area dataKey="sessions" fill={C[0]} />
                  <XAxis />
                  <ChartTooltip rows={(p: Row) => [
                    { color: C[0], label: 'сессий', value: fmtN(p.sessions) },
                    { color: 'transparent', label: 'пользователей', value: fmtN(p.users) },
                    { color: 'transparent', label: 'просмотров', value: fmtN(p.pageviews) },
                  ]} />
                </AreaChart>
              ) : <EmptyNote />}
            </Card>
            <Card title="Сессии по неделям" note="scope360.io/futures — после логина (личный кабинет). Последняя неделя неполная.">
              {ga4AppWeekly.length ? (
                <AreaChart key={rkey} data={ga4AppWeekly} xDataKey="date" aspectRatio="16 / 7" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                  <Grid horizontal />
                  <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                  <Area dataKey="sessions" fill={C[1]} />
                  <XAxis />
                  <ChartTooltip rows={(p: Row) => [
                    { color: C[1], label: 'сессий', value: fmtN(p.sessions) },
                    { color: 'transparent', label: 'пользователей', value: fmtN(p.users) },
                    { color: 'transparent', label: 'просмотров', value: fmtN(p.pageviews) },
                  ]} />
                </AreaChart>
              ) : <EmptyNote />}
            </Card>
            <Card title="Каналы трафика" note="За всю историю.">
              {(D.ga4_channels ?? []).length ? (
                <BarChart data={D.ga4_channels} xDataKey="sessionDefaultChannelGroup" orientation="horizontal"
                  aspectRatio="16 / 9" margin={{ top: 8, right: 24, bottom: 8, left: 96 }}>
                  <Bar dataKey="sessions" fill={C[0]} lineCap={3} />
                  <BarYAxis />
                  <ChartTooltip showDatePill={false} rows={(p: Row) => [
                    { color: C[0], label: 'сессий', value: fmtN(p.sessions) },
                    { color: 'transparent', label: 'пользователей', value: fmtN(p.totalUsers) },
                    { color: 'transparent', label: 'вовлечённость', value: comma(p.engagementRate) + '%' },
                  ]} />
                </BarChart>
              ) : <EmptyNote />}
            </Card>
            <Card title="Топ страниц" note="По просмотрам за всю историю.">
              {(D.ga4_top_pages ?? []).length ? (
                <BarChart data={D.ga4_top_pages} xDataKey="pagePath" orientation="horizontal"
                  aspectRatio="16 / 9" margin={{ top: 8, right: 24, bottom: 8, left: 96 }}>
                  <Bar dataKey="screenPageViews" fill={C[0]} lineCap={3} />
                  <BarYAxis />
                  <ChartTooltip showDatePill={false} rows={(p: Row) => [
                    { color: C[0], label: 'просмотров', value: fmtN(p.screenPageViews) },
                    { color: 'transparent', label: 'пользователей', value: fmtN(p.totalUsers) },
                  ]} />
                </BarChart>
              ) : <EmptyNote />}
            </Card>
            <Card title="Платный + реферальный трафик → регистрация"
              note="Клики — только Meta Ads; пользователи (GA4) и регистрации — Meta Ads + реферальная система. Всё за всю историю; регистрации — по Meta Ads (пиксель) и реферальной системе, точнее, чем UTM в БД (там охват 5,7%).">
              <FunnelChart key="paid-funnel"
                data={[
                  { label: 'Кликов (Meta)', value: channelFunnels.paidClicks, displayValue: fmtN(channelFunnels.paidClicks) },
                  { label: 'Пользователей (GA4)', value: channelFunnels.paidUsers, displayValue: fmtN(channelFunnels.paidUsers) },
                  { label: 'Зарегистрировалось', value: channelFunnels.paidRegs, displayValue: fmtN(channelFunnels.paidRegs) },
                ]}
                color="var(--chart-3)" orientation="horizontal" className="w-full"
                formatPercentage={(p: number) => comma(p.toFixed(p < 1 ? 2 : 1)) + '%'}
              />
            </Card>
            <Card title="Всё остальное → регистрация"
              note={`Не платное и не реферальное: ${fmtN(channelFunnels.trueOrganicUsers)} настоящей органики (поиск/соцсети/видео) + ${fmtN(channelFunnels.directUsers)} Direct — а Direct это не доказанная органика, а «неизвестно»: сюда попадают репосты в мессенджерах платного контента и потерянные UTM-метки. GA4 их не различает. Регистрации — остаток от общего числа за вычетом платных и реферальных.`}>
              <FunnelChart key="organic-funnel"
                data={[
                  { label: 'Пользователей (GA4)', value: channelFunnels.organicUsers, displayValue: fmtN(channelFunnels.organicUsers) },
                  { label: 'Зарегистрировалось', value: channelFunnels.organicRegs, displayValue: fmtN(channelFunnels.organicRegs) },
                ]}
                color="var(--chart-1)" orientation="horizontal" className="w-full"
                formatPercentage={(p: number) => comma(p.toFixed(p < 1 ? 2 : 1)) + '%'}
              />
            </Card>
            <Card wide title="UTM и партнёрские ссылки" note="По регистрациям; клики, оплаты и выручка — в подсказке. За всю историю.">
              <BarChart data={D.attribution_links.map((r: Row) => ({ ...r, label: r.kind === 'UTM' ? r.category : 'Партнёрская' }))}
                xDataKey="label" orientation="horizontal" aspectRatio="16 / 6" margin={{ top: 8, right: 24, bottom: 8, left: 112 }}>
                <Bar dataKey="regs" fill={C[2]} lineCap={3} />
                <BarYAxis />
                <ChartTooltip showDatePill={false} rows={(p: Row) => [
                  { color: C[2], label: 'регистраций', value: fmtN(p.regs) },
                  { color: 'transparent', label: 'кликов', value: fmtN(p.clicks) },
                  { color: 'transparent', label: 'оплат', value: fmtN(p.payments) },
                  { color: 'transparent', label: 'выручка', value: fmtM(p.revenue) },
                ]} />
              </BarChart>
            </Card>
          </div>

          <Callout>
            <b className="text-foreground">Атрибуция в БД неполная.</b> UTM-метки на аккаунте есть только у {comma((utmTotal / us.total_users * 100).toFixed(1))}% пользователей —
            метка пишется лишь при регистрации. Крупнейший источник {ovva.source} привёл {fmtN(ovva.regs)} регистраций и <b className="text-foreground">0 успешных оплат</b> по этим данным
            {ovva.pending_payers ? <> ({ovva.pending_payers} {ovva.pending_payers === 1 ? 'попытка зависла' : 'попытки зависли'} в pending, не отказ платить — а сломанная оплата)</> : null}.
            Полную картину по трафику (в т.ч. ссылки через bitly) смотрите в таблице ниже — там UTM читается из URL перехода для всех сессий, а не только зарегистрированных.
          </Callout>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card wide title="UTM по данным GA4 (полное покрытие)"
              note="Источник трафика на лендинг, все сессии (не только зарегистрированные). Отсортировано по людям, а не по заходам — так дубли и спам-боты не лезут наверх. Служебный и спам-трафик (dev-заходы, спам-рефереры) убран; варианты одной и той же Meta-кампании из-за разного тегирования ссылок объединены. Наведите на столбик — поясним, что это за источник.">
              <BarChart data={D.ga4_utm_campaigns ?? []} xDataKey="sessionSource" orientation="horizontal"
                aspectRatio="16 / 12" margin={{ top: 8, right: 24, bottom: 8, left: 128 }}>
                <Bar dataKey="totalUsers" fill={C[2]} lineCap={3} />
                <BarYAxis />
                <ChartTooltip showDatePill={false} rows={(p: Row) => {
                  const explain = utmExplain(p.sessionSource, p.sessionCampaignName)
                  const rows = [
                    { color: C[2], label: 'пользователей', value: fmtN(p.totalUsers) },
                    { color: 'transparent', label: 'сессий', value: fmtN(p.sessions) },
                    { color: 'transparent', label: 'канал', value: mediumLabel(p.sessionMedium) },
                    { color: 'transparent', label: 'кампания', value: p.sessionCampaignName },
                  ]
                  if (explain) rows.push({ color: 'transparent', label: 'что это', value: explain })
                  return rows
                }} />
              </BarChart>
            </Card>
          </div>
        </Section>
        </>)}

        {tab === 'conclusions' && (<>
        <Section title="Выводы">
          <ul className="grid gap-2.5 text-sm text-muted-foreground">
            {[
              <><b className="text-foreground">Платёжка теряет деньги: у overpay {Math.round(ovAll.failed / ovAll.attempts * 100)}% попыток заканчиваются отказом.</b> Починка
                overpay — самый быстрый способ поднять выручку без роста трафика; плюс {fmtM(pendingTotal)} висит в pending.</>,
              <><b className="text-foreground">Рост регистраций не конвертируется в деньги.</b> Регистрации на максимумах (200–370 в неделю),
                а MRR упал с пика $734 (февраль) до {fmtM(curMrr.mrr)}. Конверсия в оплату — 0,7% за всю историю.</>,
              <><b className="text-foreground">Продлеваемость месячных подписок — {renDue ? Math.round(renOk / renDue * 100) : 0}%.</b> Практически
                все платящие уходят после первого месяца; удержание подписчиков — проблема №1 монетизации.</>,
              <><b className="text-foreground">Деньги приносит Base-тариф (88% выручки).</b> Pro покупают единицы — либо он недопродан
                в продукте, либо его ценность не видна.</>,
              <><b className="text-foreground">Продукт цепляет мгновенно, а платят через полтора месяца:</b> подключение аккаунта — медиана
                14 минут после регистрации, первая оплата — 44,5 дня. Разрыв воронки — между «создал аккаунт» и «подключил» (теряем две трети).</>,
              <><b className="text-foreground">Атрибуция почти слепая:</b> UTM у 5,5% пользователей; рефералка: 13 тысяч ссылок → 274 клика → 7 оплат.
                Ядро продукта — форекс на MetaTrader 5.</>,
            ].map((x, i) => (
              <li key={i} className="rounded-xl border border-border bg-card px-4 py-3">{x}</li>
            ))}
          </ul>
        </Section>
        </>)}

        {tab === 'subscriptions' && (<>
        <Section title="Подписки: онбординг и trial">
          <p className="text-[11px] font-bold uppercase tracking-wide text-red-500">
            Сбор данных по этим событиям в PostHog начался 04.09.2026 — цифры за очень короткий период, для трендов пока не показательны
          </p>

          <Callout>
            Воронки онбординга и trial ниже — из PostHog, окно фиксированное (последние 30 дней), не зависит от фильтра периода выше.
            Блок «Оплаты» — из Metabase, за выбранный период. Это разные источники и окна — не складывайте числа из разных блоков друг с другом.
          </Callout>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
            <Tile label="Регистрация" value={fmtN(posthogEvent('user_signed_up'))} sub="PostHog, 30 дней" />
            <Tile label="Онбординг начат" value={fmtN(posthogEvent('onboarding_started'))} />
            <Tile label="Выбрал ветку" value={fmtN(posthogEvent('onboarding_path_selected'))} />
            <Tile label="Вернулись повторно" value={fmtN(onboardingResumed)} sub="не прошли с 1 раза" />
            <Tile label="Оформление trial" value={fmtN(posthogEvent('trial_checkout_started'))} />
            <Tile label="Trial активен" value={fmtN(posthogEvent('trial_started'))} />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card title="Воронка онбординга" note="PostHog, последние 30 дней. Регистрация формы → начал онбординг → выбрал ветку (подключить аккаунт или ручной журнал).">
              {onboardingFunnelData[0].value ? (
                <FunnelChart key="onboarding-funnel"
                  data={onboardingFunnelData}
                  color="var(--chart-1)" orientation="horizontal" className="w-full"
                  formatPercentage={(p: number) => comma(p.toFixed(p < 1 ? 2 : 1)) + '%'}
                />
              ) : <EmptyNote />}
              {onboardingResumed > 0 && (
                <p className="mt-3 text-[12.5px] text-amber-500">
                  Ещё {fmtN(onboardingResumed)} человек за этот же период вернулись в онбординг повторно (не прошли с одного захода) —
                  это не отдельный шаг воронки, а сигнал, что часть выбравших ветку — на самом деле повторные попытки.
                </p>
              )}
            </Card>

            <Card title="Воронка trial" note="PostHog, последние 30 дней. Начал оформление → trial реально активирован.">
              {trialFunnelData[0].value ? (
                <FunnelChart key="trial-funnel"
                  data={trialFunnelData}
                  color="var(--chart-3)" orientation="horizontal" className="w-full"
                  formatPercentage={(p: number) => comma(p.toFixed(p < 1 ? 2 : 1)) + '%'}
                />
              ) : <EmptyNote />}
              {trialFunnelData[0].value > 0 && trialFunnelData[1].value < trialFunnelData[0].value && (
                <p className="mt-3 text-[12.5px] text-amber-500">
                  {fmtN(trialFunnelData[0].value - trialFunnelData[1].value)} из {fmtN(trialFunnelData[0].value)} начавших оформление
                  не дошли до активации trial за период — стоит проверить этот шаг отдельно, объём небольшой, но провал резкий.
                </p>
              )}
            </Card>
          </div>
        </Section>

        <Section title="Оплаты">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Tile label="Выручка" value={fmtM(revTotal)} sub={fmtN(salesTotal) + ' успешных оплат'} />
              <Tile label="MRR сейчас" value={fmtM(curMrr.mrr)} sub={`${curMrr.monthly_subs} месячных + ${curMrr.yearly_subs} годовых`} />
              <Tile label="Средний чек" value={'$' + comma((revTotal / salesTotal).toFixed(2))} sub="на успешную оплату" />
              <Tile label="Продлеваемость месячных" value={renDue ? Math.round(renOk / renDue * 100) + '%' : '—'}
                sub={`${renOk} продлений из ${renDue} истёкших`} />
              <Tile label="Отказы overpay" value={ovAll ? Math.round(ovAll.failed / ovAll.attempts * 100) + '%' : '—'}
                sub={ovAll ? `${ovAll.failed} из ${ovAll.attempts} попыток` : undefined} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Card title="Платежи по месяцам" note="Число успешных оплат; покупатели — в подсказке.">
                {salesMonthly.length ? (
                  <BarChart key={rkey} data={salesMonthly} xDataKey="label"
                    aspectRatio="16 / 7" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                    <Grid horizontal />
                    <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                    <Bar dataKey="sales" fill={C[0]} lineCap={3} />
                    <BarXAxis maxLabels={8} />
                    <ChartTooltip showDatePill={false} rows={(p: Row) => [
                      { color: C[0], label: 'оплат', value: fmtN(p.sales) },
                      { color: 'transparent', label: 'покупателей', value: fmtN(p.buyers) },
                    ]} />
                  </BarChart>
                ) : <EmptyNote />}
              </Card>
              <Card title="Платёжные методы: исходы попыток" note="Попытки оплаты по статусам за период. Stripe сюда пока не входит — см. заметку ниже.">
                {methods.length ? (
                  <>
                    <BarChart key={rkey} data={methods} xDataKey="payment_method" barWidth={26}
                      aspectRatio="16 / 7" margin={{ top: 16, right: 52, bottom: 36, left: 12 }}>
                      <Grid horizontal />
                      <YAxis orientation="right" numTicks={4} formatValue={v => fmtN(v)} />
                      <Bar dataKey="success" fill={GOOD} lineCap={2} />
                      <Bar dataKey="pending" fill={WARN} lineCap={2} />
                      <Bar dataKey="failed" fill={CRIT} lineCap={2} />
                      <BarXAxis showAllLabels />
                      <ChartTooltip showDatePill={false} rows={(p: Row) => [
                        { color: GOOD, label: 'успех', value: fmtN(p.success) },
                        { color: WARN, label: 'в ожидании', value: fmtN(p.pending) },
                        { color: CRIT, label: 'отказ', value: fmtN(p.failed) },
                      ]} />
                    </BarChart>
                    <Legend items={statusLegend} />
                  </>
                ) : <EmptyNote />}
              </Card>

              <Card wide title="Stripe: оформление trial по плану" note="PostHog, из свойств событий (provider=stripe) — таблица fact_sales_transactions в Metabase Stripe ещё не получает, поэтому этих сумм там нет.">
                {(D.posthog_trial_by_plan ?? []).length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="pb-2 font-medium">Шаг</th>
                          <th className="pb-2 font-medium">План</th>
                          <th className="pb-2 pr-2 text-right font-medium">Кол-во</th>
                          <th className="pb-2 text-right font-medium">Сумма</th>
                        </tr>
                      </thead>
                      <tbody>
                        {D.posthog_trial_by_plan.map((r: Row, i: number) => (
                          <tr key={i} className="border-t border-border">
                            <td className="py-1.5">{r.step}</td>
                            <td className="py-1.5">{r.plan}</td>
                            <td className="py-1.5 pr-2 text-right font-medium">{fmtN(r.count)}</td>
                            <td className="py-1.5 text-right font-medium">${comma(r.amount.toFixed(2))} {r.currency?.toUpperCase()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyNote />}
              </Card>
            </div>
        </Section>

        <Section title="Управление подпиской">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-red-500">
            События выкачены на прод недавно — по всем пока 0, цифры появятся сами по мере использования
          </p>
          <Card wide title="Смена плана, отмена, реактивация, удаление аккаунта" note="PostHog, за всё время. Клики по шагам флоу — не только завершённые действия.">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Группа</th>
                    <th className="pb-2 font-medium">Шаг</th>
                    <th className="pb-2 text-right font-medium">Кол-во</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Смена плана', 'plan_change_clicked', 'Клик «сменить план»'],
                    ['Отмена', 'cancellation_support_clicked', 'Клик «Get support»'],
                    ['Отмена', 'cancellation_continued', 'Продолжил отмену'],
                    ['Отмена', 'cancellation_reason_submitted', 'Указал причину'],
                    ['Отмена', 'cancellation_kept', 'Передумал (Keep Base plan)'],
                    ['Отмена', 'cancellation_aborted', 'Передумал (Stay with Scope360)'],
                    ['Отмена', 'subscription_cancelled', 'Подписка отменена'],
                    ['Возврат', 'plan_reupgrade_link_clicked', 'Клик «вернуть план»'],
                    ['Возврат', 'subscription_reactivation_clicked', 'Клик «реактивировать»'],
                    ['Возврат', 'subscription_reactivated', 'Подписка реактивирована'],
                    ['Удаление аккаунта', 'account_deletion_flow_started', 'Начал удаление'],
                    ['Удаление аккаунта', 'account_deletion_verification_requested', 'Подтвердил причину'],
                    ['Удаление аккаунта', 'account_deletion_confirmed', 'Удаление завершено'],
                  ].map(([group, ev, label], i) => (
                    <tr key={ev} className="border-t border-border">
                      <td className="py-1.5 text-muted-foreground">{group}</td>
                      <td className="py-1.5">{label}</td>
                      <td className="py-1.5 text-right font-medium">{fmtN(posthogEvent(ev))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>

        <Section title="Откуда трафик">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Card wide title="UTM и партнёрские ссылки" note="По регистрациям; клики, оплаты и выручка — в подсказке. За всю историю.">
                <BarChart data={D.attribution_links.map((r: Row) => ({ ...r, label: r.kind === 'UTM' ? r.category : 'Партнёрская' }))}
                  xDataKey="label" orientation="horizontal" aspectRatio="16 / 6" margin={{ top: 8, right: 24, bottom: 8, left: 112 }}>
                  <Bar dataKey="regs" fill={C[2]} lineCap={3} />
                  <BarYAxis />
                  <ChartTooltip showDatePill={false} rows={(p: Row) => [
                    { color: C[2], label: 'регистраций', value: fmtN(p.regs) },
                    { color: 'transparent', label: 'кликов', value: fmtN(p.clicks) },
                    { color: 'transparent', label: 'оплат', value: fmtN(p.payments) },
                    { color: 'transparent', label: 'выручка', value: fmtM(p.revenue) },
                  ]} />
                </BarChart>
              </Card>
              <Card title="Каналы трафика (GA4)" note="Сессии на лендинг, за всю историю.">
                {(D.ga4_channels ?? []).length ? (
                  <BarChart data={D.ga4_channels} xDataKey="sessionDefaultChannelGroup" orientation="horizontal"
                    aspectRatio="16 / 9" margin={{ top: 8, right: 24, bottom: 8, left: 96 }}>
                    <Bar dataKey="sessions" fill={C[0]} lineCap={3} />
                    <BarYAxis />
                    <ChartTooltip showDatePill={false} rows={(p: Row) => [
                      { color: C[0], label: 'сессий', value: fmtN(p.sessions) },
                      { color: 'transparent', label: 'пользователей', value: fmtN(p.totalUsers) },
                      { color: 'transparent', label: 'вовлечённость', value: comma(p.engagementRate) + '%' },
                    ]} />
                  </BarChart>
                ) : <EmptyNote />}
              </Card>
            </div>
        </Section>
        </>)}

        <footer className="mt-11 text-xs text-muted-foreground">
          Обновление: <code>./build.sh</code> в папке scope-metabase.
          Все цифры — агрегаты, без персональных данных.
        </footer>
        </div>
      </div>
    </div>
  )
}
