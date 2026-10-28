import { format as formatFn } from "date-fns";

/* ===========================================================================
   Date and number formatting.

   Deliberately NOT locale-dependent for compact dates.

   Two reasons, one of which is a hard constraint:

   1. Browser ICU does not ship Mongolian date data — `Intl.DateTimeFormat('mn')`
      silently resolves to en-US — while Node's full ICU does. Any locale-aware
      compact date therefore renders "2026.09.28" on the server and "9/28/26"
      in the browser, which is a hydration mismatch on every table in the app.

   2. "9/28" and "28/9" are the same string to a machine and opposite dates to
      a person. A roster read by Mongolian and expat crews on the same shift
      cannot afford that ambiguity.

   So compact dates use one explicit, unambiguous pattern everywhere.
   ========================================================================= */

/** 2026.09.28 — sorts correctly, reads the same in every locale. */
export function formatDate(value: string | Date): string {
  return formatFn(typeof value === "string" ? new Date(value) : value, "yyyy.MM.dd");
}

/** 09.28 — for a dense column where the year is already established. */
export function formatDayMonth(value: string | Date): string {
  return formatFn(typeof value === "string" ? new Date(value) : value, "MM.dd");
}

/** 2026.09.28 14:30 */
export function formatDateTime(value: string | Date): string {
  return formatFn(typeof value === "string" ? new Date(value) : value, "yyyy.MM.dd HH:mm");
}

/** 14:30 */
export function formatTime(value: string | Date): string {
  return formatFn(typeof value === "string" ? new Date(value) : value, "HH:mm");
}

/** 2026.09.28 → 2026.10.12 */
export function formatDateRange(from: string | Date, to: string | Date): string {
  return `${formatDate(from)} → ${formatDate(to)}`;
}
