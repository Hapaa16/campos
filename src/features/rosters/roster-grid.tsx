"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { parseISO } from "date-fns";
import { Avatar } from "@/components/ui/misc";
import { ROW_HEIGHT, useDensity } from "@/components/app/density";
import { cn } from "@/lib/utils";
import { RosterCellView } from "./cell";
import type { RosterGridData } from "@/server/services/rosters";
import type { StatusTone } from "@/components/ui/status-chip";

const NAME_COL = 220;

export interface CellRef {
  rowIndex: number;
  dateIndex: number;
}

export interface Selection {
  anchor: CellRef;
  focus: CellRef;
}

export function selectionBounds(selection: Selection) {
  return {
    minRow: Math.min(selection.anchor.rowIndex, selection.focus.rowIndex),
    maxRow: Math.max(selection.anchor.rowIndex, selection.focus.rowIndex),
    minDate: Math.min(selection.anchor.dateIndex, selection.focus.dateIndex),
    maxDate: Math.max(selection.anchor.dateIndex, selection.focus.dateIndex),
  };
}

export function selectionSize(selection: Selection | null) {
  if (!selection) return 0;
  const b = selectionBounds(selection);
  return (b.maxRow - b.minRow + 1) * (b.maxDate - b.minDate + 1);
}

/**
 * Employee rows against date columns.
 *
 * Rows are virtualized; the 28-odd date columns are not, because rendering
 * ~25 visible rows across 28 days is 700 cells — cheap, and it keeps
 * horizontal scrolling perfectly smooth.
 */
export function RosterGrid({
  data,
  selection,
  onSelectionChange,
  columnWidth = 34,
}: {
  data: RosterGridData;
  selection: Selection | null;
  onSelectionChange: (selection: Selection | null) => void;
  columnWidth?: number;
}) {
  const t = useTranslations("roster");
  const { density } = useDensity();
  const rowHeight = ROW_HEIGHT[density];
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const templates = React.useMemo(
    () => new Map(data.shiftTemplates.map((s) => [s.id, s])),
    [data.shiftTemplates],
  );

  const virtualizer = useVirtualizer({
    count: data.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });
  React.useEffect(() => virtualizer.measure(), [rowHeight, virtualizer]);

  // Dragging must end even if the pointer leaves the grid, or the selection
  // keeps growing after the user has let go.
  React.useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, [dragging]);

  const bounds = selection ? selectionBounds(selection) : null;
  const isSelected = (rowIndex: number, dateIndex: number) =>
    bounds !== null &&
    rowIndex >= bounds.minRow &&
    rowIndex <= bounds.maxRow &&
    dateIndex >= bounds.minDate &&
    dateIndex <= bounds.maxDate;

  const maxCoverage = Math.max(1, ...Object.values(data.coverageByDate));
  const gridWidth = data.dates.length * columnWidth;

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={t("title")}
      aria-rowcount={data.rows.length}
      aria-colcount={data.dates.length}
      tabIndex={0}
      className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-soft"
    >
      <div style={{ width: NAME_COL + gridWidth }} className="relative">
        {/* ---- header: dates + coverage strip ---------------------------- */}
        <div className="sticky top-0 z-20 flex border-b border-line bg-canvas">
          <div
            style={{ width: NAME_COL }}
            className="sticky left-0 z-10 shrink-0 border-r border-line bg-canvas px-[var(--cell-px)] py-1.5 text-2xs font-semibold uppercase tracking-wider text-text-3"
          >
            {t("title")}
          </div>
          {data.dates.map((date, index) => {
            const day = parseISO(date);
            const weekday = day.getDay();
            const isWeekend = weekday === 0 || weekday === 6;
            const coverage = data.coverageByDate[date] ?? 0;
            const inSelection =
              bounds !== null && index >= bounds.minDate && index <= bounds.maxDate;

            return (
              <div
                key={date}
                style={{ width: columnWidth }}
                className={cn(
                  "shrink-0 border-r border-line-soft px-0.5 py-1 text-center",
                  isWeekend && "bg-surface-inset",
                  inSelection && "bg-accent-soft",
                )}
              >
                <div className="text-2xs leading-none text-text-3">
                  {["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"][weekday]}
                </div>
                <div className="tnum text-xs font-medium leading-tight text-text-2">
                  {day.getDate()}
                </div>
                {/* Coverage bar: how many people are on shift that day. */}
                <div
                  className="mx-auto mt-0.5 w-3 rounded-sm bg-accent/70"
                  style={{ height: Math.max(1, Math.round((coverage / maxCoverage) * 10)) }}
                  title={`${coverage}`}
                  aria-hidden
                />
              </div>
            );
          })}
        </div>

        {/* ---- rows ------------------------------------------------------ */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualRows.map((virtualRow) => {
            const row = data.rows[virtualRow.index];
            return (
              <div
                key={row.employeeId}
                role="row"
                className="absolute left-0 flex border-b border-line-soft"
                style={{
                  top: virtualRow.start,
                  height: rowHeight,
                  width: NAME_COL + gridWidth,
                }}
              >
                <div
                  style={{ width: NAME_COL }}
                  className={cn(
                    "sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-canvas px-[var(--cell-px)]",
                    bounds !== null &&
                      virtualRow.index >= bounds.minRow &&
                      virtualRow.index <= bounds.maxRow &&
                      "bg-accent-soft",
                  )}
                >
                  <Avatar
                    name={row.displayName}
                    tone={row.avatarColor as StatusTone}
                    size="sm"
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-text">{row.displayName}</span>
                    {density !== "dense" && (
                      <span className="block truncate text-2xs text-text-3">
                        {row.patternName ?? row.jobTitle}
                      </span>
                    )}
                  </span>
                  <span className="tnum shrink-0 text-2xs text-text-3">{row.shiftCount}</span>
                </div>

                {data.dates.map((date, dateIndex) => {
                  const cell = row.cells[date];
                  const focused =
                    selection?.focus.rowIndex === virtualRow.index &&
                    selection.focus.dateIndex === dateIndex;

                  return (
                    <RosterCellView
                      key={date}
                      cell={cell}
                      template={cell?.shiftTemplateId ? templates.get(cell.shiftTemplateId) : undefined}
                      selected={isSelected(virtualRow.index, dateIndex)}
                      focused={Boolean(focused)}
                      width={columnWidth}
                      onMouseDown={(event) => {
                        if (!data.canEdit) return;
                        const target = { rowIndex: virtualRow.index, dateIndex };
                        setDragging(true);
                        if (event.shiftKey && selection) {
                          onSelectionChange({ anchor: selection.anchor, focus: target });
                        } else {
                          onSelectionChange({ anchor: target, focus: target });
                        }
                      }}
                      onMouseEnter={() => {
                        if (!dragging || !selection) return;
                        onSelectionChange({
                          anchor: selection.anchor,
                          focus: { rowIndex: virtualRow.index, dateIndex },
                        });
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { NAME_COL };
