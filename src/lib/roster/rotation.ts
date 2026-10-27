import { TZDate } from "@date-fns/tz";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { ISODate, ISODateTime, RotationSlot, ShiftTemplate } from "@/server/db/schema";

/* ===========================================================================
   Rotation generation.

   Deterministic and explainable by design — given the same pattern, anchor and
   range it always produces the same days, and every produced day can be traced
   back to a cycle index. No optimisation engine until the basic workflow is
   proven reliable.

   The anchor is per employee, not per company: a 14/14 crew rotating from the
   3rd and another from the 10th are both normal, and assuming a shared start
   date is the classic way rosters come out silently wrong.
   ========================================================================= */

export interface RotationRequest {
  configuration: RotationSlot[];
  /** The employee's own day-0 for this cycle. */
  anchorDate: ISODate;
  rangeStart: ISODate;
  /** Inclusive. */
  rangeEnd: ISODate;
  /** Extra whole-day shift, used to stagger teams on the same pattern. */
  teamOffset?: number;
}

export interface RotationDay {
  date: ISODate;
  /** Index into the pattern cycle — what makes a generated day explainable. */
  cycleIndex: number;
  slot: RotationSlot;
}

export function generateRotationDays(req: RotationRequest): RotationDay[] {
  const cycleLength = req.configuration.length;
  if (cycleLength === 0) return [];

  const anchor = parseISO(req.anchorDate);
  const start = parseISO(req.rangeStart);
  const end = parseISO(req.rangeEnd);
  const span = differenceInCalendarDays(end, start);
  if (span < 0) return [];

  const offset = req.teamOffset ?? 0;
  const out: RotationDay[] = [];

  for (let i = 0; i <= span; i++) {
    const date = addDays(start, i);
    const fromAnchor = differenceInCalendarDays(date, anchor) + offset;
    // Double modulo keeps the index non-negative for dates before the anchor.
    const cycleIndex = ((fromAnchor % cycleLength) + cycleLength) % cycleLength;
    out.push({
      date: format(date, "yyyy-MM-dd"),
      cycleIndex,
      slot: req.configuration[cycleIndex],
    });
  }
  return out;
}

export function isRest(slot: RotationSlot): slot is { rest: true } {
  return "rest" in slot;
}
export function isTravel(slot: RotationSlot): slot is { travel: "in" | "out" } {
  return "travel" in slot;
}
export function isShift(slot: RotationSlot): slot is { shiftTemplateId: string } {
  return "shiftTemplateId" in slot;
}

/* ---------------------------------------------------------------------------
   Local wall-clock → UTC.

   Shift templates carry site-local times ("19:00"), and every timestamp is
   stored in UTC. Converting through the site's IANA zone — rather than a fixed
   offset — is what keeps a site in a DST-observing country correct.
   --------------------------------------------------------------------------- */

export interface ShiftWindow {
  startAt: ISODateTime;
  endAt: ISODateTime;
  /** True when the shift runs past midnight into the following local day. */
  crossesMidnight: boolean;
}

export function resolveShiftWindow(
  date: ISODate,
  template: Pick<ShiftTemplate, "startTime" | "endTime">,
  timeZone: string,
): ShiftWindow {
  const [sh, sm] = template.startTime.split(":").map(Number);
  const [eh, em] = template.endTime.split(":").map(Number);
  const [y, m, d] = date.split("-").map(Number);

  const start = new TZDate(y, m - 1, d, sh, sm, 0, timeZone);
  const crossesMidnight = eh * 60 + em <= sh * 60 + sm;
  const endBase = crossesMidnight ? addDays(new Date(y, m - 1, d), 1) : new Date(y, m - 1, d);
  const end = new TZDate(
    endBase.getFullYear(),
    endBase.getMonth(),
    endBase.getDate(),
    eh,
    em,
    0,
    timeZone,
  );

  return {
    startAt: new Date(start.getTime()).toISOString(),
    endAt: new Date(end.getTime()).toISOString(),
    crossesMidnight,
  };
}

/** Hours a shift occupies, net of its unpaid break. */
export function shiftHours(window: ShiftWindow, breakMinutes: number): number {
  const ms = Date.parse(window.endAt) - Date.parse(window.startAt);
  return Math.round((ms / 3_600_000 - breakMinutes / 60) * 100) / 100;
}
