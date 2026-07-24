import { useMemo, useState } from 'react'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import countries110m from 'world-atlas/countries-110m.json'
import iso from 'i18n-iso-countries'
import ruLocale from 'i18n-iso-countries/langs/ru.json'

iso.registerLocale(ruLocale)

type Row = Record<string, any>

const WIDTH = 700
const HEIGHT = 360

export function WorldSpendMap({ data, fmtMoney, fmtNum }: {
  data: Row[]
  fmtMoney: (n: number) => string
  fmtNum: (n: number) => string
}) {
  const byAlpha2 = useMemo(() => {
    const m = new Map<string, Row>()
    for (const r of data) m.set(r.country, r)
    return m
  }, [data])

  const maxSpend = useMemo(() => Math.max(0.01, ...data.map(r => r.spend as number)), [data])

  const features = useMemo(() => {
    const topo = countries110m as unknown as Topology
    return (feature(topo, topo.objects.countries as any) as any).features as Array<{ id: string; properties?: any }>
  }, [])

  const pathGen = useMemo(() => {
    const fc = { type: 'FeatureCollection', features } as any
    const projection = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], fc)
    return geoPath(projection as any)
  }, [features])

  const [hover, setHover] = useState<{ x: number; y: number; row: Row | null; name: string } | null>(null)

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full">
        {features.map((f, i) => {
          const alpha2 = iso.numericToAlpha2(f.id) ?? ''
          const row = byAlpha2.get(alpha2)
          const name = alpha2 ? (iso.getName(alpha2, 'ru') ?? alpha2) : '—'
          const pct = row ? Math.round(15 + 75 * ((row.spend as number) / maxSpend)) : 0
          const fill = row ? `color-mix(in oklch, var(--chart-3) ${pct}%, var(--card))` : 'var(--muted)'
          return (
            <path
              key={`${f.id}-${i}`}
              d={pathGen(f as any) ?? ''}
              fill={fill}
              stroke="var(--card)"
              strokeWidth={0.6}
              onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, row: row ?? null, name })}
              onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
              onMouseLeave={() => setHover(null)}
              className="transition-opacity hover:opacity-80"
            />
          )
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none fixed z-30 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="mb-1 font-semibold text-foreground">{hover.name}</div>
          {hover.row ? (
            <div className="space-y-0.5 text-muted-foreground">
              <div>расходы: <b className="text-foreground">{fmtMoney(hover.row.spend)}</b></div>
              <div>регистраций: <b className="text-foreground">{fmtNum(hover.row.regs)}</b></div>
              <div>клики: <b className="text-foreground">{fmtNum(hover.row.clicks)}</b></div>
            </div>
          ) : (
            <div className="text-muted-foreground">нет рекламы</div>
          )}
        </div>
      )}
    </div>
  )
}
