import { describe, expect, it } from "vitest";
import { deriveAttendance, validateClockEvent, type PlannedShift } from "../invariants";

/** A 07:00–19:00 shift on 2026-11-02, Ulaanbaatar (UTC+8). */
const SHIFT: PlannedShift = {
  rosterAssignmentId: "ra1",
  shiftTemplateId: "day12",
  startAt: "2026-11-01T23:00:00.000Z",
  endAt: "2026-11-02T11:00:00.000Z",
};

const AFTER_SHIFT = "2026-11-02T13:00:00.000Z";
const MID_SHIFT = "2026-11-02T04:00:00.000Z";

const opts = (over: Partial<Parameters<typeof deriveAttendance>[2]> = {}) => ({
  graceMinutes: 10,
  earlyLeaveGraceMinutes: 10,
  now: AFTER_SHIFT,
  onApprovedLeave: false,
  ...over,
});

const clockIn = (at: string) => ({ id: "e1", employeeId: "emp1", eventType: "clock_in" as const, occurredAt: at });
const clockOut = (at: string) => ({ id: "e2", employeeId: "emp1", eventType: "clock_out" as const, occurredAt: at });

describe("a clean shift", () => {
  it("is present when clocked in on time and out at the end", () => {
    const result = deriveAttendance(
      SHIFT,
      [clockIn("2026-11-01T23:00:00.000Z"), clockOut("2026-11-02T11:00:00.000Z")],
      opts(),
    );
    expect(result.status).toBe("present");
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyLeaveMinutes).toBe(0);
    expect(result.workedMinutes).toBe(720);
  });

  it("stays present inside the grace period", () => {
    const result = deriveAttendance(
      SHIFT,
      [clockIn("2026-11-01T23:08:00.000Z"), clockOut("2026-11-02T11:00:00.000Z")],
      opts(),
    );
    expect(result.status).toBe("present");
    expect(result.lateMinutes).toBe(0);
  });

  it("counts lateness net of the grace period, not from the planned start", () => {
    const result = deriveAttendance(
      SHIFT,
      [clockIn("2026-11-01T23:25:00.000Z"), clockOut("2026-11-02T11:00:00.000Z")],
      opts(),
    );
    expect(result.status).toBe("late");
    expect(result.lateMinutes).toBe(15); // 25 minutes late, 10 forgiven
  });
});

describe("leave outranks absence", () => {
  it("marks an uncovered rostered day as excused, not absent", () => {
    const result = deriveAttendance(SHIFT, [], opts({ onApprovedLeave: true }));
    // Being on approved leave and being absent are different facts about a
    // person. Reporting the first as the second is a conduct accusation.
    expect(result.status).toBe("excused");
  });

  it("still reports excused even when the roster disagrees with the leave", () => {
    const result = deriveAttendance(SHIFT, [], opts({ onApprovedLeave: true, now: AFTER_SHIFT }));
    expect(result.status).not.toBe("absent");
  });
});

describe("a shift that has not finished is never an absence", () => {
  it("is expected before anyone clocks in", () => {
    expect(deriveAttendance(SHIFT, [], opts({ now: MID_SHIFT })).status).toBe("expected");
  });

  it("is expected before the shift even starts", () => {
    expect(
      deriveAttendance(SHIFT, [], opts({ now: "2026-11-01T20:00:00.000Z" })).status,
    ).toBe("expected");
  });

  it("becomes absent only once the shift has ended", () => {
    expect(deriveAttendance(SHIFT, [], opts({ now: AFTER_SHIFT })).status).toBe("absent");
  });

  it("is present mid-shift with an open clock-in, not partial", () => {
    const result = deriveAttendance(
      SHIFT,
      [clockIn("2026-11-01T23:00:00.000Z")],
      opts({ now: MID_SHIFT }),
    );
    // A missing clock-out is only a problem after the shift is over.
    expect(result.status).toBe("present");
  });
});

describe("incomplete and short shifts", () => {
  it("is partial when the shift ended with no clock-out", () => {
    const result = deriveAttendance(SHIFT, [clockIn("2026-11-01T23:00:00.000Z")], opts());
    expect(result.status).toBe("partial");
    expect(result.workedMinutes).toBe(0);
  });

  it("is partial when someone leaves early beyond the grace period", () => {
    const result = deriveAttendance(
      SHIFT,
      [clockIn("2026-11-01T23:00:00.000Z"), clockOut("2026-11-02T09:00:00.000Z")],
      opts(),
    );
    expect(result.status).toBe("partial");
    expect(result.earlyLeaveMinutes).toBe(110); // 2h early, 10 min forgiven
    expect(result.workedMinutes).toBe(600);
  });

  it("forgives leaving a few minutes early", () => {
    const result = deriveAttendance(
      SHIFT,
      [clockIn("2026-11-01T23:00:00.000Z"), clockOut("2026-11-02T10:55:00.000Z")],
      opts(),
    );
    expect(result.status).toBe("present");
    expect(result.earlyLeaveMinutes).toBe(0);
  });

  it("reports both late and early on the same day", () => {
    const result = deriveAttendance(
      SHIFT,
      [clockIn("2026-11-01T23:40:00.000Z"), clockOut("2026-11-02T09:00:00.000Z")],
      opts(),
    );
    expect(result.status).toBe("partial");
    expect(result.lateMinutes).toBe(30);
    expect(result.earlyLeaveMinutes).toBe(110);
  });
});

describe("work observed without a roster", () => {
  it("is unplanned, not discarded", () => {
    const result = deriveAttendance(
      null,
      [clockIn("2026-11-01T23:00:00.000Z"), clockOut("2026-11-02T11:00:00.000Z")],
      opts(),
    );
    // Someone working an unrostered shift is precisely what an attendance
    // system exists to surface.
    expect(result.status).toBe("unplanned");
    expect(result.workedMinutes).toBe(720);
  });

  it("is not a record at all with no plan and no observation", () => {
    expect(deriveAttendance(null, [], opts()).status).toBe("expected");
  });
});

describe("event pairing", () => {
  it("takes the first clock-in and the last matching clock-out", () => {
    const result = deriveAttendance(
      SHIFT,
      [
        clockIn("2026-11-01T23:00:00.000Z"),
        clockOut("2026-11-02T03:00:00.000Z"),
        clockIn("2026-11-02T04:00:00.000Z"),
        clockOut("2026-11-02T11:00:00.000Z"),
      ],
      opts(),
    );
    expect(result.actualStartAt).toBe("2026-11-01T23:00:00.000Z");
    expect(result.actualEndAt).toBe("2026-11-02T11:00:00.000Z");
  });

  it("ignores a clock-out that precedes the first clock-in", () => {
    const result = deriveAttendance(
      SHIFT,
      [clockOut("2026-11-01T22:00:00.000Z"), clockIn("2026-11-01T23:00:00.000Z")],
      opts({ now: MID_SHIFT }),
    );
    // A trailing clock-out from the previous shift must not close this one.
    expect(result.actualEndAt).toBeNull();
    expect(result.status).toBe("present");
  });

  it("is order-independent", () => {
    const events = [clockOut("2026-11-02T11:00:00.000Z"), clockIn("2026-11-01T23:00:00.000Z")];
    const forward = deriveAttendance(SHIFT, events, opts());
    const reversed = deriveAttendance(SHIFT, [...events].reverse(), opts());
    expect(forward).toEqual(reversed);
  });
});

describe("clock event validation", () => {
  const now = "2026-11-02T06:00:00.000Z";

  it("refuses a future timestamp", () => {
    expect(
      validateClockEvent(
        { employeeId: "emp1", eventType: "clock_in", occurredAt: "2026-11-03T00:00:00.000Z" },
        [],
        now,
      ),
    ).toBeTruthy();
  });

  it("refuses a clock-out with no clock-in", () => {
    expect(
      validateClockEvent({ employeeId: "emp1", eventType: "clock_out", occurredAt: now }, [], now),
    ).toBeTruthy();
  });

  it("refuses a repeated clock-in", () => {
    expect(
      validateClockEvent(
        { employeeId: "emp1", eventType: "clock_in", occurredAt: now },
        [clockIn("2026-11-01T23:00:00.000Z")],
        now,
      ),
    ).toBeTruthy();
  });

  it("refuses an out-of-order event", () => {
    expect(
      validateClockEvent(
        { employeeId: "emp1", eventType: "clock_out", occurredAt: "2026-11-01T22:00:00.000Z" },
        [clockIn("2026-11-01T23:00:00.000Z")],
        now,
      ),
    ).toBeTruthy();
  });

  it("accepts a clock-out following a clock-in", () => {
    expect(
      validateClockEvent(
        { employeeId: "emp1", eventType: "clock_out", occurredAt: now },
        [clockIn("2026-11-01T23:00:00.000Z")],
        now,
      ),
    ).toBeNull();
  });

  it("only considers the same employee's events", () => {
    const otherPerson = { ...clockIn("2026-11-01T23:00:00.000Z"), employeeId: "emp2" };
    expect(
      validateClockEvent(
        { employeeId: "emp1", eventType: "clock_in", occurredAt: now },
        [otherPerson],
        now,
      ),
    ).toBeNull();
  });
});
