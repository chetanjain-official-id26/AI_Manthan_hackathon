import { useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { ErrorBanner, SkeletonChart } from '@/components/ui/Display';

export interface TableColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
}

interface ChartCardProps<T> {
  title: string;
  description?: string;
  rows: T[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  columns: TableColumn<T>[];
  chart: (rows: T[]) => ReactNode;
  testId: string;
}

/** Card wrapper for every chart, with the accessible "View as table" toggle. */
export function ChartCard<T>({ title, description, rows, loading, error, onRetry, columns, chart, testId }: ChartCardProps<T>) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-slate-200/80 bg-white shadow-xs" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <header className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 id={`${testId}-title`} className="text-sm font-semibold tracking-tight text-slate-900">
            {title}
          </h2>
          {description && <p className="text-xs text-slate-500">{description}</p>}
        </div>
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          data-testid={`${testId}-toggle`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          {asTable ? <BarChart3 className="h-3.5 w-3.5" aria-hidden /> : <Table2 className="h-3.5 w-3.5" aria-hidden />}
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </header>
      <div className="min-h-[280px] flex-1 p-4">
        {loading ? (
          <SkeletonChart />
        ) : error ? (
          <ErrorBanner error={error} onRetry={onRetry} />
        ) : !rows || rows.length === 0 ? (
          <p className="flex h-[260px] items-center justify-center text-sm text-slate-600">No data for this period.</p>
        ) : asTable ? (
          <div className="max-h-[260px] overflow-y-auto">
            <table className="w-full text-sm" data-testid={`${testId}-table`}>
              <thead className="sticky top-0 bg-white text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  {columns.map((c) => (
                    <th key={c.header} scope="col" className={`px-2 py-1.5 ${c.align === 'right' ? 'text-right' : ''}`}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/80">
                {rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.header} className={`px-2 py-1.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-[260px] w-full" role="img" aria-label={`${title} chart. Use “View as table” for exact values.`}>
            {chart(rows)}
          </div>
        )}
      </div>
    </section>
  );
}
