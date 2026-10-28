/* ===========================================================================
   Business invariants.

   These mirror the constraints the PostgreSQL schema will carry, so the UI is
   developed against the real rules rather than a permissive fake. Each one
   names the database construct it stands in for.

   Pure functions — no store access — so they are directly unit-testable.
   ========================================================================= */

export interface Interval {
  startAt: string;
  endAt: string;
}

/**
 * Half-open overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅.
 *
 * Half-open is what makes back-to-back bookings legal — a guest checking out
 * at 10:00 and the next checking in at 10:00 do not collide.
 */
export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/** Booking states that actually hold a bed. */
export const OCCUPYING_BOOKING_STATUSES = ["reserved", "checked_in"] as const;
type OccupyingStatus = (typeof OCCUPYING_BOOKING_STATUSES)[number];

export function isOccupying(status: string): status is OccupyingStatus {
  return (OCCUPYING_BOOKING_STATUSES as readonly string[]).includes(status);
}

export interface BedBookingLike extends Interval {
  id: string;
  bedId: string;
  status: string;
}

/**
 * Stands in for:
 *   ALTER TABLE accommodation_bookings ADD CONSTRAINT no_double_booking
 *     EXCLUDE USING gist (
 *       bed_id WITH =,
 *       tstzrange(start_at, end_at, '[)') WITH &&
 *     ) WHERE (status IN ('reserved', 'checked_in'));
 *
 * Returns the conflicting bookings, empty when the reservation is legal.
 */
export function findBedBookingConflicts(
  candidate: { bedId: string } & Interval,
  existing: readonly BedBookingLike[],
  ignoreBookingId?: string,
): BedBookingLike[] {
  if (candidate.endAt <= candidate.startAt) {
    throw new RangeError("Захиалгын дуусах хугацаа эхлэхээс хойш байх ёстой.");
  }
  return existing.filter(
    (b) =>
      b.bedId === candidate.bedId &&
      b.id !== ignoreBookingId &&
      isOccupying(b.status) &&
      intervalsOverlap(candidate, b),
  );
}

/* ----------------------------------------------- organizational hierarchy -- */

export interface OrgUnitLike {
  id: string;
  organizationId: string;
  parentId: string | null;
}

export type MoveRejection =
  | { ok: true }
  | { ok: false; code: "self_parent" | "cycle" | "cross_tenant" | "missing_parent"; message: string };

/**
 * Stands in for the recursive-CTE trigger that rejects a cycle, plus the
 * composite FK (parent_id, organization_id) that makes a cross-tenant parent
 * impossible. Checked client-side too, so the user sees it before submitting.
 */
export function validateOrgUnitMove(
  unitId: string,
  newParentId: string | null,
  units: readonly OrgUnitLike[],
): MoveRejection {
  const byId = new Map(units.map((u) => [u.id, u]));
  const unit = byId.get(unitId);
  if (!unit) return { ok: false, code: "missing_parent", message: "Нэгж олдсонгүй." };
  if (newParentId === null) return { ok: true };

  if (newParentId === unitId) {
    return { ok: false, code: "self_parent", message: "Нэгжийг өөрийнх нь дэд нэгж болгох боломжгүй." };
  }

  const parent = byId.get(newParentId);
  if (!parent) return { ok: false, code: "missing_parent", message: "Эцэг нэгж олдсонгүй." };

  if (parent.organizationId !== unit.organizationId) {
    return {
      ok: false,
      code: "cross_tenant",
      message: "Өөр байгууллагын нэгжийг эцэг болгох боломжгүй.",
    };
  }

  // Walk up from the proposed parent. Reaching the moved unit means the move
  // would detach a subtree into a loop.
  const seen = new Set<string>();
  let cursor: OrgUnitLike | undefined = parent;
  while (cursor) {
    if (cursor.id === unitId) {
      return { ok: false, code: "cycle", message: "Энэ шилжүүлэг тойрог үүсгэнэ." };
    }
    if (seen.has(cursor.id)) break; // pre-existing corruption; do not hang
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  return { ok: true };
}

/** Recompute materialised paths for a unit and everything beneath it. */
export function recomputePaths(units: OrgUnitLike[]): Map<string, { path: string; depth: number }> {
  const byParent = new Map<string | null, OrgUnitLike[]>();
  for (const u of units) {
    const list = byParent.get(u.parentId) ?? [];
    list.push(u);
    byParent.set(u.parentId, list);
  }

  const out = new Map<string, { path: string; depth: number }>();
  const walk = (parentId: string | null, prefix: string, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    children.forEach((child, i) => {
      const segment = String(i + 1);
      const path = prefix ? `${prefix}.${segment}` : segment;
      out.set(child.id, { path, depth });
      walk(child.id, path, depth + 1);
    });
  };
  walk(null, "", 0);
  return out;
}

/* ------------------------------------------------------------ rostering ---- */

export interface AssignmentLike {
  id: string;
  employeeId: string;
  date: string;
  dayType: string;
  startAt: string | null;
  endAt: string | null;
  status: string;
}

export interface LeaveLike extends Interval {
  id: string;
  employeeId: string;
  status: string;
}

export type ConflictKind =
  | "overlapping_shift"
  | "leave_conflict"
  | "insufficient_rest"
  | "missing_qualification"
  | "site_ineligible";

export interface RosterConflict {
  kind: ConflictKind;
  employeeId: string;
  date: string;
  message: string;
  relatedId?: string;
}

/** Two working shifts for one person must not overlap in time. */
export function findOverlappingShifts(
  candidate: AssignmentLike,
  existing: readonly AssignmentLike[],
): RosterConflict[] {
  if (!candidate.startAt || !candidate.endAt) return [];
  return existing
    .filter(
      (a) =>
        a.id !== candidate.id &&
        a.employeeId === candidate.employeeId &&
        a.status !== "cancelled" &&
        a.startAt !== null &&
        a.endAt !== null &&
        intervalsOverlap(
          { startAt: candidate.startAt!, endAt: candidate.endAt! },
          { startAt: a.startAt, endAt: a.endAt },
        ),
    )
    .map((a) => ({
      kind: "overlapping_shift" as const,
      employeeId: candidate.employeeId,
      date: candidate.date,
      message: "Энэ ажилтан тухайн цагт өөр ээлжид бүртгэлтэй байна.",
      relatedId: a.id,
    }));
}

/** An approved leave and a working shift cannot occupy the same window. */
export function findLeaveConflicts(
  candidate: AssignmentLike,
  leave: readonly LeaveLike[],
): RosterConflict[] {
  if (!candidate.startAt || !candidate.endAt) return [];
  if (candidate.dayType !== "shift") return [];
  return leave
    .filter(
      (l) =>
        l.employeeId === candidate.employeeId &&
        l.status === "approved" &&
        intervalsOverlap(
          { startAt: candidate.startAt!, endAt: candidate.endAt! },
          { startAt: l.startAt, endAt: l.endAt },
        ),
    )
    .map((l) => ({
      kind: "leave_conflict" as const,
      employeeId: candidate.employeeId,
      date: candidate.date,
      message: "Энэ ажилтан батлагдсан чөлөөтэй байна.",
      relatedId: l.id,
    }));
}

/** Minimum rest between consecutive shifts, in hours. */
export function findRestViolations(
  candidate: AssignmentLike,
  existing: readonly AssignmentLike[],
  minRestHours: number,
): RosterConflict[] {
  if (!candidate.startAt || !candidate.endAt) return [];
  const minMs = minRestHours * 3_600_000;
  const cStart = Date.parse(candidate.startAt);
  const cEnd = Date.parse(candidate.endAt);

  return existing
    .filter((a) => {
      if (a.id === candidate.id || a.employeeId !== candidate.employeeId) return false;
      if (a.status === "cancelled" || !a.startAt || !a.endAt) return false;
      const aStart = Date.parse(a.startAt);
      const aEnd = Date.parse(a.endAt);
      // Gap on either side, measured between the near edges.
      const gap = aStart >= cEnd ? aStart - cEnd : cStart >= aEnd ? cStart - aEnd : 0;
      return gap > 0 && gap < minMs;
    })
    .map((a) => ({
      kind: "insufficient_rest" as const,
      employeeId: candidate.employeeId,
      date: candidate.date,
      message: `Ээлж хооронд ${minRestHours} цагийн амралт шаардлагатай.`,
      relatedId: a.id,
    }));
}

/** Qualifications that are missing or expired as at the shift date. */
export function findQualificationGaps(
  candidate: AssignmentLike,
  held: readonly { code: string; expiresAt: string | null }[],
  required: readonly string[],
): RosterConflict[] {
  return required
    .filter((code) => {
      const q = held.find((h) => h.code === code);
      if (!q) return true;
      return q.expiresAt !== null && q.expiresAt < candidate.date;
    })
    .map((code) => ({
      kind: "missing_qualification" as const,
      employeeId: candidate.employeeId,
      date: candidate.date,
      message: `Шаардлагатай эрх/гэрчилгээ дутуу эсвэл хугацаа дууссан: ${code}`,
    }));
}

/* ----------------------------------------- transport: segment-aware seats -- */

export interface SegmentLeg {
  /** Zero-based stop sequence numbers along the route. */
  boardingSeq: number;
  destinationSeq: number;
}

/**
 * Peak concurrent passengers across a route, computed per leg rather than by
 * total headcount.
 *
 * A 45-seat bus can legally carry 80 bookings if nobody's legs overlap: a
 * passenger riding stop 1→2 does not consume a seat on leg 3→4. Counting
 * bodies instead of legs is the classic way transport modules oversell.
 *
 * Returns the maximum simultaneous occupancy over all legs.
 */
export function peakSegmentOccupancy(legs: readonly SegmentLeg[]): number {
  if (legs.length === 0) return 0;
  // Sweep line over stop boundaries: +1 at boarding, -1 at destination.
  const deltas = new Map<number, number>();
  for (const leg of legs) {
    if (leg.destinationSeq <= leg.boardingSeq) {
      throw new RangeError("Буух зогсоол нь суух зогсоолоос хойш байх ёстой.");
    }
    deltas.set(leg.boardingSeq, (deltas.get(leg.boardingSeq) ?? 0) + 1);
    deltas.set(leg.destinationSeq, (deltas.get(leg.destinationSeq) ?? 0) - 1);
  }
  let running = 0;
  let peak = 0;
  for (const seq of [...deltas.keys()].sort((a, b) => a - b)) {
    running += deltas.get(seq)!;
    if (running > peak) peak = running;
  }
  return peak;
}

/** Whether adding `candidate` keeps every leg within `seatingCapacity`. */
export function hasSegmentCapacity(
  existing: readonly SegmentLeg[],
  candidate: SegmentLeg,
  seatingCapacity: number,
): boolean {
  return peakSegmentOccupancy([...existing, candidate]) <= seatingCapacity;
}

/**
 * Collapse a conflict list to one entry per real problem.
 *
 * Pairwise checks naturally report the same clash twice — once from each side
 * of the pair — so a four-cell edit can surface "19 conflicts" when there are
 * nine. An inflated count trains people to ignore the number.
 */
export function dedupeConflicts(conflicts: readonly RosterConflict[]): RosterConflict[] {
  const seen = new Set<string>();
  const out: RosterConflict[] = [];
  for (const conflict of conflicts) {
    // A pair {A,B} and {B,A} must produce the same key, so sort the ends.
    const ends = [conflict.date, conflict.relatedId ?? ""].sort().join("~");
    const key = `${conflict.kind}|${conflict.employeeId}|${ends}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(conflict);
  }
  return out;
}

/* --------------------------------------------------------- attendance ---- */

export interface ClockEventLike {
  id: string;
  employeeId: string;
  eventType: "clock_in" | "clock_out";
  occurredAt: string;
}

export interface PlannedShift {
  rosterAssignmentId: string;
  shiftTemplateId: string | null;
  startAt: string;
  endAt: string;
}

export interface AttendanceDerivation {
  status:
    | "expected"
    | "present"
    | "late"
    | "partial"
    | "absent"
    | "excused"
    | "unplanned";
  actualStartAt: string | null;
  actualEndAt: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes: number;
}

export interface DerivationOptions {
  /** Minutes after planned start before an arrival is late. */
  graceMinutes: number;
  /** Minutes before planned end that leaving early stops being rounding. */
  earlyLeaveGraceMinutes: number;
  /** Evaluation instant — a shift that has not ended cannot be an absence. */
  now: string;
  /** True when approved leave covers the planned window. */
  onApprovedLeave: boolean;
}

const MINUTE = 60_000;

/**
 * Reconcile one person's day: planned shift against observed clock events.
 *
 * The ordering of the branches is the business logic:
 *
 *   1. Approved leave outranks everything. Someone on leave is EXCUSED, never
 *      absent — the roster and the leave register disagreeing is a planning
 *      problem, not a conduct one.
 *   2. Observation with no plan is UNPLANNED, not ignored. Someone working an
 *      unrostered shift is exactly what an attendance system exists to show.
 *   3. A shift still running is EXPECTED, never absent. Marking people absent
 *      mid-shift is how attendance reports become noise people learn to skip.
 *   4. Only a finished, unobserved, unexcused shift is ABSENT.
 */
export function deriveAttendance(
  planned: PlannedShift | null,
  events: readonly ClockEventLike[],
  options: DerivationOptions,
): AttendanceDerivation {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const firstIn = ordered.find((e) => e.eventType === "clock_in") ?? null;
  // The last clock-out, and only one that follows the first clock-in: a
  // trailing clock-out from the previous shift must not close this one.
  const lastOut =
    [...ordered]
      .reverse()
      .find((e) => e.eventType === "clock_out" && (!firstIn || e.occurredAt > firstIn.occurredAt)) ??
    null;

  const actualStartAt = firstIn?.occurredAt ?? null;
  const actualEndAt = lastOut?.occurredAt ?? null;

  const workedMinutes =
    actualStartAt && actualEndAt
      ? Math.max(0, Math.round((Date.parse(actualEndAt) - Date.parse(actualStartAt)) / MINUTE))
      : 0;

  const base = { actualStartAt, actualEndAt, workedMinutes };

  /* 1 — leave outranks everything. */
  if (planned && options.onApprovedLeave) {
    return { ...base, status: "excused", lateMinutes: 0, earlyLeaveMinutes: 0 };
  }

  /* 2 — observed without a plan. */
  if (!planned) {
    if (!actualStartAt) {
      // Nothing planned and nothing observed is not a record at all.
      return { ...base, status: "expected", lateMinutes: 0, earlyLeaveMinutes: 0 };
    }
    return { ...base, status: "unplanned", lateMinutes: 0, earlyLeaveMinutes: 0 };
  }

  const plannedStart = Date.parse(planned.startAt);
  const plannedEnd = Date.parse(planned.endAt);
  const nowMs = Date.parse(options.now);

  /* 3 — nothing observed yet. */
  if (!actualStartAt) {
    const shiftOver = nowMs >= plannedEnd;
    return {
      ...base,
      status: shiftOver ? "absent" : "expected",
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
    };
  }

  const lateMinutes = Math.max(
    0,
    Math.round((Date.parse(actualStartAt) - plannedStart) / MINUTE) - options.graceMinutes,
  );

  /* 4 — observed, but not yet closed out. */
  if (!actualEndAt) {
    // Still inside the shift: present (or late), not partial. A missing
    // clock-out only becomes a problem once the shift has ended.
    if (nowMs < plannedEnd) {
      return { ...base, status: lateMinutes > 0 ? "late" : "present", lateMinutes, earlyLeaveMinutes: 0 };
    }
    return { ...base, status: "partial", lateMinutes, earlyLeaveMinutes: 0 };
  }

  const earlyLeaveMinutes = Math.max(
    0,
    Math.round((plannedEnd - Date.parse(actualEndAt)) / MINUTE) - options.earlyLeaveGraceMinutes,
  );

  if (earlyLeaveMinutes > 0) {
    return { ...base, status: "partial", lateMinutes, earlyLeaveMinutes };
  }

  return {
    ...base,
    status: lateMinutes > 0 ? "late" : "present",
    lateMinutes,
    earlyLeaveMinutes: 0,
  };
}

/**
 * Reject a clock event that cannot describe a real sequence.
 *
 * Returns a reason string, or null when the event is acceptable.
 */
export function validateClockEvent(
  candidate: { employeeId: string; eventType: "clock_in" | "clock_out"; occurredAt: string },
  existing: readonly ClockEventLike[],
  now: string,
): string | null {
  if (candidate.occurredAt > now) {
    return "Ирээдүйн цагаар бүртгэл хийх боломжгүй.";
  }

  const sameDay = existing
    .filter((e) => e.employeeId === candidate.employeeId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const last = sameDay.at(-1);
  if (!last) {
    return candidate.eventType === "clock_out"
      ? "Эхлээд ирснийг бүртгэх шаардлагатай."
      : null;
  }

  if (last.eventType === candidate.eventType) {
    return candidate.eventType === "clock_in"
      ? "Энэ ажилтан аль хэдийн ирсэн бүртгэлтэй байна."
      : "Энэ ажилтан аль хэдийн явсан бүртгэлтэй байна.";
  }

  if (candidate.occurredAt < last.occurredAt) {
    return "Бүртгэлийн дараалал буруу байна.";
  }

  return null;
}

/* ---------------------------------------------------- transport: resources -- */

export interface TripWindow {
  id: string;
  vehicleId: string | null;
  driverId: string | null;
  departureAt: string;
  estimatedArrivalAt: string;
  status: string;
}

/** Trip states that actually tie up a vehicle and a driver. */
export const ACTIVE_TRIP_STATUSES = ["scheduled", "boarding", "departed", "delayed"] as const;

export function tripHoldsResources(status: string): boolean {
  return (ACTIVE_TRIP_STATUSES as readonly string[]).includes(status);
}

export type ResourceConflict =
  | { kind: "vehicle"; tripId: string; message: string }
  | { kind: "driver"; tripId: string; message: string };

/**
 * A vehicle and a driver can each only be in one place at a time.
 *
 * Turnaround padding is deliberate: a bus scheduled to arrive at 18:00 cannot
 * depart on another route at 18:05. Allowing back-to-back trips with no slack
 * produces a timetable that is valid on paper and impossible on the road.
 */
export function findTripResourceConflicts(
  candidate: TripWindow,
  existing: readonly TripWindow[],
  turnaroundMinutes = 45,
): ResourceConflict[] {
  if (!tripHoldsResources(candidate.status)) return [];

  const padding = turnaroundMinutes * 60_000;
  const from = Date.parse(candidate.departureAt) - padding;
  const to = Date.parse(candidate.estimatedArrivalAt) + padding;

  const conflicts: ResourceConflict[] = [];

  for (const other of existing) {
    if (other.id === candidate.id) continue;
    if (!tripHoldsResources(other.status)) continue;

    const otherFrom = Date.parse(other.departureAt);
    const otherTo = Date.parse(other.estimatedArrivalAt);
    const overlaps = from < otherTo && otherFrom < to;
    if (!overlaps) continue;

    if (candidate.vehicleId && other.vehicleId === candidate.vehicleId) {
      conflicts.push({
        kind: "vehicle",
        tripId: other.id,
        message: "Энэ тээврийн хэрэгсэл тухайн цагт өөр рейсэд хуваарилагдсан байна.",
      });
    }
    if (candidate.driverId && other.driverId === candidate.driverId) {
      conflicts.push({
        kind: "driver",
        tripId: other.id,
        message: "Энэ жолооч тухайн цагт өөр рейсэд хуваарилагдсан байна.",
      });
    }
  }

  return conflicts;
}

/* ------------------------------------------------- transport: seat demand -- */

export interface PassengerLeg extends SegmentLeg {
  passengerId: string;
  status: string;
}

/** Passenger states that actually consume a seat. */
export function passengerHoldsSeat(status: string): boolean {
  return status === "booked" || status === "boarded" || status === "arrived";
}

export interface LegLoad {
  fromSeq: number;
  toSeq: number;
  occupancy: number;
}

/**
 * Occupancy on every leg of a route, not just the peak.
 *
 * The peak alone tells you a trip is full; this tells you *where*, which is
 * what a coordinator needs in order to decide whether a second vehicle is
 * required for one stretch or for the whole run.
 */
export function legLoads(legs: readonly SegmentLeg[], stopCount: number): LegLoad[] {
  const loads: LegLoad[] = [];
  for (let seq = 0; seq < stopCount - 1; seq++) {
    const occupancy = legs.filter(
      (leg) => leg.boardingSeq <= seq && leg.destinationSeq > seq,
    ).length;
    loads.push({ fromSeq: seq, toSeq: seq + 1, occupancy });
  }
  return loads;
}

/**
 * Seats still sellable for a specific journey.
 *
 * Returns the smallest remaining capacity across the legs the journey spans —
 * a trip with 40 free seats overall has none for a passenger whose leg is the
 * full one.
 */
export function seatsAvailableForLeg(
  existing: readonly SegmentLeg[],
  candidate: SegmentLeg,
  seatingCapacity: number,
): number {
  if (candidate.destinationSeq <= candidate.boardingSeq) {
    throw new RangeError("Буух зогсоол нь суух зогсоолоос хойш байх ёстой.");
  }
  let worst = seatingCapacity;
  for (let seq = candidate.boardingSeq; seq < candidate.destinationSeq; seq++) {
    const onBoard = existing.filter(
      (leg) => leg.boardingSeq <= seq && leg.destinationSeq > seq,
    ).length;
    worst = Math.min(worst, seatingCapacity - onBoard);
  }
  return Math.max(0, worst);
}
