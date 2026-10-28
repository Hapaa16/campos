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
