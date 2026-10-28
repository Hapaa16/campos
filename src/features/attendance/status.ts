import type { AttendanceStatus } from "@/server/db/schema";
import type { StatusTone } from "@/components/ui/status-chip";

/**
 * Status vocabulary.
 *
 * `absent` and `excused` are deliberately different tones: one is a conduct
 * question, the other is an approved arrangement. Rendering them the same
 * colour is how a leave register quietly becomes a disciplinary record.
 */
export const STATUS_TONE: Record<AttendanceStatus, StatusTone> = {
  present: "ok",
  late: "warn",
  partial: "warn",
  absent: "danger",
  excused: "plan",
  unplanned: "accent",
  expected: "neutral",
};

export const STATUS_KEY: Record<AttendanceStatus, string> = {
  present: "statusPresent",
  late: "statusLate",
  partial: "statusPartial",
  absent: "statusAbsent",
  excused: "statusExcused",
  unplanned: "statusUnplanned",
  expected: "statusExpected",
};

/** Order used for the summary strip: most actionable first. */
export const SUMMARY_ORDER: AttendanceStatus[] = [
  "present",
  "late",
  "partial",
  "absent",
  "excused",
  "unplanned",
  "expected",
];

export const SOURCE_KEY: Record<string, string> = {
  terminal: "sourceTerminal",
  biometric: "sourceBiometric",
  manual: "sourceManual",
  import: "sourceImport",
  mobile: "sourceMobile",
};

/** Statuses a supervisor may assert when overriding. */
export const CORRECTABLE_STATUSES: AttendanceStatus[] = [
  "present",
  "late",
  "partial",
  "absent",
  "excused",
];
