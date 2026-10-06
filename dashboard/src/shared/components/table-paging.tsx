import type { ReactNode } from 'react'
import { plural } from '@/shared/lib/labels'
import type { Page, SortOrder } from '@/shared/lib/paging'
import { Button } from '@/shared/ui/button'

// A column header that sorts by time: one press flips newest-first and oldest-first, the arrow says which.
export function SortByTime({ order, onChange, children }: { order: SortOrder; onChange: (order: SortOrder) => void; children: ReactNode }) {
  const newestFirst = order === 'desc'
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground"
      title={newestFirst ? 'Du plus récent au plus ancien' : 'Du plus ancien au plus récent'}
      onClick={() => onChange(newestFirst ? 'asc' : 'desc')}
    >
      {children}
      <span aria-hidden>{newestFirst ? '↓' : '↑'}</span>
    </button>
  )
}

// Under a table: where we are in it, and the way through it.
// `noun` in the singular: "alerte" reads "1–10 sur 64 alertes".
export function Pager<T>({ page, onChange, noun }: { page: Page<T>; onChange: (page: number) => void; noun: string }) {
  if (page.total === 0) return null
  return (
    // On a phone the count sits over the buttons, both centred, and the buttons lose their words.
    <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground sm:flex-row sm:justify-between">
      <span className="tabular-nums">
        {page.first}–{page.last} sur {plural(page.total, noun)}
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" aria-label="Première page" disabled={page.page === 1} onClick={() => onChange(1)}>
          «
        </Button>
        <Button size="sm" variant="outline" aria-label="Page précédente" disabled={page.page === 1} onClick={() => onChange(page.page - 1)}>
          ‹<span className="hidden sm:inline"> Précédente</span>
        </Button>
        <span className="px-2 whitespace-nowrap tabular-nums">
          Page {page.page} / {page.pages}
        </span>
        <Button size="sm" variant="outline" aria-label="Page suivante" disabled={page.page === page.pages} onClick={() => onChange(page.page + 1)}>
          <span className="hidden sm:inline">Suivante </span>›
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label="Dernière page"
          disabled={page.page === page.pages}
          onClick={() => onChange(page.pages)}
        >
          »
        </Button>
      </div>
    </div>
  )
}
