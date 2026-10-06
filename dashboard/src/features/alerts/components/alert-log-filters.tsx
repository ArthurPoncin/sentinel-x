import type { ReactNode } from 'react'
import { AlertKindSchema, AlertSourceSchema, SeveritySchema } from '@/shared/contract'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { KIND_LABEL, SEVERITY_LABEL, SOURCE_LABEL } from '../utils/describe'
import { isFiltering, type LogFilter, NO_FILTER, toggle } from '../utils/log-filter'

const STATE_LABEL = { all: 'Toutes', raised: 'Levées', cleared: 'Résolues' } as const

// shadcn has no native select here: a plain one, dressed as its Input.
const selectClass =
  'h-8 w-full rounded-lg sm:w-auto border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-popover'

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

// The bar over the Alert log: hours, severity, kind, source and state. Every change applies at once.
export function AlertLogFilters({ filter, onChange }: { filter: LogFilter; onChange: (filter: LogFilter) => void }) {
  const set = (patch: Partial<LogFilter>) => onChange({ ...filter, ...patch })

  return (
    // On a phone, two columns, hours and severity across both; from sm on, one row that wraps.
    <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap sm:gap-x-4">
      <Field label="Heures" className="col-span-2 sm:col-auto">
        <div className="flex items-center gap-1.5">
          <Input type="time" aria-label="De" className="min-w-0 flex-1 sm:w-28 sm:flex-none" value={filter.from} onChange={(e) => set({ from: e.target.value })} />
          <span className="text-sm text-muted-foreground">à</span>
          <Input type="time" aria-label="À" className="min-w-0 flex-1 sm:w-28 sm:flex-none" value={filter.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
      </Field>

      <Field label="Gravité" className="col-span-2 sm:col-auto">
        <div className="grid grid-cols-3 gap-1.5 sm:flex" role="group" aria-label="Gravité">
          {SeveritySchema.options.map((severity) => {
            const on = filter.severities.includes(severity)
            return (
              <Button
                key={severity}
                size="sm"
                variant={on ? 'secondary' : 'outline'}
                aria-pressed={on}
                className={cn('h-8', on && 'ring-1 ring-ring')}
                onClick={() => set({ severities: toggle(filter.severities, severity) })}
              >
                <span data-severity={severity}>●</span>
                {SEVERITY_LABEL[severity]}
              </Button>
            )
          })}
        </div>
      </Field>

      <Field label="Type">
        <select
          aria-label="Type"
          className={selectClass}
          value={filter.kind}
          onChange={(e) => set({ kind: e.target.value as LogFilter['kind'] })}
        >
          <option value="all">Tous</option>
          {AlertKindSchema.options.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Source">
        <select
          aria-label="Source"
          className={selectClass}
          value={filter.source}
          onChange={(e) => set({ source: e.target.value as LogFilter['source'] })}
        >
          <option value="all">Toutes</option>
          {AlertSourceSchema.options.map((source) => (
            <option key={source} value={source}>
              {SOURCE_LABEL[source]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="État">
        <select
          aria-label="État"
          className={selectClass}
          value={filter.state}
          onChange={(e) => set({ state: e.target.value as LogFilter['state'] })}
        >
          {(Object.keys(STATE_LABEL) as (keyof typeof STATE_LABEL)[]).map((state) => (
            <option key={state} value={state}>
              {STATE_LABEL[state]}
            </option>
          ))}
        </select>
      </Field>

      <Button size="sm" variant="ghost" className="col-span-2 h-8 sm:col-auto" disabled={!isFiltering(filter)} onClick={() => onChange(NO_FILTER)}>
        Réinitialiser
      </Button>
    </div>
  )
}
