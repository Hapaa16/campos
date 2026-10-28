import "server-only";
import { addDays, format, startOfDay } from "date-fns";
import { db } from "@/server/db/store";
import { query, type DataContext } from "@/server/db/query";
import { canType } from "@/lib/authz/ability";

/* ===========================================================================
   Dashboard aggregates.

   Every figure is computed through the query layer, so a camp manager's
   "free beds" counts only their camps and a supervisor's headcount counts only
   their subtree — without a single scope check written here. If a widget shows
   a number the actor should not know, the bug is in a role definition, not in
   this file.
   ========================================================================= */

export interface CampOccupancy {
  campId: string;
  campName: string;
  totalBeds: number;
  occupied: number;
  reserved: number;
  unavailable: number;
}

export interface DashboardData {
  /** Null means "not permitted to know", which the UI renders as absence. */
  inCamp: number | null;
  freeBeds: number | null;
  totalBeds: number | null;
  arrivalsToday: number | null;
  departuresToday: number | null;
  headcount: number | null;
  rosterCoverage: { assigned: number; required: number; periodName: string } | null;
  pendingApprovals: number | null;
  expiringQualifications: number | null;
  occupancyByCamp: CampOccupancy[];
  noShows: number | null;
}

export function getDashboard(ctx: DataContext): DashboardData {
  const data = db();
  const ability = ctx.ability;

  const today = startOfDay(new Date());
  const todayStr = format(today, "yyyy-MM-dd");
  const tomorrow = addDays(today, 1).toISOString();
  const todayIso = today.toISOString();

  const mayReadBookings = canType(ability, "read", "AccommodationBooking");
  const mayReadBeds = canType(ability, "read", "Bed");
  const mayReadEmployees = canType(ability, "read", "Employee");
  const mayReadRoster = canType(ability, "read", "RosterPeriod");
  const mayApproveLeave = canType(ability, "approve", "LeaveRequest");

  const bookings = mayReadBookings
    ? query(ctx, "AccommodationBooking", data.accommodationBookings).all()
    : [];
  const beds = mayReadBeds ? query(ctx, "Bed", data.beds).all() : [];

  /* Occupancy is the count of ACTUAL check-ins, never of reservations —
     conflating them is how a camp reports 1,284 people who are not there. */
  const inCamp = mayReadBookings
    ? bookings.filter((b) => b.status === "checked_in").length
    : null;

  const heldBedIds = new Set(
    bookings
      .filter(
        (b) =>
          (b.status === "reserved" || b.status === "checked_in") &&
          b.startAt < tomorrow &&
          b.endAt > todayIso,
      )
      .map((b) => b.bedId),
  );

  const serviceableBeds = beds.filter((b) => b.status === "available");
  const freeBeds = mayReadBeds
    ? serviceableBeds.filter((b) => !heldBedIds.has(b.id)).length
    : null;

  const arrivalsToday = mayReadBookings
    ? bookings.filter((b) => b.status === "reserved" && b.startAt.slice(0, 10) === todayStr).length
    : null;

  const departuresToday = mayReadBookings
    ? bookings.filter(
        (b) => (b.status === "checked_in" || b.status === "reserved") && b.endAt.slice(0, 10) === todayStr,
      ).length
    : null;

  const noShows = mayReadBookings ? bookings.filter((b) => b.status === "no_show").length : null;

  /* -- occupancy per camp ------------------------------------------------ */
  // Requires BOTH beds and bookings: a camp row without them is all zeros,
  // which reads as "this camp is empty" rather than "you cannot see this".
  const camps =
    canType(ability, "read", "Camp") && mayReadBeds && mayReadBookings
      ? query(ctx, "Camp", data.camps).all()
      : [];
  const occupancyByCamp: CampOccupancy[] = camps.map((camp) => {
    const campBeds = beds.filter((b) => b.campId === camp.id);
    const campBookings = bookings.filter(
      (b) => b.campId === camp.id && b.startAt < tomorrow && b.endAt > todayIso,
    );
    return {
      campId: camp.id,
      campName: camp.name,
      totalBeds: campBeds.length,
      occupied: campBookings.filter((b) => b.status === "checked_in").length,
      reserved: campBookings.filter((b) => b.status === "reserved").length,
      unavailable: campBeds.filter((b) => b.status !== "available").length,
    };
  });

  /* -- workforce --------------------------------------------------------- */
  const employees = mayReadEmployees ? query(ctx, "Employee", data.employees).all() : [];
  const headcount = mayReadEmployees
    ? employees.filter((e) => e.status === "active").length
    : null;

  const horizon = format(addDays(today, 60), "yyyy-MM-dd");
  const expiringQualifications = mayReadEmployees
    ? employees.filter((e) =>
        e.qualifications.some((q) => q.expiresAt !== null && q.expiresAt <= horizon),
      ).length
    : null;

  /* -- roster coverage --------------------------------------------------- */
  let rosterCoverage: DashboardData["rosterCoverage"] = null;
  // Coverage needs the establishment, which lives on org units. Without that
  // permission the ratio is unknowable — and "0 / 0" would read as a total
  // staffing failure rather than as a figure this role cannot see.
  if (mayReadRoster && canType(ability, "read", "OrgUnit")) {
    const period = query(ctx, "RosterPeriod", data.rosterPeriods)
      .where((p) => p.startDate <= todayStr && p.endDate >= todayStr)
      .first();

    if (period) {
      // Both sides of this fraction must describe the same population, or the
      // ratio is meaningless. Only units that declare an establishment count,
      // and only people rostered into those units are counted against it.
      const unitsWithTarget = query(ctx, "OrgUnit", data.orgUnits)
        .where((u) => u.headcountTarget !== null && u.status === "active")
        .all();

      const targetPaths = unitsWithTarget.map((u) => u.path);
      const required = unitsWithTarget.reduce((sum, u) => sum + (u.headcountTarget ?? 0), 0);

      const assigned = query(ctx, "RosterAssignment", data.rosterAssignments)
        .where(
          (a) =>
            a.rosterPeriodId === period.id &&
            a.date === todayStr &&
            a.dayType === "shift" &&
            a.orgUnitPath !== null &&
            targetPaths.some(
              (path) => a.orgUnitPath === path || a.orgUnitPath!.startsWith(`${path}.`),
            ),
        )
        .count();

      rosterCoverage = { assigned, required, periodName: period.name };
    }
  }

  const pendingApprovals = mayApproveLeave
    ? query(ctx, "LeaveRequest", data.leaveRequests).where((l) => l.status === "pending").count()
    : null;

  return {
    inCamp,
    freeBeds,
    totalBeds: mayReadBeds ? beds.length : null,
    arrivalsToday,
    departuresToday,
    headcount,
    rosterCoverage,
    pendingApprovals,
    expiringQualifications,
    occupancyByCamp,
    noShows,
  };
}
