"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { RosterCell } from "@/server/services/rosters";
import type { ShiftTemplate } from "@/server/db/schema";

/* ===========================================================================
   One day for one person.

   Colour carries state and nothing else. A rest day is the absence of a mark,
   not a grey block — the eye should land on what is scheduled.
   ========================================================================= */

export const DAY_TONE: Record<string, string> = {
  shift_day: "bg-accent-soft text-accent",
  shift_night: "bg-plan-soft text-plan",
  shift_swing: "bg-warn-soft text-warn",
  shift_other: "bg-neutral-soft text-text-2",
  travel_in: "bg-ok-soft text-ok",
  travel_out: "bg-ok-soft text-ok",
  // Leave is an overlay, deliberately unlike a shift: hatched, not filled.
  leave: "bg-[repeating-linear-gradient(135deg,var(--warn-soft),var(--warn-soft)3px,transparent_3px,transparent_6px)] text-warn",
};

export function cellTone(cell: RosterCell, template?: ShiftTemplate): string {
  if (cell.dayType === "leave") return DAY_TONE.leave;
  if (cell.dayType === "travel_in" || cell.dayType === "travel_out") return DAY_TONE.travel_in;
  if (cell.dayType !== "shift") return "";
  switch (template?.shiftType) {
    case "night":
      return DAY_TONE.shift_night;
    case "swing":
      return DAY_TONE.shift_swing;
    case "day":
      return DAY_TONE.shift_day;
    default:
      return DAY_TONE.shift_other;
  }
}

export function cellLabel(cell: RosterCell, template?: ShiftTemplate): string {
  switch (cell.dayType) {
    case "shift":
      return template?.code.slice(0, 1) ?? "S";
    case "travel_in":
      return "↓";
    case "travel_out":
      return "↑";
    case "leave":
      return "L";
    default:
      return "";
  }
}

export const RosterCellView = memo(function RosterCellView({
  cell,
  template,
  selected,
  focused,
  width,
  onMouseDown,
  onMouseEnter,
}: {
  cell: RosterCell | undefined;
  template: ShiftTemplate | undefined;
  selected: boolean;
  focused: boolean;
  width: number;
  onMouseDown: (event: React.MouseEvent) => void;
  onMouseEnter: () => void;
}) {
  const hasConflict = (cell?.conflicts.length ?? 0) > 0;

  return (
    <div
      role="gridcell"
      aria-selected={selected}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      style={{ width }}
      className={cn(
        "relative flex h-full shrink-0 select-none items-center justify-center border-r border-line-soft text-2xs font-medium",
        cell ? cellTone(cell, template) : "text-text-3",
        selected && "ring-1 ring-inset ring-accent",
        focused && "ring-2 ring-inset ring-accent",
        !cell && "hover:bg-surface-3",
      )}
    >
      {cell ? cellLabel(cell, template) : ""}
      {hasConflict && (
        // A conflict is a hard stop before publication, so it reads at a glance
        // and does not depend on hovering to discover.
        <span
          className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-danger"
          aria-label="Зөрчил"
        />
      )}
      {cell?.status === "confirmed" && (
        <span className="absolute bottom-0 left-0 h-px w-full bg-current opacity-40" aria-hidden />
      )}
    </div>
  );
});
