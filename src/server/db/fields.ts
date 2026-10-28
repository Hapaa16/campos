import "server-only";
import { registerFields } from "@/server/serialize/pii";
import { EMPLOYEE_PII_FIELDS, EMPLOYEE_PUBLIC_FIELDS, VISITOR_PII_FIELDS } from "@/lib/authz/types";

/* ===========================================================================
   Field catalogues.

   CASL can only subtract from a known column list, so every maskable subject
   must declare its full set here. maskRecord() throws loudly on an unregistered
   subject rather than passing the record through — a missing catalogue must be
   a crash, never a silent data leak.
   ========================================================================= */

registerFields("Employee", [...EMPLOYEE_PUBLIC_FIELDS, ...EMPLOYEE_PII_FIELDS]);

registerFields("Visitor", [
  "id",
  "organizationId",
  "fullName",
  "companyName",
  "photoUrl",
  "status",
  ...VISITOR_PII_FIELDS,
]);

registerFields("OrgUnit", [
  "id", "organizationId", "parentId", "unitTypeId", "code", "name",
  "status", "sortOrder", "path", "depth", "headcountTarget",
]);

registerFields("OrgUnitType", [
  "id", "organizationId", "code", "name", "isAssignable", "sortOrder",
]);

registerFields("Position", ["id", "organizationId", "code", "title", "jobFamily", "grade"]);

registerFields("PositionAssignment", [
  "id", "organizationId", "employeeId", "orgUnitId", "orgUnitPath", "positionId",
  "reportsToAssignmentId", "effectiveFrom", "effectiveTo", "isPrimary",
]);

registerFields("Site", ["id", "organizationId", "code", "name", "timezone", "status"]);

registerFields("Organization", [
  "id", "name", "slug", "timezone", "defaultLocale", "status",
]);

registerFields("ShiftTemplate", [
  "id", "organizationId", "code", "name", "startTime", "endTime",
  "breakMinutes", "shiftType", "colorToken",
]);

registerFields("RosterPattern", [
  "id", "organizationId", "code", "name", "cycleLength", "configuration",
]);

registerFields("RosterPeriod", [
  "id", "organizationId", "siteId", "name", "startDate", "endDate",
  "status", "version", "publishedAt", "publishedBy", "createdAt",
]);

registerFields("RosterAssignment", [
  "id", "organizationId", "rosterPeriodId", "employeeId", "orgUnitPath", "siteId",
  "date", "shiftTemplateId", "dayType", "startAt", "endAt", "status", "source", "note",
]);

registerFields("LeaveRequest", [
  "id", "organizationId", "employeeId", "orgUnitPath", "startAt", "endAt",
  "leaveType", "status", "reason", "requestedAt", "decidedBy", "decidedAt", "decisionReason",
]);

registerFields("Camp", ["id", "organizationId", "siteId", "code", "name", "status"]);

registerFields("Building", [
  "id", "organizationId", "campId", "code", "name", "floorCount",
]);

registerFields("Room", [
  "id", "organizationId", "campId", "buildingId", "floor", "roomNumber",
  "roomType", "capacity", "status", "housekeeping", "genderPolicy",
]);

registerFields("Bed", [
  "id", "organizationId", "campId", "buildingId", "roomId", "bedCode", "status",
]);

registerFields("AccommodationBooking", [
  "id", "organizationId", "campId", "buildingId", "roomId", "bedId",
  "personType", "employeeId", "visitorId", "startAt", "endAt", "status",
  "checkedInAt", "checkedInBy", "checkedOutAt", "checkedOutBy",
  "createdAt", "createdBy", "idempotencyKey", "note",
]);

registerFields("Attendance", [
  "id", "organizationId", "employeeId", "orgUnitPath", "siteId", "date",
  "rosterAssignmentId", "shiftTemplateId", "plannedStartAt", "plannedEndAt",
  "actualStartAt", "actualEndAt", "status", "derivedStatus",
  "lateMinutes", "earlyLeaveMinutes", "workedMinutes",
  "correctedBy", "correctedAt", "correctionReason", "source", "note",
]);

registerFields("AuditLog", [
  "id", "organizationId", "actorUserId", "actorName", "action", "subject",
  "subjectId", "before", "after", "reason", "ip", "at",
]);

registerFields("Role", [
  "id", "scope", "name", "description", "permissions", "system",
]);

registerFields("User", [
  "id", "email", "name", "avatarColor", "isPlatformAdmin",
  "memberships", "permVersion", "status",
]);
