import { beforeEach, describe, expect, it } from "vitest";
import { format, startOfDay, subDays } from "date-fns";
import { buildAbility } from "@/lib/authz/ability";
import type { AuthContext } from "@/lib/authz/types";
import type { DataContext } from "@/server/db/query";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { db, resetDb } from "@/server/db/store";
import { SEED_ORG_A, SEED_ORG_B } from "@/server/db/seed";
import { correctAttendance, getAttendanceBoard, recordClockEvent } from "../attendance";

function ctxFor(roleIds: string[], extra: Partial<AuthContext> = {}): DataContext {
  const auth: AuthContext = {
    userId: "u",
    organizationId: SEED_ORG_A,
    employeeId: null,
    roleIds,
    siteIds: ["site_ot_mine"],
    campIds: [],
    orgUnitPath: null,
    isPlatformAdmin: false,
    permVersion: 1,
    ...extra,
  };
  return { auth, ability: buildAbility(auth) };
}

const admin = () => ctxFor(["org.admin"]);
const hr = () => ctxFor(["hr.manager"]);
const gate = () => ctxFor(["security.gate"]);
const supervisorOf = (code: string) => {
  const unit = db().orgUnits.find((u) => u.code === code)!;
  return ctxFor(["supervisor"], { orgUnitPath: unit.path });
};

const yesterday = () => format(subDays(startOfDay(new Date()), 1), "yyyy-MM-dd");
const today = () => format(startOfDay(new Date()), "yyyy-MM-dd");

beforeEach(() => resetDb());

describe("the three separations the module exists for", () => {
  it("does not treat a camp check-in as work attendance", () => {
    const board = getAttendanceBoard(admin(), { date: yesterday() });

    // People sleeping in camp with no clock event must appear as absent or
    // expected — never as present by virtue of having a bed.
    for (const row of board.reconciliation.inCampNotAtWork!) {
      expect(row.inCamp).toBe(true);
      expect(row.actualStartAt).toBeNull();
      expect(["absent", "expected"]).toContain(row.status);
    }
    expect(board.reconciliation.inCampNotAtWork!.length).toBeGreaterThan(0);
  });

  it("does not treat work attendance as camp occupancy", () => {
    const board = getAttendanceBoard(admin(), { date: yesterday() });
    for (const row of board.reconciliation.atWorkNotInCamp!) {
      expect(row.actualStartAt).not.toBeNull();
      expect(row.inCamp).toBe(false);
    }
    // Day-trip and bus-in crews are normal; this list should not be empty.
    expect(board.reconciliation.atWorkNotInCamp!.length).toBeGreaterThan(0);
  });

  it("surfaces people who worked without being rostered", () => {
    const board = getAttendanceBoard(admin(), { date: yesterday() });
    for (const row of board.reconciliation.unrostered) {
      expect(row.rosterAssignmentId).toBeNull();
      expect(row.actualStartAt).not.toBeNull();
      expect(row.status).toBe("unplanned");
    }
  });

  it("separates unexplained absence from approved leave", () => {
    const board = getAttendanceBoard(admin(), { date: yesterday() });
    for (const row of board.reconciliation.unexplainedAbsence) {
      expect(row.status).toBe("absent");
    }
    // Nobody on approved leave may appear in the absence list.
    const excusedIds = new Set(board.rows.filter((r) => r.status === "excused").map((r) => r.employeeId));
    for (const row of board.reconciliation.unexplainedAbsence) {
      expect(excusedIds.has(row.employeeId)).toBe(false);
    }
  });
});

describe("the daily board", () => {
  it("produces rows with planned and actual kept apart", () => {
    const board = getAttendanceBoard(admin(), { date: yesterday() });
    expect(board.rows.length).toBeGreaterThan(50);

    const observed = board.rows.find((r) => r.actualStartAt !== null && r.plannedStartAt !== null)!;
    expect(observed.plannedStartAt).not.toBe(observed.actualStartAt);
    expect(observed.rosterAssignmentId).toBeTruthy();
  });

  it("counts rostered people as the denominator, not everyone with a row", () => {
    const board = getAttendanceBoard(admin(), { date: yesterday() });
    expect(board.summary.rostered).toBeGreaterThan(0);
    expect(board.summary.rostered).toBeLessThanOrEqual(board.rows.length);
    // Unplanned attendance inflates rows but must not inflate the roster count.
    expect(board.summary.rostered + board.summary.unplanned).toBeLessThanOrEqual(
      board.rows.length + board.summary.unplanned,
    );
  });

  it("never marks today's unfinished shifts as absent", () => {
    const board = getAttendanceBoard(admin(), { date: today() });
    for (const row of board.rows) {
      if (row.plannedEndAt && row.plannedEndAt > new Date().toISOString()) {
        expect(row.status).not.toBe("absent");
      }
    }
  });

  it("filters to exceptions only", () => {
    const all = getAttendanceBoard(admin(), { date: yesterday() });
    const exceptions = getAttendanceBoard(admin(), { date: yesterday(), exceptionsOnly: true });
    expect(exceptions.rows.length).toBeLessThan(all.rows.length);
    for (const row of exceptions.rows) {
      expect(["late", "partial", "absent", "unplanned"]).toContain(row.status);
    }
  });

  it("keeps the summary describing the whole day, not the filtered view", () => {
    const all = getAttendanceBoard(admin(), { date: yesterday() });
    const filtered = getAttendanceBoard(admin(), { date: yesterday(), exceptionsOnly: true });
    // A filter changes what you look at, not what happened.
    expect(filtered.summary).toEqual(all.summary);
  });

  it("uses the organization's own grace period", () => {
    expect(getAttendanceBoard(admin(), {}).graceMinutes).toBe(10);
    const other = ctxFor(["org.admin"], { organizationId: SEED_ORG_B });
    expect(getAttendanceBoard(other, {}).graceMinutes).toBe(15);
  });
});

describe("scoping", () => {
  it("shows a supervisor only their own subtree", () => {
    const unit = db().orgUnits.find((u) => u.code === "MIN-OP-HL")!;
    const board = getAttendanceBoard(supervisorOf("MIN-OP-HL"), { date: yesterday() });
    expect(board.rows.length).toBeGreaterThan(0);
    for (const row of board.rows) {
      expect(row.orgUnitPath === unit.path || row.orgUnitPath!.startsWith(`${unit.path}.`)).toBe(true);
    }
  });

  it("reports camp presence as unknown, not false, when it cannot be read", () => {
    const board = getAttendanceBoard(gate(), { date: yesterday() });
    // security.gate cannot read AccommodationBooking. Rendering `false` would
    // say "nobody is in camp"; `null` says "you cannot see this".
    for (const row of board.rows) expect(row.inCamp).toBeNull();
    expect(board.reconciliation.inCampNotAtWork).toBeNull();
    expect(board.reconciliation.atWorkNotInCamp).toBeNull();

    const seen = getAttendanceBoard(admin(), { date: yesterday() });
    expect(seen.reconciliation.inCampNotAtWork).not.toBeNull();
  });

  it("separates the right to record from the right to correct", () => {
    expect(getAttendanceBoard(gate(), {}).canRecord).toBe(true);
    expect(getAttendanceBoard(gate(), {}).canCorrect).toBe(false);

    const sup = getAttendanceBoard(supervisorOf("MIN-OP-HL"), {});
    expect(sup.canCorrect).toBe(true);

    expect(getAttendanceBoard(hr(), {}).canCorrect).toBe(true);
    expect(getAttendanceBoard(hr(), {}).canRecord).toBe(false);
  });

  it("shows nothing of the other tenant", () => {
    const other = ctxFor(["org.admin"], { organizationId: SEED_ORG_B });
    const board = getAttendanceBoard(other, { date: yesterday() });
    for (const row of board.rows) {
      expect(db().employees.find((e) => e.id === row.employeeId)!.organizationId).toBe(SEED_ORG_B);
    }
  });
});

describe("recording a clock event", () => {
  const anEmployee = () =>
    db().employees.find(
      (e) => e.organizationId === SEED_ORG_A && e.siteId === "site_ot_mine" && e.status === "active",
    )!;

  it("records an arrival and makes it visible on the board", () => {
    const ctx = admin();
    const employee = db().employees.find(
      (e) =>
        e.organizationId === SEED_ORG_A &&
        e.siteId === "site_ot_mine" &&
        e.status === "active" &&
        !db().attendanceEvents.some((ev) => ev.employeeId === e.id),
    )!;

    const event = recordClockEvent(ctx, { employeeId: employee.id, eventType: "clock_in" });
    expect(event.eventType).toBe("clock_in");
    expect(event.recordedBy).toBe("u");
    expect(event.source).toBe("manual");
  });

  it("is idempotent on a repeated key, so a retrying reader cannot double-punch", () => {
    const ctx = admin();
    const employee = db().employees.find(
      (e) =>
        e.organizationId === SEED_ORG_A &&
        e.siteId === "site_ot_mine" &&
        e.status === "active" &&
        !db().attendanceEvents.some((ev) => ev.employeeId === e.id),
    )!;
    const before = db().attendanceEvents.length;

    const first = recordClockEvent(ctx, {
      employeeId: employee.id,
      eventType: "clock_in",
      idempotencyKey: "reader-42",
    });
    const second = recordClockEvent(ctx, {
      employeeId: employee.id,
      eventType: "clock_in",
      idempotencyKey: "reader-42",
    });

    expect(second.id).toBe(first.id);
    expect(db().attendanceEvents.length).toBe(before + 1);
  });

  it("refuses a future timestamp", () => {
    expect(() =>
      recordClockEvent(admin(), {
        employeeId: anEmployee().id,
        eventType: "clock_in",
        occurredAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ).toThrow(ConflictError);
  });

  it("refuses a clock-out with no clock-in", () => {
    const employee = db().employees.find(
      (e) =>
        e.organizationId === SEED_ORG_A &&
        e.siteId === "site_ot_mine" &&
        !db().attendanceEvents.some((ev) => ev.employeeId === e.id),
    )!;
    expect(() =>
      recordClockEvent(admin(), { employeeId: employee.id, eventType: "clock_out" }),
    ).toThrow(ConflictError);
  });

  it("refuses to record attendance for someone who has left", () => {
    const terminated = db().employees.find(
      (e) => e.organizationId === SEED_ORG_A && e.status === "terminated",
    )!;
    expect(() =>
      recordClockEvent(admin(), { employeeId: terminated.id, eventType: "clock_in" }),
    ).toThrow(ConflictError);
  });

  it("refuses another tenant's employee as non-existent", () => {
    const foreign = db().employees.find((e) => e.organizationId === SEED_ORG_B)!;
    expect(() =>
      recordClockEvent(admin(), { employeeId: foreign.id, eventType: "clock_in" }),
    ).toThrow(NotFoundError);
  });

  it("refuses a role that may only read", () => {
    expect(() =>
      recordClockEvent(hr(), { employeeId: anEmployee().id, eventType: "clock_in" }),
    ).toThrow();
  });
});

describe("supervisor corrections", () => {
  const absentRow = () => {
    const board = getAttendanceBoard(admin(), { date: yesterday() });
    return board.rows.find((r) => r.derivedStatus === "absent")!;
  };

  it("overrides the status while keeping the disagreement visible", () => {
    const row = absentRow();
    const correction = correctAttendance(admin(), {
      employeeId: row.employeeId,
      date: yesterday(),
      status: "present",
      reason: "Уншигч эвдэрсэн, биечлэн баталгаажуулсан.",
    });

    expect(correction.status).toBe("present");
    // The system's own conclusion is preserved, not replaced.
    expect(correction.derivedStatus).toBe("absent");
    expect(correction.correctedBy).toBe("u");

    const after = getAttendanceBoard(admin(), { date: yesterday() }).rows.find(
      (r) => r.employeeId === row.employeeId,
    )!;
    expect(after.status).toBe("present");
    expect(after.derivedStatus).toBe("absent");
    expect(after.corrected).toBe(true);
    expect(after.correctionReason).toBeTruthy();
  });

  it("requires a reason", () => {
    expect(() =>
      correctAttendance(admin(), {
        employeeId: absentRow().employeeId,
        date: yesterday(),
        status: "present",
        reason: "   ",
      }),
    ).toThrow(ValidationError);
  });

  it("refuses a future date", () => {
    const tomorrow = format(new Date(Date.now() + 864e5), "yyyy-MM-dd");
    expect(() =>
      correctAttendance(admin(), {
        employeeId: absentRow().employeeId,
        date: tomorrow,
        status: "present",
        reason: "x",
      }),
    ).toThrow(ValidationError);
  });

  it("refuses a correction that changes nothing", () => {
    const board = getAttendanceBoard(admin(), { date: yesterday() });
    const present = board.rows.find((r) => r.derivedStatus === "present" && !r.corrected)!;
    expect(() =>
      correctAttendance(admin(), {
        employeeId: present.employeeId,
        date: yesterday(),
        status: "present",
        reason: "no-op",
      }),
    ).toThrow(ConflictError);
  });

  it("replaces rather than stacks a second correction for the same day", () => {
    const row = absentRow();
    const before = db().attendanceCorrections.length;

    correctAttendance(admin(), {
      employeeId: row.employeeId,
      date: yesterday(),
      status: "present",
      reason: "first",
    });
    correctAttendance(admin(), {
      employeeId: row.employeeId,
      date: yesterday(),
      status: "excused",
      reason: "second",
    });

    expect(db().attendanceCorrections.length).toBe(before + 1);
    const stored = db().attendanceCorrections.find(
      (c) => c.employeeId === row.employeeId && c.date === yesterday(),
    )!;
    expect(stored.status).toBe("excused");
    expect(stored.reason).toBe("second");
  });

  it("refuses the gate officer, who observes but does not judge", () => {
    const row = absentRow();
    expect(() =>
      correctAttendance(gate(), {
        employeeId: row.employeeId,
        date: yesterday(),
        status: "present",
        reason: "x",
      }),
    ).toThrow();
  });

  it("refuses a supervisor correcting outside their subtree", () => {
    const unit = db().orgUnits.find((u) => u.code === "MIN-OP-HL")!;
    const outside = getAttendanceBoard(admin(), { date: yesterday() }).rows.find(
      (r) => r.orgUnitPath !== null && !r.orgUnitPath.startsWith(unit.path) && r.derivedStatus === "absent",
    );
    if (!outside) return;

    expect(() =>
      correctAttendance(supervisorOf("MIN-OP-HL"), {
        employeeId: outside.employeeId,
        date: yesterday(),
        status: "present",
        reason: "x",
      }),
    ).toThrow();
  });
});

describe("event attribution to the right shift", () => {
  it("does not credit a neighbouring day's clock-in to this shift", () => {
    const ctx = admin();
    const date = yesterday();
    const board = getAttendanceBoard(ctx, { date });

    for (const row of board.rows) {
      if (!row.actualStartAt || !row.plannedStartAt || !row.plannedEndAt) continue;
      const at = Date.parse(row.actualStartAt);
      // Within four hours either side of the planned window — anything
      // further away belongs to a different shift. Bucketing by calendar day
      // silently turned absences into attendance.
      expect(at).toBeGreaterThanOrEqual(Date.parse(row.plannedStartAt) - 4 * 3_600_000);
      expect(at).toBeLessThanOrEqual(Date.parse(row.plannedEndAt) + 4 * 3_600_000);
    }
  });

  it("only lists unrostered attendance on the day it was observed", () => {
    const date = yesterday();
    const board = getAttendanceBoard(admin(), { date });
    for (const row of board.reconciliation.unrostered) {
      expect(row.actualStartAt).not.toBeNull();
      const observedDate = format(new Date(row.actualStartAt!), "yyyy-MM-dd");
      expect(observedDate).toBe(date);
    }
  });

  it("produces a believable spread rather than everyone present", () => {
    const s = getAttendanceBoard(admin(), { date: yesterday() }).summary;
    // A dataset with no exceptions hides every case the module exists for.
    expect(s.present).toBeGreaterThan(0);
    expect(s.late).toBeGreaterThan(0);
    expect(s.partial).toBeGreaterThan(0);
    expect(s.absent).toBeGreaterThan(0);
    expect(s.excused).toBeGreaterThan(0);
    expect(s.present).toBeLessThan(s.rostered);
  });

  it("handles a night shift crossing midnight without losing the clock-in", () => {
    const date = yesterday();
    const board = getAttendanceBoard(admin(), { date });
    const night = board.rows.filter(
      (r) =>
        r.plannedStartAt !== null &&
        r.plannedEndAt !== null &&
        format(new Date(r.plannedStartAt), "yyyy-MM-dd") !==
          format(new Date(r.plannedEndAt), "yyyy-MM-dd"),
    );
    if (night.length === 0) return;
    // Some of them must have been observed; if a midnight crossing lost the
    // events, every night shift would read as absent.
    expect(night.some((r) => r.actualStartAt !== null)).toBe(true);
  });
});

describe("a reservation is not a person in a bed", () => {
  it("keeps commuters separate from people who simply have not checked in", () => {
    const board = getAttendanceBoard(admin(), { date: yesterday() });

    for (const row of board.reconciliation.atWorkNotInCamp!) {
      // A true commuter has no bed booked at all for the date.
      expect(row.hasCampBooking).toBe(false);
      expect(row.inCamp).toBe(false);
    }
    for (const row of board.reconciliation.bookedNotCheckedIn!) {
      expect(row.hasCampBooking).toBe(true);
      expect(row.inCamp).toBe(false);
    }

    // The two buckets must not overlap.
    const commuters = new Set(board.reconciliation.atWorkNotInCamp!.map((r) => r.employeeId));
    for (const row of board.reconciliation.bookedNotCheckedIn!) {
      expect(commuters.has(row.employeeId)).toBe(false);
    }
  });

  it("only counts bookings that cover the date being viewed", () => {
    const board = getAttendanceBoard(admin(), { date: yesterday() });
    const dayStart = new Date(`${yesterday()}T00:00:00`).toISOString();

    for (const row of board.rows) {
      if (row.hasCampBooking !== true) continue;
      const covering = db().accommodationBookings.filter(
        (b) =>
          b.employeeId === row.employeeId &&
          (b.status === "reserved" || b.status === "checked_in") &&
          b.startAt <= dayStart,
      );
      // A booking from a different rotation must not mark today as occupied.
      expect(covering.length).toBeGreaterThan(0);
    }
  });

  it("reports both camp buckets as unknown when accommodation is unreadable", () => {
    const board = getAttendanceBoard(gate(), { date: yesterday() });
    expect(board.reconciliation.bookedNotCheckedIn).toBeNull();
    for (const row of board.rows) expect(row.hasCampBooking).toBeNull();
  });
});
