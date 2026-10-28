import "server-only";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { db } from "@/server/db/store";
import { authorizeOn, query, requireOne, type DataContext } from "@/server/db/query";
import {
  dedupeConflicts,
  findLeaveConflicts,
  findOverlappingShifts,
  findQualificationGaps,
  findRestViolations,
  type RosterConflict,
} from "@/server/db/invariants";
import { generateRotationDays, isShift, isTravel, resolveShiftWindow } from "@/lib/roster/rotation";
import { ConflictError, ValidationError } from "@/lib/errors";
import { canType } from "@/lib/authz/ability";
import type {
  ISODate,
  RosterAssignment,
  RosterPeriod,
  ShiftTemplate,
} from "@/server/db/schema";

/* ===========================================================================
   Roster reads and edits.

   Deterministic and explainable: a generated day can always be traced to a
   pattern, an anchor date and a cycle index. No optimisation engine until the
   basic workflow is reliable.
   ========================================================================= */

export interface RosterCell {
  employeeId: string;
  date: ISODate;
  assignmentId: string | null;
  dayType: RosterAssignment["dayType"];
  shiftTemplateId: string | null;
  status: RosterAssignment["status"];
  conflicts: RosterConflict[];
}

export interface RosterRow {
  employeeId: string;
  employeeCode: string;
  displayName: string;
  avatarColor: string;
  jobTitle: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  patternName: string | null;
  anchorDate: ISODate | null;
  /** Keyed by date — a sparse map, because a rest day stores no row. */
  cells: Record<string, RosterCell>;
  shiftCount: number;
}

export interface RosterGridData {
  period: RosterPeriod;
  periods: { id: string; name: string; status: RosterPeriod["status"]; startDate: ISODate; endDate: ISODate }[];
  dates: ISODate[];
  rows: RosterRow[];
  shiftTemplates: ShiftTemplate[];
  totalConflicts: number;
  /** Shift headcount per date, for the coverage strip under the header. */
  coverageByDate: Record<string, number>;
  canEdit: boolean;
  canPublish: boolean;
}

export interface RosterGridParams {
  periodId?: string;
  search?: string;
  orgUnitPath?: string;
  /** Only rows that have at least one conflict. */
  conflictsOnly?: boolean;
  offset?: number;
  limit?: number;
}

const collator = new Intl.Collator("mn", { sensitivity: "base", numeric: true });

function datesBetween(start: ISODate, end: ISODate): ISODate[] {
  const span = differenceInCalendarDays(parseISO(end), parseISO(start));
  return Array.from({ length: Math.max(0, span + 1) }, (_, i) =>
    format(addDays(parseISO(start), i), "yyyy-MM-dd"),
  );
}

export function getRosterGrid(ctx: DataContext, params: RosterGridParams): RosterGridData | null {
  const data = db();

  const periods = query(ctx, "RosterPeriod", data.rosterPeriods)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .all();
  if (periods.length === 0) return null;

  const period = params.periodId
    ? (periods.find((p) => p.id === params.periodId) ?? periods[0])
    : (periods.find((p) => p.status !== "archived") ?? periods[0]);

  const dates = datesBetween(period.startDate, period.endDate);
  const dateSet = new Set(dates);

  const assignments = query(
    ctx,
    "RosterAssignment",
    data.rosterAssignments,
    // Narrow to this period first: evaluating row conditions across every
    // assignment in the organization to keep one period's worth is wasted work.
    (a) => a.rosterPeriodId === period.id && dateSet.has(a.date),
  ).all();

  const byEmployee = new Map<string, RosterAssignment[]>();
  for (const a of assignments) {
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push(a);
    byEmployee.set(a.employeeId, list);
  }

  /* Employees shown are those rostered in this period, plus anyone at the
     period's site who could be — an empty row is how you notice someone was
     left out, so it must be visible rather than filtered away. */
  let employees = query(ctx, "Employee", data.employees)
    .where((e) => e.status !== "terminated" && (e.siteId === period.siteId || byEmployee.has(e.id)))
    .all();

  if (params.search?.trim()) {
    const needle = params.search.trim().toLowerCase();
    employees = employees.filter(
      (e) =>
        e.displayName.toLowerCase().includes(needle) ||
        e.employeeCode.toLowerCase().includes(needle) ||
        e.jobTitle.toLowerCase().includes(needle),
    );
  }

  if (params.orgUnitPath) {
    const prefix = params.orgUnitPath;
    employees = employees.filter(
      (e) => e.orgUnitPath === prefix || (e.orgUnitPath?.startsWith(`${prefix}.`) ?? false),
    );
  }

  const leave = query(ctx, "LeaveRequest", data.leaveRequests)
    .where((l) => l.status === "approved")
    .all();
  const leaveByEmployee = new Map<string, typeof leave>();
  for (const l of leave) {
    const list = leaveByEmployee.get(l.employeeId) ?? [];
    list.push(l);
    leaveByEmployee.set(l.employeeId, list);
  }

  const unitNames = new Map(query(ctx, "OrgUnit", data.orgUnits).all().map((u) => [u.id, u.name]));
  const patternNames = new Map(
    query(ctx, "RosterPattern", data.rosterPatterns).all().map((p) => [p.id, p.name]),
  );

  const coverageByDate: Record<string, number> = Object.fromEntries(dates.map((d) => [d, 0]));
  const allConflicts: RosterConflict[] = [];

  const rows: RosterRow[] = employees
    .sort((a, b) => collator.compare(a.displayName, b.displayName))
    .map((employee) => {
      const own = byEmployee.get(employee.id) ?? [];
      const ownLeave = leaveByEmployee.get(employee.id) ?? [];
      const cells: Record<string, RosterCell> = {};
      let shiftCount = 0;

      for (const assignment of own) {
        const conflicts: RosterConflict[] = dedupeConflicts([
          ...findOverlappingShifts(assignment, own),
          ...findLeaveConflicts(assignment, ownLeave),
          ...findRestViolations(assignment, own, 10),
        ]);
        allConflicts.push(...conflicts);

        if (assignment.dayType === "shift") {
          shiftCount++;
          coverageByDate[assignment.date] = (coverageByDate[assignment.date] ?? 0) + 1;
        }

        cells[assignment.date] = {
          employeeId: employee.id,
          date: assignment.date,
          assignmentId: assignment.id,
          dayType: assignment.dayType,
          shiftTemplateId: assignment.shiftTemplateId,
          status: assignment.status,
          conflicts,
        };
      }

      // Approved leave is an overlay: it is drawn on days with no assignment
      // too, because "off on leave" and "off on rotation" are different facts.
      for (const l of ownLeave) {
        for (const date of dates) {
          if (cells[date]) continue;
          const dayStart = `${date}T00:00:00.000Z`;
          if (l.startAt <= dayStart && l.endAt > dayStart) {
            cells[date] = {
              employeeId: employee.id,
              date,
              assignmentId: null,
              dayType: "leave",
              shiftTemplateId: null,
              status: "planned",
              conflicts: [],
            };
          }
        }
      }

      return {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        displayName: employee.displayName,
        avatarColor: employee.avatarColor,
        jobTitle: employee.jobTitle,
        orgUnitId: employee.orgUnitId,
        orgUnitName: employee.orgUnitId ? (unitNames.get(employee.orgUnitId) ?? null) : null,
        patternName: employee.rotationPatternId
          ? (patternNames.get(employee.rotationPatternId) ?? null)
          : null,
        anchorDate: employee.rotationAnchorDate,
        cells,
        shiftCount,
      };
    });

  const filtered = params.conflictsOnly
    ? rows.filter((r) => Object.values(r.cells).some((c) => c.conflicts.length > 0))
    : rows;

  const offset = Math.max(params.offset ?? 0, 0);
  const limit = Math.min(Math.max(params.limit ?? 150, 1), 400);

  return {
    period,
    periods: periods.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
    })),
    dates,
    rows: filtered.slice(offset, offset + limit),
    shiftTemplates: query(ctx, "ShiftTemplate", data.shiftTemplates).all(),
    // Deduped across the period: the same clash appears on both of its days.
    totalConflicts: dedupeConflicts(allConflicts).length,
    coverageByDate,
    canEdit: canType(ctx.ability, "update", "RosterAssignment"),
    canPublish: canType(ctx.ability, "publish", "RosterPeriod"),
  };
}

/* ------------------------------------------------------------- mutations -- */

export interface CellEdit {
  employeeId: string;
  date: ISODate;
  /** `null` clears the day back to rest. */
  dayType: RosterAssignment["dayType"] | null;
  shiftTemplateId?: string | null;
}

export interface BulkEditResult {
  applied: number;
  cleared: number;
  conflicts: RosterConflict[];
}

export function applyCellEdits(
  ctx: DataContext,
  periodId: string,
  edits: CellEdit[],
): BulkEditResult {
  const data = db();
  const period = requireOne(ctx, "RosterPeriod", data.rosterPeriods, periodId);

  // Integrity rule: published roster history is never edited in place. A
  // change after publication belongs in a new version.
  if (period.status === "published" || period.status === "archived") {
    throw new ConflictError(
      "Нийтлэгдсэн хуваарийг шууд засах боломжгүй. Шинэ хувилбар үүсгэнэ үү.",
    );
  }
  authorizeOn(ctx, "update", "RosterPeriod", period);

  const site = query(ctx, "Site", data.sites).where((s) => s.id === period.siteId).first();
  const timeZone = site?.timezone ?? "Asia/Ulaanbaatar";
  const templates = new Map(data.shiftTemplates.map((t) => [t.id, t]));

  // Index once. findIndex() per edit is a full scan of every assignment in
  // the organization, which a bulk edit of 200 cells turns into millions of
  // comparisons.
  const indexByKey = new Map<string, number>();
  data.rosterAssignments.forEach((a, i) => {
    if (a.rosterPeriodId === periodId) indexByKey.set(`${a.employeeId}|${a.date}`, i);
  });
  const removed = new Set<number>();

  let applied = 0;
  let cleared = 0;

  for (const edit of edits) {
    if (edit.date < period.startDate || edit.date > period.endDate) {
      throw new ValidationError("Огноо мөчлөгийн хүрээнээс гадуур байна.");
    }

    const employee = requireOne(ctx, "Employee", data.employees, edit.employeeId);
    const key = `${edit.employeeId}|${edit.date}`;
    const index = indexByKey.get(key);
    const current = index !== undefined && !removed.has(index) ? data.rosterAssignments[index] : undefined;

    if (edit.dayType === null) {
      if (current && index !== undefined) {
        authorizeOn(ctx, "delete", "RosterAssignment", current);
        // Mark rather than splice: splicing invalidates every later index.
        removed.add(index);
        cleared++;
      }
      continue;
    }

    let startAt: string | null = null;
    let endAt: string | null = null;
    if (edit.dayType === "shift") {
      const template = edit.shiftTemplateId ? templates.get(edit.shiftTemplateId) : undefined;
      if (!template) throw new ValidationError("Ээлжийн загвар сонгоогүй байна.");
      const window = resolveShiftWindow(edit.date, template, timeZone);
      startAt = window.startAt;
      endAt = window.endAt;
    }

    const next: RosterAssignment = {
      id: current?.id ?? `ra_${periodId}_${edit.employeeId}_${edit.date}`,
      organizationId: period.organizationId,
      rosterPeriodId: periodId,
      employeeId: edit.employeeId,
      orgUnitPath: employee.orgUnitPath,
      siteId: employee.siteId ?? period.siteId,
      date: edit.date,
      shiftTemplateId: edit.dayType === "shift" ? (edit.shiftTemplateId ?? null) : null,
      dayType: edit.dayType,
      startAt,
      endAt,
      status: "planned",
      source: "manual",
      note: null,
    };

    authorizeOn(ctx, current ? "update" : "create", "RosterAssignment", next);

    if (current && index !== undefined) {
      data.rosterAssignments[index] = next;
    } else {
      indexByKey.set(key, data.rosterAssignments.length);
      data.rosterAssignments.push(next);
    }
    applied++;
  }

  if (removed.size > 0) {
    data.rosterAssignments = data.rosterAssignments.filter((_, i) => !removed.has(i));
  }

  // Re-validate the touched employees against their whole period, so an edit
  // that creates a clash three days away is still reported.
  const touched = new Set(edits.map((e) => e.employeeId));
  const conflicts: RosterConflict[] = [];
  const approvedLeave = data.leaveRequests.filter(
    (l) => l.organizationId === period.organizationId && l.status === "approved",
  );

  for (const employeeId of touched) {
    const own = data.rosterAssignments.filter(
      (a) => a.rosterPeriodId === periodId && a.employeeId === employeeId,
    );
    const ownLeave = approvedLeave.filter((l) => l.employeeId === employeeId);
    const employee = data.employees.find((e) => e.id === employeeId);

    for (const assignment of own) {
      conflicts.push(
        ...findOverlappingShifts(assignment, own),
        ...findLeaveConflicts(assignment, ownLeave),
        ...findRestViolations(assignment, own, 10),
      );
      if (employee && assignment.dayType === "shift") {
        conflicts.push(
          ...findQualificationGaps(assignment, employee.qualifications, ["MINE_INDUCTION"]),
        );
      }
    }
  }

  return { applied, cleared, conflicts: dedupeConflicts(conflicts) };
}

export interface GenerateParams {
  periodId: string;
  /** Limit generation to one org unit subtree; omit for the whole period site. */
  orgUnitPath?: string;
  /** Overwrite days that already carry a manual edit. */
  overwriteManual: boolean;
}

export interface GenerateResult {
  created: number;
  skippedManual: number;
  employeesWithoutPattern: number;
}

/**
 * Generate from each employee's own pattern and anchor date.
 *
 * Crews on the same rotation legitimately start on different days, so there is
 * no shared "cycle day zero" here — using one is the classic way a generated
 * roster comes out plausible and wrong.
 */
export function generateRoster(ctx: DataContext, params: GenerateParams): GenerateResult {
  const data = db();
  const period = requireOne(ctx, "RosterPeriod", data.rosterPeriods, params.periodId);

  if (period.status === "published" || period.status === "archived") {
    throw new ConflictError("Нийтлэгдсэн мөчлөгт дахин үүсгэх боломжгүй.");
  }
  authorizeOn(ctx, "update", "RosterPeriod", period);

  const site = query(ctx, "Site", data.sites).where((s) => s.id === period.siteId).first();
  const timeZone = site?.timezone ?? "Asia/Ulaanbaatar";
  const templates = new Map(data.shiftTemplates.map((t) => [t.id, t]));
  const patterns = new Map(data.rosterPatterns.map((p) => [p.id, p]));

  let employees = query(ctx, "Employee", data.employees)
    .where((e) => e.status !== "terminated" && e.siteId === period.siteId)
    .all();

  if (params.orgUnitPath) {
    const prefix = params.orgUnitPath;
    employees = employees.filter(
      (e) => e.orgUnitPath === prefix || (e.orgUnitPath?.startsWith(`${prefix}.`) ?? false),
    );
  }

  // Partition once, work in a keyed map, and write the array back at the end.
  // Scanning the whole table per generated day is ~700 employees x 28 days x
  // 58,000 rows — about a billion comparisons, which simply hangs.
  const otherPeriods: RosterAssignment[] = [];
  const existing = new Map<string, RosterAssignment>();
  for (const a of data.rosterAssignments) {
    if (a.rosterPeriodId === period.id) existing.set(`${a.employeeId}|${a.date}`, a);
    else otherPeriods.push(a);
  }

  let created = 0;
  let skippedManual = 0;
  let employeesWithoutPattern = 0;

  for (const employee of employees) {
    const pattern = employee.rotationPatternId ? patterns.get(employee.rotationPatternId) : undefined;
    if (!pattern || !employee.rotationAnchorDate) {
      employeesWithoutPattern++;
      continue;
    }

    const days = generateRotationDays({
      configuration: pattern.configuration,
      anchorDate: employee.rotationAnchorDate,
      rangeStart: period.startDate,
      rangeEnd: period.endDate,
    });

    for (const day of days) {
      const key = `${employee.id}|${day.date}`;
      const current = existing.get(key);

      // A manual edit is a decision someone made. Generation does not silently
      // discard it unless explicitly told to.
      if (current?.source === "manual" && !params.overwriteManual) {
        skippedManual++;
        continue;
      }

      let dayType: RosterAssignment["dayType"] = "rest";
      let shiftTemplateId: string | null = null;
      let startAt: string | null = null;
      let endAt: string | null = null;

      if (isShift(day.slot)) {
        dayType = "shift";
        shiftTemplateId = day.slot.shiftTemplateId;
        const template = templates.get(shiftTemplateId);
        if (template) {
          const window = resolveShiftWindow(day.date, template, timeZone);
          startAt = window.startAt;
          endAt = window.endAt;
        }
      } else if (isTravel(day.slot)) {
        dayType = day.slot.travel === "in" ? "travel_in" : "travel_out";
      }

      if (dayType === "rest") {
        // Absence of a row IS the rest day.
        existing.delete(key);
        continue;
      }

      const next: RosterAssignment = {
        id: current?.id ?? `ra_${period.id}_${employee.id}_${day.date}`,
        organizationId: period.organizationId,
        rosterPeriodId: period.id,
        employeeId: employee.id,
        orgUnitPath: employee.orgUnitPath,
        siteId: employee.siteId ?? period.siteId,
        date: day.date,
        shiftTemplateId,
        dayType,
        startAt,
        endAt,
        status: "planned",
        source: "generated",
        note: null,
      };

      existing.set(key, next);
      created++;
    }
  }

  data.rosterAssignments = [...otherPeriods, ...existing.values()];

  return { created, skippedManual, employeesWithoutPattern };
}

export interface PublishResult {
  periodId: string;
  version: number;
  confirmed: number;
  conflicts: RosterConflict[];
}

/**
 * Publish a period.
 *
 * Refuses while unresolved conflicts remain: publishing a roster that puts
 * someone on shift during approved leave turns a visible planning problem into
 * an invisible operational one.
 */
export function publishRoster(ctx: DataContext, periodId: string): PublishResult {
  const data = db();
  const period = requireOne(ctx, "RosterPeriod", data.rosterPeriods, periodId);
  authorizeOn(ctx, "publish", "RosterPeriod", period);

  if (period.status === "published") {
    throw new ConflictError("Энэ мөчлөг аль хэдийн нийтлэгдсэн байна.");
  }

  const assignments = data.rosterAssignments.filter((a) => a.rosterPeriodId === periodId);

  const approvedLeave = data.leaveRequests.filter(
    (l) => l.organizationId === period.organizationId && l.status === "approved",
  );

  const byEmployee = new Map<string, RosterAssignment[]>();
  for (const a of assignments) {
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push(a);
    byEmployee.set(a.employeeId, list);
  }

  const blocking: RosterConflict[] = [];
  for (const [employeeId, own] of byEmployee) {
    const ownLeave = approvedLeave.filter((l) => l.employeeId === employeeId);
    for (const assignment of own) {
      blocking.push(
        ...findOverlappingShifts(assignment, own),
        ...findLeaveConflicts(assignment, ownLeave),
      );
    }
  }

  const unique = dedupeConflicts(blocking);
  if (unique.length > 0) {
    throw new ConflictError("Зөрчилтэй хуваарийг нийтлэх боломжгүй.", {
      conflicts: unique.slice(0, 50),
      total: unique.length,
    });
  }

  period.status = "published";
  period.version += 1;
  period.publishedAt = new Date().toISOString();
  period.publishedBy = ctx.auth.userId;

  let confirmed = 0;
  for (const assignment of assignments) {
    if (assignment.status === "planned") {
      assignment.status = "confirmed";
      confirmed++;
    }
  }

  return { periodId, version: period.version, confirmed, conflicts: [] };
}
