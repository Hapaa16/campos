"use client";

import * as React from "react";
import {
  useTable,
  tableFeatures,
  rowSelectionFeature,
  columnVisibilityFeature,
  createCoreRowModel,
  flexRender,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRowHeight } from "@/components/app/density";

/* ===========================================================================
   Dense data table.

   Rows are virtualized, so a 1,200-row page stays responsive and the density
   setting changes real row geometry rather than just padding.

   Sorting is CONTROLLED by the caller, not owned here: the authoritative sort
   happens server-side over the whole result set, and a table that sorted its
   own page would silently reorder 100 rows out of 1,200 and look like it had
   worked.
   ========================================================================= */

const features = tableFeatures({
  rowSelectionFeature,
  columnVisibilityFeature,
  coreRowModel: createCoreRowModel(),
});

export type TableFeatures = typeof features;
export type Column<T extends RowData> = ColumnDef<TableFeatures, T>;

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

/** Initial visibility from each column's `defaultHidden` meta flag. */
export function defaultColumnVisibility<T extends RowData & { id: string }>(
  columns: Column<T>[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const column of columns) {
    const meta = column.meta as ColumnMeta | undefined;
    if (meta?.defaultHidden && column.id) out[column.id] = false;
  }
  return out;
}

export function DataTable<T extends RowData & { id: string }>({
  data,
  columns,
  sort,
  onSortChange,
  onRowClick,
  selectedId,
  empty,
  className,
  columnVisibility,
  onColumnVisibilityChange,
}: {
  data: T[];
  columns: Column<T>[];
  sort?: SortState;
  onSortChange?: (key: string) => void;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
  empty?: React.ReactNode;
  className?: string;
  columnVisibility?: Record<string, boolean>;
  onColumnVisibilityChange?: (next: Record<string, boolean>) => void;
}) {
  const rowHeight = useRowHeight();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const table = useTable({
    features,
    columns,
    data,
    getRowId: (row) => row.id,
    state: columnVisibility ? { columnVisibility } : undefined,
    onColumnVisibilityChange: onColumnVisibilityChange
      ? (updater) =>
          onColumnVisibilityChange(
            typeof updater === "function" ? updater(columnVisibility ?? {}) : updater,
          )
      : undefined,
  });

  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  // Row height is a token, so re-measure when the user changes density.
  React.useEffect(() => virtualizer.measure(), [rowHeight, virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom = totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0);

  if (data.length === 0 && empty) {
    return <div className={className}>{empty}</div>;
  }

  return (
    <div ref={scrollRef} className={cn("relative overflow-auto", className)}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                const sortable = Boolean(meta?.sortKey && onSortChange);
                const active = sort?.key === meta?.sortKey;

                return (
                  <th
                    key={header.id}
                    scope="col"
                    style={{ width: meta?.width }}
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn(
                      "border-b border-line bg-canvas px-[var(--cell-px)] py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-text-3",
                      meta?.align === "right" && "text-right",
                      meta?.numeric && "tnum",
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSortChange!(meta!.sortKey!)}
                        className="ui-transition inline-flex items-center gap-1 rounded-[3px] hover:text-text-2 focus-visible:ring-2 focus-visible:ring-accent-soft"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {active ? (
                          sort!.dir === "asc" ? (
                            <ArrowUp className="size-3 text-accent" />
                          ) : (
                            <ArrowDown className="size-3 text-accent" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>

        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden>
              <td style={{ height: paddingTop }} colSpan={columns.length} />
            </tr>
          )}

          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            const original = row.original as T;
            const isSelected = selectedId === original.id;

            return (
              <tr
                key={row.id}
                data-index={virtualRow.index}
                onClick={onRowClick ? () => onRowClick(original) : undefined}
                className={cn(
                  "ui-transition border-b border-line-soft",
                  onRowClick && "cursor-pointer",
                  isSelected ? "bg-accent-soft" : "hover:bg-surface-3",
                )}
                style={{ height: rowHeight }}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "truncate px-[var(--cell-px)] text-text-2",
                        meta?.align === "right" && "text-right",
                        meta?.numeric && "tnum",
                      )}
                      style={{ maxWidth: meta?.width }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {paddingBottom > 0 && (
            <tr aria-hidden>
              <td style={{ height: paddingBottom }} colSpan={columns.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export interface ColumnMeta {
  /** Server-side sort key; omit to make the column unsortable. */
  sortKey?: string;
  width?: number | string;
  align?: "left" | "right";
  /** Applies tabular figures, so the column aligns digit-for-digit. */
  numeric?: boolean;
  /** Secondary detail — off by default, reachable from the column menu. */
  defaultHidden?: boolean;
}
