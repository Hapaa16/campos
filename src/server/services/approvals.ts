import "server-only";
import { db } from "@/server/db/store";
import { authorizeOn, query, requireOne, type DataContext } from "@/server/db/query";
import { ConflictError } from "@/lib/errors";
import { canType } from "@/lib/authz/ability";
import type { LeaveRequest, RosterPeriod } from "@/server/db/schema";

/* ===========================================================================
   Approvals.

   One queue, several kinds of decision. Each row records who decided, when,
   and why — an approval without an actor is not an approval, it is a state
   change nobody is accountable for.
   ========================================================================= */

export interface LeaveApprovalItem {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  avatarColor: string;
  orgUnitName: string | null;
  leaveType: LeaveRequest["leaveType"];
  startAt: string;
  endAt: string;
  days: number;
  reason: string | null;
  requestedAt: string;
  /** Shifts this person is rostered onto inside the requested window. */
  clashingShifts: number;
}

export interface RosterApprovalItem {
  id: string;
  name: string;
  siteName: string | null;
  startDate: string;
  endDate: string;
  status: RosterPeriod["status"];
  assignments: number;
  conflicts: number;
}

export interface ApprovalsData {
  leave: LeaveApprovalItem[];
  rosters: RosterApprovalItem[];
  canApproveLeave: boolean;
  canPublishRoster: boolean;
}

export function getApprovals(ctx: DataContext): ApprovalsData {
  const data = db();

  const canApproveLeave = canType(ctx.ability, "approve", "LeaveRequest");
  const canPublishRoster = canType(ctx.ability, "publish", "RosterPeriod");

  const employees = new Map(query(ctx, "Employee", data.employees).all().map((e) => [e.id, e]));
  const unitNames = new Map(query(ctx, "OrgUnit", data.orgUnits).all().map((u) => [u.id, u.name]));
  const siteNames = new Map(query(ctx, "Site", data.sites).all().map((s) => [s.id, s.name]));

  const leave: LeaveApprovalItem[] = canApproveLeave
    ? query(ctx, "LeaveRequest", data.leaveRequests, (l) => l.status === "pending")
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
        .all()
        .map((request) => {
          const employee = employees.get(request.employeeId);
          // Surface the operational cost of saying yes, next to the request.
          const clashingShifts = data.rosterAssignments.filter(
            (a) =>
              a.employeeId === request.employeeId &&
              a.dayType === "shift" &&
              a.startAt !== null &&
              a.endAt !== null &&
              a.startAt < request.endAt &&
              request.startAt < a.endAt,
          ).length;

          return {
            id: request.id,
            employeeId: request.employeeId,
            employeeName: employee?.displayName ?? "—",
            employeeCode: employee?.employeeCode ?? "",
            avatarColor: employee?.avatarColor ?? "neutral",
            orgUnitName: employee?.orgUnitId ? (unitNames.get(employee.orgUnitId) ?? null) : null,
            leaveType: request.leaveType,
            startAt: request.startAt,
            endAt: request.endAt,
            days: Math.max(
              1,
              Math.round((Date.parse(request.endAt) - Date.parse(request.startAt)) / 864e5),
            ),
            reason: request.reason,
            requestedAt: request.requestedAt,
            clashingShifts,
          };
        })
    : [];

  const rosters: RosterApprovalItem[] = canPublishRoster
    ? query(ctx, "RosterPeriod", data.rosterPeriods, (p) => p.status === "draft" || p.status === "review")
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .all()
        .map((period) => ({
          id: period.id,
          name: period.name,
          siteName: siteNames.get(period.siteId) ?? null,
          startDate: period.startDate,
          endDate: period.endDate,
          status: period.status,
          assignments: data.rosterAssignments.filter((a) => a.rosterPeriodId === period.id).length,
          conflicts: 0,
        }))
    : [];

  return { leave, rosters, canApproveLeave, canPublishRoster };
}

export function decideLeave(
  ctx: DataContext,
  requestId: string,
  decision: "approved" | "rejected",
  reason: string,
): LeaveRequest {
  const data = db();
  const request = requireOne(ctx, "LeaveRequest", data.leaveRequests, requestId);
  authorizeOn(ctx, "approve", "LeaveRequest", request);

  if (request.status !== "pending") {
    throw new ConflictError("Энэ хүсэлт аль хэдийн шийдвэрлэгдсэн байна.");
  }

  request.status = decision;
  request.decidedBy = ctx.auth.userId;
  request.decidedAt = new Date().toISOString();
  request.decisionReason = reason;
  return request;
}
