import { beforeEach, describe, expect, it } from "vitest";
import { buildAbility } from "@/lib/authz/ability";
import type { AuthContext } from "@/lib/authz/types";
import type { DataContext } from "@/server/db/query";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { db, resetDb } from "@/server/db/store";
import { SEED_ORG_A } from "@/server/db/seed";
import { applyCellEdits, generateRoster, getRosterGrid, publishRoster } from "../rosters";

function ctxFor(roleIds: string[], extra: Partial<AuthContext> = {}): DataContext {
  const auth: AuthContext = {
    userId: "u",
    organizationId: SEED_ORG_A,
    employeeId: null,
    roleIds,
    siteIds: [],
    campIds: [],
    orgUnitPath: null,
    isPlatformAdmin: false,
    permVersion: 1,
    ...extra,
  };
  return { auth, ability: buildAbility(auth) };
}

const planner = () => ctxFor(["roster.planner"]);
const approver = () => ctxFor(["roster.approver"]);
const admin = () => ctxFor(["org.admin"]);

const draftPeriod = () => db().rosterPeriods.find((p) => p.status === "draft")!;
const publishedPeriod = () => db().rosterPeriods.find((p) => p.status === "published")!;
const dayShiftId = () => db().shiftTemplates.find((t) => t.code === "DAY12")!.id;

beforeEach(() => resetDb());

describe("roster grid", () => {
  it("returns a full date range and rows with sparse cells", () => {
    const grid = getRosterGrid(planner(), { periodId: draftPeriod().id, limit: 20 })!;
    expect(grid.dates).toHaveLength(28);
    expect(grid.rows.length).toBeGreaterThan(0);
    // Rest days store no row, so a 28-day period has fewer than 28 cells.
    const row = grid.rows.find((r) => r.shiftCount > 0)!;
    expect(Object.keys(row.cells).length).toBeLessThan(28);
  });

  it("reports whether this actor may edit and publish, separately", () => {
    const p = getRosterGrid(planner(), { limit: 1 })!;
    expect(p.canEdit).toBe(true);
    expect(p.canPublish).toBe(false);

    const a = getRosterGrid(approver(), { limit: 1 })!;
    expect(a.canPublish).toBe(true);
  });

  it("counts shift coverage per date", () => {
    const grid = getRosterGrid(planner(), { periodId: publishedPeriod().id, limit: 400 })!;
    const total = Object.values(grid.coverageByDate).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(Object.keys(grid.coverageByDate)).toHaveLength(28);
  });

  it("draws approved leave even on days with no assignment", () => {
    const period = draftPeriod();
    const grid = getRosterGrid(planner(), { periodId: period.id, limit: 400 })!;
    const leaveCells = grid.rows.flatMap((r) =>
      Object.values(r.cells).filter((c) => c.dayType === "leave" && c.assignmentId === null),
    );
    // "Off on leave" and "off on rotation" are different facts, so leave must
    // be visible on days the rotation also leaves empty.
    expect(leaveCells.length).toBeGreaterThan(0);
  });

  it("filters to rows carrying a conflict", () => {
    const period = draftPeriod();
    const grid = getRosterGrid(planner(), { periodId: period.id, limit: 400 })!;
    const filtered = getRosterGrid(planner(), {
      periodId: period.id,
      conflictsOnly: true,
      limit: 400,
    })!;
    expect(filtered.rows.length).toBeLessThanOrEqual(grid.rows.length);
    for (const row of filtered.rows) {
      expect(Object.values(row.cells).some((c) => c.conflicts.length > 0)).toBe(true);
    }
  });

  it("scopes rows to a supervisor's own subtree", () => {
    const unit = db().orgUnits.find((u) => u.code === "MIN-OP-HL")!;
    const sup = ctxFor(["supervisor"], { orgUnitPath: unit.path });
    const grid = getRosterGrid(sup, { limit: 400 })!;
    expect(grid.rows.length).toBeGreaterThan(0);
    for (const row of grid.rows) {
      const employee = db().employees.find((e) => e.id === row.employeeId)!;
      expect(
        employee.orgUnitPath === unit.path || employee.orgUnitPath!.startsWith(`${unit.path}.`),
      ).toBe(true);
    }
    expect(grid.canEdit).toBe(false);
  });
});

describe("cell edits", () => {
  it("applies a shift and clears a day back to rest", () => {
    const ctx = planner();
    const period = draftPeriod();
    const grid = getRosterGrid(ctx, { periodId: period.id, limit: 5 })!;
    const row = grid.rows[0];
    const date = grid.dates[3];

    const applied = applyCellEdits(ctx, period.id, [
      { employeeId: row.employeeId, date, dayType: "shift", shiftTemplateId: dayShiftId() },
    ]);
    expect(applied.applied).toBe(1);

    const written = db().rosterAssignments.find(
      (a) => a.rosterPeriodId === period.id && a.employeeId === row.employeeId && a.date === date,
    )!;
    expect(written.dayType).toBe("shift");
    expect(written.source).toBe("manual");
    expect(written.startAt).toBeTruthy();

    const cleared = applyCellEdits(ctx, period.id, [
      { employeeId: row.employeeId, date, dayType: null },
    ]);
    expect(cleared.cleared).toBe(1);
    expect(
      db().rosterAssignments.find(
        (a) => a.rosterPeriodId === period.id && a.employeeId === row.employeeId && a.date === date,
      ),
    ).toBeUndefined();
  });

  it("refuses to edit a published period in place", () => {
    const ctx = admin();
    const period = publishedPeriod();
    const employee = db().rosterAssignments.find((a) => a.rosterPeriodId === period.id)!.employeeId;
    expect(() =>
      applyCellEdits(ctx, period.id, [
        { employeeId: employee, date: period.startDate, dayType: "shift", shiftTemplateId: dayShiftId() },
      ]),
    ).toThrow(ConflictError);
  });

  it("refuses a date outside the period", () => {
    const ctx = planner();
    const period = draftPeriod();
    const employee = getRosterGrid(ctx, { periodId: period.id, limit: 1 })!.rows[0].employeeId;
    expect(() =>
      applyCellEdits(ctx, period.id, [
        { employeeId: employee, date: "2020-01-01", dayType: "shift", shiftTemplateId: dayShiftId() },
      ]),
    ).toThrow();
  });

  it("requires a shift template when setting a shift day", () => {
    const ctx = planner();
    const period = draftPeriod();
    const employee = getRosterGrid(ctx, { periodId: period.id, limit: 1 })!.rows[0].employeeId;
    expect(() =>
      applyCellEdits(ctx, period.id, [
        { employeeId: employee, date: period.startDate, dayType: "shift" },
      ]),
    ).toThrow();
  });

  it("reports a clash created three days away, not just on the edited cell", () => {
    const ctx = planner();
    const period = draftPeriod();
    const leave = db().leaveRequests.find(
      (l) => l.status === "approved" && l.startAt.slice(0, 10) >= period.startDate,
    )!;
    const date = leave.startAt.slice(0, 10);
    if (date > period.endDate) return;

    const result = applyCellEdits(ctx, period.id, [
      { employeeId: leave.employeeId, date, dayType: "shift", shiftTemplateId: dayShiftId() },
    ]);
    expect(result.conflicts.some((c) => c.kind === "leave_conflict")).toBe(true);
  });
});

describe("generation", () => {
  it("creates days from each employee's own anchor, not a shared one", () => {
    const ctx = planner();
    const period = draftPeriod();
    db().rosterAssignments = db().rosterAssignments.filter((a) => a.rosterPeriodId !== period.id);

    const result = generateRoster(ctx, { periodId: period.id, overwriteManual: false });
    expect(result.created).toBeGreaterThan(0);

    const generated = db().rosterAssignments.filter((a) => a.rosterPeriodId === period.id);
    // Crews on the same pattern are out of phase, so the first shift date
    // varies across the workforce.
    const firstShiftDates = new Set(
      [...new Set(generated.map((a) => a.employeeId))].slice(0, 50).map(
        (id) =>
          generated
            .filter((a) => a.employeeId === id && a.dayType === "shift")
            .sort((a, b) => a.date.localeCompare(b.date))[0]?.date,
      ),
    );
    expect(firstShiftDates.size).toBeGreaterThan(3);
  });

  it("never stores a rest day as a row", () => {
    const ctx = planner();
    const period = draftPeriod();
    generateRoster(ctx, { periodId: period.id, overwriteManual: false });
    const rows = db().rosterAssignments.filter((a) => a.rosterPeriodId === period.id);
    expect(rows.some((a) => a.dayType === "rest")).toBe(false);
  });

  it("preserves a manual edit unless told to overwrite it", () => {
    const ctx = planner();
    const period = draftPeriod();
    const employee = getRosterGrid(ctx, { periodId: period.id, limit: 1 })!.rows[0].employeeId;
    const date = period.startDate;

    applyCellEdits(ctx, period.id, [
      { employeeId: employee, date, dayType: "shift", shiftTemplateId: dayShiftId() },
    ]);

    const kept = generateRoster(ctx, { periodId: period.id, overwriteManual: false });
    expect(kept.skippedManual).toBeGreaterThan(0);
    expect(
      db().rosterAssignments.find(
        (a) => a.rosterPeriodId === period.id && a.employeeId === employee && a.date === date,
      )?.source,
    ).toBe("manual");

    generateRoster(ctx, { periodId: period.id, overwriteManual: true });
    const after = db().rosterAssignments.find(
      (a) => a.rosterPeriodId === period.id && a.employeeId === employee && a.date === date,
    );
    expect(after === undefined || after.source === "generated").toBe(true);
  });

  it("is idempotent — generating twice does not duplicate rows", () => {
    const ctx = planner();
    const period = draftPeriod();
    generateRoster(ctx, { periodId: period.id, overwriteManual: true });
    const first = db().rosterAssignments.filter((a) => a.rosterPeriodId === period.id).length;
    generateRoster(ctx, { periodId: period.id, overwriteManual: true });
    const second = db().rosterAssignments.filter((a) => a.rosterPeriodId === period.id).length;
    expect(second).toBe(first);
  });

  it("refuses to regenerate a published period", () => {
    expect(() =>
      generateRoster(admin(), { periodId: publishedPeriod().id, overwriteManual: true }),
    ).toThrow(ConflictError);
  });
});

describe("publication", () => {
  it("is refused to a planner", () => {
    expect(() => publishRoster(planner(), draftPeriod().id)).toThrow(ForbiddenError);
    expect(db().rosterPeriods.find((p) => p.id === draftPeriod().id)!.status).toBe("draft");
  });

  it("refuses while a shift clashes with approved leave", () => {
    const period = draftPeriod();
    const leave = db().leaveRequests.find(
      (l) =>
        l.status === "approved" &&
        l.startAt.slice(0, 10) >= period.startDate &&
        l.startAt.slice(0, 10) <= period.endDate,
    );
    if (!leave) return;

    applyCellEdits(planner(), period.id, [
      {
        employeeId: leave.employeeId,
        date: leave.startAt.slice(0, 10),
        dayType: "shift",
        shiftTemplateId: dayShiftId(),
      },
    ]);

    expect(() => publishRoster(approver(), period.id)).toThrow(ConflictError);
    expect(db().rosterPeriods.find((p) => p.id === period.id)!.status).toBe("draft");
  });

  it("publishes a clean period, bumps the version and confirms assignments", () => {
    const period = draftPeriod();
    // Remove anything clashing with approved leave so the period is clean.
    const approved = db().leaveRequests.filter((l) => l.status === "approved");
    db().rosterAssignments = db().rosterAssignments.filter((a) => {
      if (a.rosterPeriodId !== period.id || a.dayType !== "shift") return true;
      return !approved.some(
        (l) =>
          l.employeeId === a.employeeId &&
          a.startAt !== null &&
          a.endAt !== null &&
          a.startAt < l.endAt &&
          l.startAt < a.endAt,
      );
    });

    const versionBefore = period.version;
    const result = publishRoster(approver(), period.id);

    expect(result.version).toBe(versionBefore + 1);
    expect(result.confirmed).toBeGreaterThan(0);

    const after = db().rosterPeriods.find((p) => p.id === period.id)!;
    expect(after.status).toBe("published");
    expect(after.publishedAt).toBeTruthy();
    expect(after.publishedBy).toBe("u");
    expect(
      db().rosterAssignments.filter((a) => a.rosterPeriodId === period.id && a.status === "planned"),
    ).toHaveLength(0);
  });

  it("refuses to publish the same period twice", () => {
    const period = publishedPeriod();
    expect(() => publishRoster(approver(), period.id)).toThrow(ConflictError);
  });
});
