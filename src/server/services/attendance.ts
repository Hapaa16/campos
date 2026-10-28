import "server-only";
import { addDays, format, startOfDay } from "date-fns";
import { db } from "@/server/db/store";
import { authorizeOn, query, requireOne, type DataContext } from "@/server/db/query";
import {
  deriveAttendance,
  validateClockEvent,
  type ClockEventLike,
  type PlannedShift,
} from "@/server/db/invariants";
import { canType } from "@/lib/authz/ability";
import { ConflictError, ValidationError } from "@/lib/errors";
import type {
  AttendanceCorrection,
  AttendanceEvent,
  AttendanceStatus,
  ISODate,
} from "@/server/db/schema";

/* ===========================================================================
   Attendance.

   The separation this module exists to protect, stated plainly because it is
   the easiest thing in the system to get wrong:

     - A camp accommodation check-in says someone slept here.
     - An attendance clock event says someone worked here.
     - A roster assignment says someone was SUPPOSED to work here.

   None of the three implies either of the others. A contractor can sleep in
   camp and never reach the pit; a day-trip crew can work a full shift and
   never book a bed; a roster can say both and be wrong about both. The
   reconciliation view below exists to surface exactly those disagreements
   rather than to paper over them.

   Nothing here is materialised. The daily record is a projection of roster +
   events + leave + corrections, so a late clock event or a retroactive leave
   approval changes the answer the next time it is asked — which is correct.
   ========================================================================= */

export interface AttendanceRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  displayName: string;
  avatarColor: string;
  jobTitle: string;
  orgUnitPath: string | null;
  orgUnitName: string | null;
  siteId: string;
  date: ISODate;

  rosterAssignmentId: string | null;
  shiftCode: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;

  actualStartAt: string | null;
  actualEndAt: string | null;
  source: AttendanceEvent["source"] | null;

  /** What the system concluded from the evidence. */
  derivedStatus: AttendanceStatus;
  /** What is shown — a supervisor's override when one exists. */
  status: AttendanceStatus;
  corrected: boolean;
  correctionReason: string | null;
  correctedBy: string | null;

  lateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes: number;

  /**
   * Whether this person has actually CHECKED IN to camp.
   *
   * `null` means the actor cannot read accommodation at all — which is not
   * the same as "not in camp". The gate officer seeing `false` everywhere
   * would read as "nobody is in camp" rather than "you cannot see this".
   */
  inCamp: boolean | null;
  /**
   * Whether a bed is reserved for them over this date, checked in or not.
   *
   * Distinct from `inCamp` on purpose. Someone holding a reservation they
   * have not checked into is a different situation from someone who commutes
   * and never had a bed — and only the second is a day-tripper.
   */
  hasCampBooking: boolean | null;
}

export interface AttendanceSummary {
  present: number;
  late: number;
  partial: number;
  absent: number;
  excused: number;
  unplanned: number;
  expected: number;
  /** Rostered people for the day — the denominator that matters. */
  rostered: number;
}

export interface Reconciliation {
  /** Checked into camp, but no work attendance observed. `null` = not visible. */
  inCampNotAtWork: AttendanceRow[] | null;
  /** At work with no bed booked at all — a commuter. `null` = not visible. */
  atWorkNotInCamp: AttendanceRow[] | null;
  /** Holds a reservation for tonight but has not checked in. */
  bookedNotCheckedIn: AttendanceRow[] | null;
  /** Worked without being rostered. */
  unrostered: AttendanceRow[];
  /** Rostered, shift over, nothing observed and no leave. */
  unexplainedAbsence: AttendanceRow[];
}

export interface AttendanceBoard {
  date: ISODate;
  sites: { id: string; name: string }[];
  siteId: string | null;
  rows: AttendanceRow[];
  summary: AttendanceSummary;
  reconciliation: Reconciliation;
  graceMinutes: number;
  canRecord: boolean;
  canCorrect: boolean;
}

export interface AttendanceBoardParams {
  date?: ISODate;
  siteId?: string;
  search?: string;
  status?: AttendanceStatus[];
  orgUnitPath?: string;
  /** Only rows where observation and plan disagree. */
  exceptionsOnly?: boolean;
}

const collator = new Intl.Collator("mn", { sensitivity: "base", numeric: true });

/** The site-local calendar date an instant falls on. */
function toLocalDate(instant: string): ISODate {
  return format(new Date(instant), "yyyy-MM-dd");
}

/** Statuses that represent a disagreement worth a human looking at it. */
const EXCEPTION_STATUSES: ReadonlySet<AttendanceStatus> = new Set([
  "late",
  "partial",
  "absent",
  "unplanned",
]);

export function getAttendanceBoard(
  ctx: DataContext,
  params: AttendanceBoardParams,
): AttendanceBoard {
  const data = db();
  const organization = data.organizations.find((o) => o.id === ctx.auth.organizationId);
  const graceMinutes = organization?.attendanceGraceMinutes ?? 10;
  const earlyLeaveGraceMinutes = organization?.earlyLeaveGraceMinutes ?? 10;

  const date = params.date ?? format(startOfDay(new Date()), "yyyy-MM-dd");
  const dayStart = startOfDay(new Date(`${date}T00:00:00`));
  // A night shift starting at 19:00 local runs into the next calendar day, so
  // the event window has to be wider than the day itself.
  const windowStart = addDays(dayStart, -1).toISOString();
  const windowEnd = addDays(dayStart, 2).toISOString();

  const sites = query(ctx, "Site", data.sites)
    .where((s) => s.status === "active")
    .all()
    .map((s) => ({ id: s.id, name: s.name }));
  const siteId = params.siteId && sites.some((s) => s.id === params.siteId)
    ? params.siteId
    : (sites.find((s) => s.id === "site_ot_mine")?.id ?? sites[0]?.id ?? null);

  /* -- the plan ---------------------------------------------------------- */
  const assignments = query(
    ctx,
    "RosterAssignment",
    data.rosterAssignments,
    (a) => a.date === date && a.dayType === "shift",
  )
    .where((a) => !siteId || a.siteId === siteId)
    .all();

  /* -- the observations -------------------------------------------------- */
  const events = query(
    ctx,
    "Attendance",
    // Clock events are the Attendance subject's stored form; they carry the
    // same organizationId and siteId the ability conditions are written against.
    data.attendanceEvents as unknown as (AttendanceEvent & { id: string; organizationId: string })[],
    (e) => e.occurredAt >= windowStart && e.occurredAt < windowEnd,
  )
    .where((e) => !siteId || e.siteId === siteId)
    .all();

  const eventsByEmployee = new Map<string, AttendanceEvent[]>();
  for (const event of events) {
    const list = eventsByEmployee.get(event.employeeId) ?? [];
    list.push(event);
    eventsByEmployee.set(event.employeeId, list);
  }

  /**
   * Pick the events that belong to THIS shift.
   *
   * Bucketing by calendar day is wrong in both directions: a night shift
   * crosses midnight, and someone rostered on consecutive days has a
   * neighbouring shift's clock-in sitting inside the same 24 hours. Attributing
   * those to the wrong day quietly turns an absence into attendance — which is
   * precisely the failure this module exists to prevent.
   *
   * So events are matched to the planned window with a tolerance either side,
   * and only fall back to a calendar day when there is no plan to match against.
   */
  const SHIFT_TOLERANCE_MS = 4 * 3_600_000;
  const eventsForShift = (
    employeeId: string,
    planned: PlannedShift | null,
  ): ClockEventLike[] => {
    const all = eventsByEmployee.get(employeeId) ?? [];
    if (planned) {
      const from = Date.parse(planned.startAt) - SHIFT_TOLERANCE_MS;
      const to = Date.parse(planned.endAt) + SHIFT_TOLERANCE_MS;
      return all.filter((e) => {
        const at = Date.parse(e.occurredAt);
        return at >= from && at <= to;
      });
    }
    // No plan: attribute by the site's local calendar day.
    return all.filter((e) => toLocalDate(e.occurredAt) === date);
  };

  /* -- leave, which outranks absence ------------------------------------- */
  const approvedLeave = query(
    ctx,
    "LeaveRequest",
    data.leaveRequests,
    (l) => l.status === "approved",
  ).all();

  /* -- corrections, a sparse overlay ------------------------------------- */
  const corrections = new Map(
    query(ctx, "Attendance", data.attendanceCorrections, (c) => c.date === date)
      .all()
      .map((c) => [c.employeeId, c]),
  );

  /* -- actual camp presence, for the reconciliation ---------------------- */
  const mayReadCamp = canType(ctx.ability, "read", "AccommodationBooking");

  let inCampEmployeeIds: Set<string> | null = null;
  let bookedEmployeeIds: Set<string> | null = null;
  if (mayReadCamp) {
    const dayStartIso = dayStart.toISOString();
    const dayEndIso = addDays(dayStart, 1).toISOString();

    const covering = query(
      ctx,
      "AccommodationBooking",
      data.accommodationBookings,
      (b) => b.employeeId !== null && b.startAt < dayEndIso && b.endAt > dayStartIso,
    ).all();

    // CHECKED IN specifically: a reservation is not a person in a bed.
    inCampEmployeeIds = new Set(
      covering.filter((b) => b.status === "checked_in").map((b) => b.employeeId!),
    );
    bookedEmployeeIds = new Set(
      covering
        .filter((b) => b.status === "reserved" || b.status === "checked_in")
        .map((b) => b.employeeId!),
    );
  }

  const employees = new Map(query(ctx, "Employee", data.employees).all().map((e) => [e.id, e]));
  const unitNames = new Map(query(ctx, "OrgUnit", data.orgUnits).all().map((u) => [u.id, u.name]));
  const shiftCodes = new Map(
    query(ctx, "ShiftTemplate", data.shiftTemplates).all().map((s) => [s.id, s.code]),
  );

  const now = new Date().toISOString();

  /* -- one row per rostered person, plus anyone observed unrostered ------- */
  const subjects = new Map<string, { assignment: (typeof assignments)[number] | null }>();
  for (const assignment of assignments) subjects.set(assignment.employeeId, { assignment });
  for (const [employeeId, employeeEvents] of eventsByEmployee) {
    if (subjects.has(employeeId)) continue;
    // Only count as unrostered attendance if something was observed on THIS
    // local day — the window deliberately spans neighbouring days.
    if (employeeEvents.some((e) => toLocalDate(e.occurredAt) === date)) {
      subjects.set(employeeId, { assignment: null });
    }
  }

  const rows: AttendanceRow[] = [];
  for (const [employeeId, { assignment }] of subjects) {
    const employee = employees.get(employeeId);
    if (!employee) continue; // outside this actor's scope

    const planned: PlannedShift | null =
      assignment && assignment.startAt && assignment.endAt
        ? {
            rosterAssignmentId: assignment.id,
            shiftTemplateId: assignment.shiftTemplateId,
            startAt: assignment.startAt,
            endAt: assignment.endAt,
          }
        : null;

    const onApprovedLeave =
      planned !== null &&
      approvedLeave.some(
        (l) =>
          l.employeeId === employeeId &&
          l.startAt < planned.endAt &&
          planned.startAt < l.endAt,
      );

    const shiftEvents = eventsForShift(employeeId, planned);
    const derivation = deriveAttendance(planned, shiftEvents, {
      graceMinutes,
      earlyLeaveGraceMinutes,
      now,
      onApprovedLeave,
    });

    // Nothing planned and nothing observed is not a row.
    if (!planned && !derivation.actualStartAt) continue;

    const correction = corrections.get(employeeId);

    rows.push({
      id: `${employeeId}|${date}`,
      employeeId,
      employeeCode: employee.employeeCode,
      displayName: employee.displayName,
      avatarColor: employee.avatarColor,
      jobTitle: employee.jobTitle,
      orgUnitPath: employee.orgUnitPath,
      orgUnitName: employee.orgUnitId ? (unitNames.get(employee.orgUnitId) ?? null) : null,
      siteId: assignment?.siteId ?? employee.siteId ?? siteId ?? "",
      date,
      rosterAssignmentId: planned?.rosterAssignmentId ?? null,
      shiftCode: assignment?.shiftTemplateId
        ? (shiftCodes.get(assignment.shiftTemplateId) ?? null)
        : null,
      plannedStartAt: planned?.startAt ?? null,
      plannedEndAt: planned?.endAt ?? null,
      actualStartAt: derivation.actualStartAt,
      actualEndAt: derivation.actualEndAt,
      source:
        (shiftEvents.find((e) => e.eventType === "clock_in") as AttendanceEvent | undefined)
          ?.source ?? null,
      derivedStatus: derivation.status,
      status: correction?.status ?? derivation.status,
      corrected: correction !== undefined,
      correctionReason: correction?.reason ?? null,
      correctedBy: correction?.correctedBy ?? null,
      lateMinutes: derivation.lateMinutes,
      earlyLeaveMinutes: derivation.earlyLeaveMinutes,
      workedMinutes: derivation.workedMinutes,
      inCamp: inCampEmployeeIds ? inCampEmployeeIds.has(employeeId) : null,
      hasCampBooking: bookedEmployeeIds ? bookedEmployeeIds.has(employeeId) : null,
    });
  }

  rows.sort((a, b) => collator.compare(a.displayName, b.displayName));

  /* -- reconciliation, computed before the user's filters ---------------- */
  // Both camp buckets require camp visibility; without it the comparison is
  // not "no mismatch", it is "cannot be computed".
  const reconciliation: Reconciliation = {
    inCampNotAtWork: mayReadCamp
      ? rows.filter(
          (r) =>
            r.inCamp === true &&
            (r.status === "absent" || r.status === "expected") &&
            r.actualStartAt === null,
        )
      : null,
    // Genuinely no bed, not merely "has not checked in yet" — otherwise the
    // list fills with people holding a reservation and tells you nothing.
    atWorkNotInCamp: mayReadCamp
      ? rows.filter((r) => r.hasCampBooking === false && r.actualStartAt !== null)
      : null,
    bookedNotCheckedIn: mayReadCamp
      ? rows.filter((r) => r.hasCampBooking === true && r.inCamp === false)
      : null,
    unrostered: rows.filter((r) => r.status === "unplanned"),
    unexplainedAbsence: rows.filter((r) => r.status === "absent"),
  };

  const summary = rows.reduce<AttendanceSummary>(
    (acc, row) => {
      acc[row.status] += 1;
      if (row.rosterAssignmentId) acc.rostered += 1;
      return acc;
    },
    { present: 0, late: 0, partial: 0, absent: 0, excused: 0, unplanned: 0, expected: 0, rostered: 0 },
  );

  /* -- the user's filters, applied last ---------------------------------- */
  let filtered = rows;
  if (params.search?.trim()) {
    const needle = params.search.trim().toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.displayName.toLowerCase().includes(needle) ||
        r.employeeCode.toLowerCase().includes(needle) ||
        r.jobTitle.toLowerCase().includes(needle),
    );
  }
  if (params.status?.length) {
    const set = new Set(params.status);
    filtered = filtered.filter((r) => set.has(r.status));
  }
  if (params.orgUnitPath) {
    const prefix = params.orgUnitPath;
    filtered = filtered.filter(
      (r) => r.orgUnitPath === prefix || (r.orgUnitPath?.startsWith(`${prefix}.`) ?? false),
    );
  }
  if (params.exceptionsOnly) {
    filtered = filtered.filter((r) => EXCEPTION_STATUSES.has(r.status));
  }

  return {
    date,
    sites,
    siteId,
    rows: filtered,
    summary,
    reconciliation,
    graceMinutes,
    canRecord: canType(ctx.ability, "create", "Attendance"),
    canCorrect: canType(ctx.ability, "update", "Attendance"),
  };
}

/* ------------------------------------------------------------- mutations -- */

export interface ClockInput {
  employeeId: string;
  eventType: "clock_in" | "clock_out";
  /** Defaults to now. A supervisor entering a missed punch may backdate it. */
  occurredAt?: string;
  source?: AttendanceEvent["source"];
  idempotencyKey?: string;
}

export function recordClockEvent(ctx: DataContext, input: ClockInput): AttendanceEvent {
  const data = db();
  const employee = requireOne(ctx, "Employee", data.employees, input.employeeId);

  if (employee.status === "terminated") {
    throw new ConflictError("Гарсан ажилтны ирц бүртгэх боломжгүй.");
  }

  const now = new Date().toISOString();
  const occurredAt = input.occurredAt ?? now;

  if (input.idempotencyKey) {
    const existing = data.attendanceEvents.find(
      (e) =>
        e.idempotencyKey === input.idempotencyKey &&
        e.organizationId === employee.organizationId,
    );
    // A flaky reader retrying must not produce two arrivals.
    if (existing) return existing;
  }

  const siteId = employee.siteId;
  if (!siteId) throw new ValidationError("Ажилтны талбай тодорхойгүй байна.");

  const sameDay = data.attendanceEvents.filter(
    (e) =>
      e.organizationId === employee.organizationId &&
      e.employeeId === employee.id &&
      e.occurredAt >= addDays(new Date(occurredAt), -1).toISOString() &&
      e.occurredAt <= occurredAt,
  );

  const problem = validateClockEvent(
    { employeeId: employee.id, eventType: input.eventType, occurredAt },
    sameDay,
    now,
  );
  if (problem) throw new ConflictError(problem);

  const event: AttendanceEvent = {
    id: `ae_${employee.organizationId}_${Date.now().toString(36)}_${data.attendanceEvents.length}`,
    organizationId: employee.organizationId,
    employeeId: employee.id,
    siteId,
    eventType: input.eventType,
    occurredAt,
    source: input.source ?? "manual",
    deviceId: null,
    recordedBy: ctx.auth.userId,
    attendanceRecordId: null,
    idempotencyKey: input.idempotencyKey ?? null,
  };

  authorizeOn(ctx, "create", "Attendance", {
    ...event,
    orgUnitPath: employee.orgUnitPath,
  });

  data.attendanceEvents.push(event);
  return event;
}

export interface CorrectionInput {
  employeeId: string;
  date: ISODate;
  status: AttendanceStatus;
  reason: string;
  note?: string;
}

/**
 * Override a derived status.
 *
 * The derived value is stored alongside, so the disagreement between what the
 * system observed and what a supervisor asserts stays visible rather than
 * being quietly replaced.
 */
export function correctAttendance(
  ctx: DataContext,
  input: CorrectionInput,
): AttendanceCorrection {
  const data = db();
  const employee = requireOne(ctx, "Employee", data.employees, input.employeeId);

  if (!input.reason.trim()) {
    throw new ValidationError("Залруулгын шалтгаан заавал бичнэ.");
  }
  if (input.date > format(startOfDay(new Date()), "yyyy-MM-dd")) {
    throw new ValidationError("Ирээдүйн өдрийн ирц залруулах боломжгүй.");
  }

  // Re-derive so the stored `derivedStatus` is what the system actually
  // concluded at the moment of the override, not a value sent by the client.
  const board = getAttendanceBoard(ctx, { date: input.date, siteId: employee.siteId ?? undefined });
  const row = board.rows.find((r) => r.employeeId === input.employeeId);
  const derivedStatus: AttendanceStatus = row?.derivedStatus ?? "absent";

  if (derivedStatus === input.status && !row?.corrected) {
    throw new ConflictError("Залруулах шаардлагагүй — төлөв аль хэдийн ийм байна.");
  }

  const scopeTarget = {
    id: `${input.employeeId}|${input.date}`,
    organizationId: employee.organizationId,
    orgUnitPath: employee.orgUnitPath,
    siteId: employee.siteId,
    employeeId: employee.id,
  };
  authorizeOn(ctx, "update", "Attendance", scopeTarget);

  const existingIndex = data.attendanceCorrections.findIndex(
    (c) =>
      c.organizationId === employee.organizationId &&
      c.employeeId === input.employeeId &&
      c.date === input.date,
  );

  const correction: AttendanceCorrection = {
    id:
      existingIndex >= 0
        ? data.attendanceCorrections[existingIndex].id
        : `ac_${employee.organizationId}_${Date.now().toString(36)}`,
    organizationId: employee.organizationId,
    employeeId: input.employeeId,
    siteId: employee.siteId ?? "",
    date: input.date,
    status: input.status,
    derivedStatus,
    reason: input.reason.trim(),
    correctedBy: ctx.auth.userId,
    correctedAt: new Date().toISOString(),
    note: input.note?.trim() || null,
  };

  if (existingIndex >= 0) data.attendanceCorrections[existingIndex] = correction;
  else data.attendanceCorrections.push(correction);

  return correction;
}
