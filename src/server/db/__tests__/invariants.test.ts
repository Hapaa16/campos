import { describe, expect, it } from "vitest";
import {
  findBedBookingConflicts,
  findLeaveConflicts,
  findOverlappingShifts,
  findQualificationGaps,
  findRestViolations,
  hasSegmentCapacity,
  intervalsOverlap,
  peakSegmentOccupancy,
  recomputePaths,
  validateOrgUnitMove,
  type BedBookingLike,
} from "../invariants";

const T = (h: string) => `2026-11-0${h}`;

describe("bed double-booking (stands in for the EXCLUDE constraint)", () => {
  const existing: BedBookingLike[] = [
    { id: "b1", bedId: "bed1", status: "reserved", startAt: "2026-11-01T00:00:00Z", endAt: "2026-11-10T10:00:00Z" },
    { id: "b2", bedId: "bed2", status: "reserved", startAt: "2026-11-01T00:00:00Z", endAt: "2026-11-20T10:00:00Z" },
    { id: "b3", bedId: "bed1", status: "cancelled", startAt: "2026-11-12T00:00:00Z", endAt: "2026-11-18T10:00:00Z" },
  ];

  it("rejects an overlapping reservation on the same bed", () => {
    const c = { bedId: "bed1", startAt: "2026-11-05T00:00:00Z", endAt: "2026-11-15T10:00:00Z" };
    expect(findBedBookingConflicts(c, existing).map((x) => x.id)).toEqual(["b1"]);
  });

  it("allows back-to-back bookings — the range is half-open", () => {
    const c = { bedId: "bed1", startAt: "2026-11-10T10:00:00Z", endAt: "2026-11-20T10:00:00Z" };
    expect(findBedBookingConflicts(c, existing)).toEqual([]);
  });

  it("ignores cancelled bookings — they hold no bed", () => {
    const c = { bedId: "bed1", startAt: "2026-11-13T00:00:00Z", endAt: "2026-11-14T00:00:00Z" };
    expect(findBedBookingConflicts(c, existing)).toEqual([]);
  });

  it("does not collide across different beds", () => {
    const c = { bedId: "bed9", startAt: "2026-11-01T00:00:00Z", endAt: "2026-11-30T00:00:00Z" };
    expect(findBedBookingConflicts(c, existing)).toEqual([]);
  });

  it("excludes the booking being edited from its own conflict check", () => {
    const c = { bedId: "bed1", startAt: "2026-11-02T00:00:00Z", endAt: "2026-11-11T00:00:00Z" };
    expect(findBedBookingConflicts(c, existing, "b1")).toEqual([]);
  });

  it("refuses an inverted or empty range", () => {
    expect(() =>
      findBedBookingConflicts({ bedId: "bed1", startAt: "2026-11-10T00:00:00Z", endAt: "2026-11-01T00:00:00Z" }, existing),
    ).toThrow(RangeError);
    expect(() =>
      findBedBookingConflicts({ bedId: "bed1", startAt: "2026-11-01T00:00:00Z", endAt: "2026-11-01T00:00:00Z" }, existing),
    ).toThrow(RangeError);
  });

  it("treats a checked-in booking as occupying", () => {
    const occupied: BedBookingLike[] = [
      { id: "x", bedId: "bed1", status: "checked_in", startAt: "2026-11-01T00:00:00Z", endAt: "2026-11-10T00:00:00Z" },
    ];
    const c = { bedId: "bed1", startAt: "2026-11-05T00:00:00Z", endAt: "2026-11-06T00:00:00Z" };
    expect(findBedBookingConflicts(c, occupied)).toHaveLength(1);
  });

  it("frees the bed once the guest has checked out", () => {
    const done: BedBookingLike[] = [
      { id: "x", bedId: "bed1", status: "checked_out", startAt: "2026-11-01T00:00:00Z", endAt: "2026-11-10T00:00:00Z" },
    ];
    const c = { bedId: "bed1", startAt: "2026-11-05T00:00:00Z", endAt: "2026-11-06T00:00:00Z" };
    expect(findBedBookingConflicts(c, done)).toEqual([]);
  });
});

describe("intervalsOverlap", () => {
  it("is half-open on both edges", () => {
    const a = { startAt: "2026-01-01T00:00:00Z", endAt: "2026-01-02T00:00:00Z" };
    expect(intervalsOverlap(a, { startAt: "2026-01-02T00:00:00Z", endAt: "2026-01-03T00:00:00Z" })).toBe(false);
    expect(intervalsOverlap(a, { startAt: "2025-12-31T00:00:00Z", endAt: "2026-01-01T00:00:00Z" })).toBe(false);
    expect(intervalsOverlap(a, { startAt: "2026-01-01T12:00:00Z", endAt: "2026-01-01T13:00:00Z" })).toBe(true);
  });
});

describe("organizational hierarchy integrity", () => {
  const units = [
    { id: "u1", organizationId: "A", parentId: null },
    { id: "u2", organizationId: "A", parentId: "u1" },
    { id: "u3", organizationId: "A", parentId: "u2" },
    { id: "u4", organizationId: "A", parentId: "u1" },
    { id: "z1", organizationId: "B", parentId: null },
  ];

  it("rejects a unit becoming its own parent", () => {
    expect(validateOrgUnitMove("u2", "u2", units)).toMatchObject({ ok: false, code: "self_parent" });
  });

  it("rejects moving a unit under its own descendant", () => {
    expect(validateOrgUnitMove("u1", "u3", units)).toMatchObject({ ok: false, code: "cycle" });
  });

  it("rejects a cross-tenant parent", () => {
    expect(validateOrgUnitMove("u2", "z1", units)).toMatchObject({ ok: false, code: "cross_tenant" });
  });

  it("allows a legitimate sideways move", () => {
    expect(validateOrgUnitMove("u3", "u4", units)).toEqual({ ok: true });
  });

  it("allows promotion to root", () => {
    expect(validateOrgUnitMove("u3", null, units)).toEqual({ ok: true });
  });

  it("terminates on pre-existing corrupt cycles instead of hanging", () => {
    const corrupt = [
      { id: "c1", organizationId: "A", parentId: "c2" },
      { id: "c2", organizationId: "A", parentId: "c1" },
      { id: "c3", organizationId: "A", parentId: null },
    ];
    expect(validateOrgUnitMove("c3", "c1", corrupt)).toEqual({ ok: true });
  });

  it("recomputes materialised paths depth-first", () => {
    const paths = recomputePaths([...units].filter((u) => u.organizationId === "A"));
    expect(paths.get("u1")).toEqual({ path: "1", depth: 0 });
    expect(paths.get("u2")).toEqual({ path: "1.1", depth: 1 });
    expect(paths.get("u3")).toEqual({ path: "1.1.1", depth: 2 });
    expect(paths.get("u4")).toEqual({ path: "1.2", depth: 1 });
  });
});

describe("roster conflicts", () => {
  const shift = (o: Partial<Record<string, unknown>> = {}) => ({
    id: "a1",
    employeeId: "e1",
    date: "2026-11-02",
    dayType: "shift",
    startAt: "2026-11-02T00:00:00Z",
    endAt: "2026-11-02T12:00:00Z",
    status: "planned",
    ...o,
  });

  it("flags two overlapping shifts for one person", () => {
    const other = shift({ id: "a2", startAt: "2026-11-02T06:00:00Z", endAt: "2026-11-02T18:00:00Z" });
    expect(findOverlappingShifts(shift(), [other])).toHaveLength(1);
  });

  it("does not flag a different person", () => {
    const other = shift({ id: "a2", employeeId: "e2", startAt: "2026-11-02T06:00:00Z", endAt: "2026-11-02T18:00:00Z" });
    expect(findOverlappingShifts(shift(), [other])).toEqual([]);
  });

  it("ignores cancelled assignments", () => {
    const other = shift({ id: "a2", status: "cancelled", startAt: "2026-11-02T06:00:00Z", endAt: "2026-11-02T18:00:00Z" });
    expect(findOverlappingShifts(shift(), [other])).toEqual([]);
  });

  it("flags an approved leave clashing with a shift", () => {
    const leave = [
      { id: "l1", employeeId: "e1", status: "approved", startAt: "2026-11-01T00:00:00Z", endAt: "2026-11-05T00:00:00Z" },
    ];
    expect(findLeaveConflicts(shift(), leave)).toHaveLength(1);
  });

  it("ignores a pending leave — only an approved one blocks", () => {
    const leave = [
      { id: "l1", employeeId: "e1", status: "pending", startAt: "2026-11-01T00:00:00Z", endAt: "2026-11-05T00:00:00Z" },
    ];
    expect(findLeaveConflicts(shift(), leave)).toEqual([]);
  });

  it("flags insufficient rest between consecutive shifts", () => {
    const next = shift({ id: "a2", startAt: "2026-11-02T18:00:00Z", endAt: "2026-11-03T06:00:00Z" });
    expect(findRestViolations(shift(), [next], 12)).toHaveLength(1);
    expect(findRestViolations(shift(), [next], 6)).toEqual([]);
  });

  it("flags a missing or expired qualification", () => {
    const held = [
      { code: "MINE_INDUCTION", expiresAt: "2027-01-01" },
      { code: "FIRST_AID", expiresAt: "2026-01-01" },
    ];
    const gaps = findQualificationGaps(shift(), held, ["MINE_INDUCTION", "FIRST_AID", "HV_LICENCE"]);
    expect(gaps.map((g) => g.message)).toEqual([
      expect.stringContaining("FIRST_AID"),
      expect.stringContaining("HV_LICENCE"),
    ]);
  });
});

describe("segment-aware seat capacity", () => {
  it("counts legs, not bodies — non-overlapping riders share a seat", () => {
    const legs = [
      { boardingSeq: 0, destinationSeq: 1 },
      { boardingSeq: 1, destinationSeq: 2 },
      { boardingSeq: 2, destinationSeq: 3 },
    ];
    expect(peakSegmentOccupancy(legs)).toBe(1);
  });

  it("counts concurrent riders on the busiest leg", () => {
    const legs = [
      { boardingSeq: 0, destinationSeq: 3 },
      { boardingSeq: 1, destinationSeq: 3 },
      { boardingSeq: 1, destinationSeq: 2 },
    ];
    expect(peakSegmentOccupancy(legs)).toBe(3);
  });

  it("permits a booking that fits in a gap on a full-looking bus", () => {
    const existing = Array.from({ length: 45 }, () => ({ boardingSeq: 0, destinationSeq: 1 }));
    expect(hasSegmentCapacity(existing, { boardingSeq: 1, destinationSeq: 2 }, 45)).toBe(true);
  });

  it("refuses a booking that pushes one leg over capacity", () => {
    const existing = Array.from({ length: 45 }, () => ({ boardingSeq: 0, destinationSeq: 3 }));
    expect(hasSegmentCapacity(existing, { boardingSeq: 1, destinationSeq: 2 }, 45)).toBe(false);
  });

  it("is zero for an empty trip and rejects an inverted leg", () => {
    expect(peakSegmentOccupancy([])).toBe(0);
    expect(() => peakSegmentOccupancy([{ boardingSeq: 3, destinationSeq: 1 }])).toThrow(RangeError);
  });
});
