import { describe, expect, it } from "vitest";
import { generateRotationDays, isRest, isShift, resolveShiftWindow, shiftHours } from "../rotation";
import type { RotationSlot } from "@/server/db/schema";

/** 14 on / 14 off, day shift. */
const PATTERN_14_14: RotationSlot[] = [
  ...Array.from({ length: 14 }, () => ({ shiftTemplateId: "day" }) as RotationSlot),
  ...Array.from({ length: 14 }, () => ({ rest: true }) as RotationSlot),
];

describe("rotation generation", () => {
  it("starts the cycle on the employee's own anchor date", () => {
    const days = generateRotationDays({
      configuration: PATTERN_14_14,
      anchorDate: "2026-10-01",
      rangeStart: "2026-10-01",
      rangeEnd: "2026-10-28",
    });
    expect(days).toHaveLength(28);
    expect(days[0].cycleIndex).toBe(0);
    expect(isShift(days[0].slot)).toBe(true);
    expect(isShift(days[13].slot)).toBe(true);
    expect(isRest(days[14].slot)).toBe(true);
    expect(isRest(days[27].slot)).toBe(true);
  });

  it("two crews on one pattern with different anchors are out of phase", () => {
    const common = { configuration: PATTERN_14_14, rangeStart: "2026-10-20", rangeEnd: "2026-10-20" };
    const crewA = generateRotationDays({ ...common, anchorDate: "2026-10-01" });
    const crewB = generateRotationDays({ ...common, anchorDate: "2026-10-15" });
    expect(isRest(crewA[0].slot)).toBe(true);
    expect(isShift(crewB[0].slot)).toBe(true);
  });

  it("team offset staggers a crew without changing its anchor", () => {
    const base = { configuration: PATTERN_14_14, anchorDate: "2026-10-01", rangeStart: "2026-10-01", rangeEnd: "2026-10-01" };
    expect(generateRotationDays(base)[0].cycleIndex).toBe(0);
    expect(generateRotationDays({ ...base, teamOffset: 14 })[0].cycleIndex).toBe(14);
  });

  it("handles dates before the anchor without producing a negative index", () => {
    const days = generateRotationDays({
      configuration: PATTERN_14_14,
      anchorDate: "2026-10-15",
      rangeStart: "2026-09-20",
      rangeEnd: "2026-09-22",
    });
    for (const d of days) {
      expect(d.cycleIndex).toBeGreaterThanOrEqual(0);
      expect(d.cycleIndex).toBeLessThan(28);
    }
  });

  it("returns nothing for an inverted range or an empty pattern", () => {
    expect(
      generateRotationDays({ configuration: PATTERN_14_14, anchorDate: "2026-10-01", rangeStart: "2026-10-10", rangeEnd: "2026-10-01" }),
    ).toEqual([]);
    expect(
      generateRotationDays({ configuration: [], anchorDate: "2026-10-01", rangeStart: "2026-10-01", rangeEnd: "2026-10-05" }),
    ).toEqual([]);
  });

  it("is deterministic — identical input yields identical output", () => {
    const req = { configuration: PATTERN_14_14, anchorDate: "2026-03-07", rangeStart: "2026-03-01", rangeEnd: "2026-04-30" };
    expect(generateRotationDays(req)).toEqual(generateRotationDays(req));
  });
});

describe("shift windows in site-local time", () => {
  it("converts a day shift from Ulaanbaatar local time to UTC", () => {
    const w = resolveShiftWindow("2026-11-02", { startTime: "07:00", endTime: "19:00" }, "Asia/Ulaanbaatar");
    expect(w.startAt).toBe("2026-11-01T23:00:00.000Z"); // UTC+8
    expect(w.endAt).toBe("2026-11-02T11:00:00.000Z");
    expect(w.crossesMidnight).toBe(false);
  });

  it("carries a night shift into the next local day", () => {
    const w = resolveShiftWindow("2026-11-02", { startTime: "19:00", endTime: "07:00" }, "Asia/Ulaanbaatar");
    expect(w.crossesMidnight).toBe(true);
    expect(w.startAt).toBe("2026-11-02T11:00:00.000Z");
    expect(w.endAt).toBe("2026-11-02T23:00:00.000Z");
  });

  it("respects a different site timezone rather than a hardcoded offset", () => {
    const ub = resolveShiftWindow("2026-11-02", { startTime: "07:00", endTime: "19:00" }, "Asia/Ulaanbaatar");
    const syd = resolveShiftWindow("2026-11-02", { startTime: "07:00", endTime: "19:00" }, "Australia/Sydney");
    expect(ub.startAt).not.toBe(syd.startAt);
  });

  it("nets the unpaid break out of the shift length", () => {
    const w = resolveShiftWindow("2026-11-02", { startTime: "07:00", endTime: "19:00" }, "Asia/Ulaanbaatar");
    expect(shiftHours(w, 60)).toBe(11);
    expect(shiftHours(w, 0)).toBe(12);
  });
});
