import { flexRender, type Table } from '@tanstack/react-table';
import { cn } from '@/utils/misc';

interface DataTableProps<T> {
  table: Table<T>;
  testId: string;
  rowTestId: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  dense?: boolean;
}

/** Thin, accessible renderer for a TanStack Table instance. Column `meta.align` = 'right' aligns numbers. */
export function DataTable<T>({ table, testId, rowTestId, onRowClick, rowClassName, dense = true }: DataTableProps<T>) {
  const pad = dense ? 'px-3 py-2' : 'px-4 py-3';
  return (
    <div className="ef-table-wrap ef-scroll">
      <table className="w-full text-sm" data-testid={testId}>
        <thead className="ef-thead text-left font-semibold uppercase">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const meta = h.column.columnDef.meta as { align?: 'right'; className?: string } | undefined;
                return (
                  <th
                    key={h.id}
                    scope="col"
                    className={cn(pad, 'whitespace-nowrap', meta?.align === 'right' && 'text-right', meta?.className)}
                    aria-sort={
                      h.column.getIsSorted() === 'asc' ? 'ascending' : h.column.getIsSorted() === 'desc' ? 'descending' : undefined
                    }
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/80">
          {table.getRowModel().rows.map((row, i) => (
            <tr
              key={row.id}
              data-testid={rowTestId(row.original, i)}
              aria-selected={row.getCanSelect() ? row.getIsSelected() : undefined}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn(
                onRowClick && 'cursor-pointer',
                row.getIsSelected() ? 'bg-indigo-50' : 'hover:bg-slate-50',
                rowClassName?.(row.original),
              )}
            >
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as { align?: 'right'; className?: string } | undefined;
                return (
                  <td key={cell.id} className={cn(pad, meta?.align === 'right' && 'text-right', meta?.className)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
