/* ===========================================================================
   Authorization primitives.

   A permission is a tuple of (action, subject, scope) — never a role name.
   "Can approve leave for org unit 1.4" is the unit of authorization;
   "is a supervisor" is not, and must never appear in a check.
   ========================================================================= */

export const ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "approve",
  "publish",
  "export",
  "checkin",
  "checkout",
  "assign",
  "manage", // CASL alias: every action
] as const;
export type Action = (typeof ACTIONS)[number];

export const SUBJECTS = [
  // organization & structure
  "Organization",
  "Site",
  "OrgUnit",
  "OrgUnitType",
  "Position",
  "PositionAssignment",
  // workforce
  "Employee",
  // rostering
  "RosterPattern",
  "ShiftTemplate",
  "RosterPeriod",
  "RosterAssignment",
  "LeaveRequest",
  "Attendance",
  // camp & accommodation
  "Camp",
  "Building",
  "Room",
  "Bed",
  "AccommodationBooking",
  // transport
  "Vehicle",
  "Driver",
  "TransportRoute",
  "TransportTrip",
  "TransportBooking",
  "TransportPassenger",
  "BoardingRecord",
  // visitors
  "Visitor",
  "Visit",
  "VisitorBadge",
  // services & ops
  "MealForecast",
  "ServiceRequest",
  // platform
  "Report",
  "User",
  "Role",
  "Setting",
  "AuditLog",
  "all", // CASL alias: every subject
] as const;
export type Subject = (typeof SUBJECTS)[number];

/**
 * Scope placeholders are resolved against the AuthContext when the ability is
 * built. Storing the placeholder rather than the value is what lets roles be
 * stored as data and edited in Settings → Roles without a deploy.
 */
export type ScopePlaceholder =
  | "$orgId"
  | "$userId"
  | "$self" // the acting user's employee id
  | "$siteIds"
  | "$campIds"
  | "$orgUnitPathPrefix";

export interface PermissionTuple {
  action: Action | Action[];
  subject: Subject | Subject[];
  /** Mongo-style conditions. Values may be ScopePlaceholder strings. */
  conditions?: Record<string, unknown>;
  /** Restricts which fields the rule covers (field-level authorization). */
  fields?: readonly string[];
  /** `true` turns this into a `cannot` rule. Inverted rules always win. */
  inverted?: boolean;
  /** Surfaced to the user when this rule is what denied them. */
  reason?: string;
}

export type RoleScope = "platform" | "organization";

export interface RoleDefinition {
  id: string;
  scope: RoleScope;
  name: { mn: string; en: string };
  description: { mn: string; en: string };
  permissions: PermissionTuple[];
  /** Seeded roles cannot be deleted; their permissions can still be edited. */
  system: boolean;
}

/**
 * Everything the authorization layer is allowed to know about the actor.
 * Built server-side from the verified session — never from request input.
 */
export interface AuthContext {
  userId: string;
  /** Active tenant. `null` only for a platform admin who has not picked one. */
  organizationId: string | null;
  /** Linked employee record, when the user is also a worker. */
  employeeId: string | null;
  roleIds: string[];
  /** Site-level scope grants. */
  siteIds: string[];
  /** Camp-level scope grants. */
  campIds: string[];
  /** Materialised path of the actor's org unit, e.g. "1.4.9". */
  orgUnitPath: string | null;
  isPlatformAdmin: boolean;
  /** Bumped when roles change, to invalidate sessions carrying stale grants. */
  permVersion: number;
}

/** Fields on Employee that are personal information, gated at field level. */
export const EMPLOYEE_PII_FIELDS = [
  "nationalId",
  "passportNo",
  "dateOfBirth",
  "personalPhone",
  "personalEmail",
  "homeAddress",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelation",
  "medicalNotes",
  "bankAccount",
  "salaryGrade",
] as const;

/** Fields on Visitor that are personal information. */
export const VISITOR_PII_FIELDS = [
  "nationalId",
  "passportNo",
  "dateOfBirth",
  "phone",
  "email",
  "vehiclePlate",
] as const;

/** Non-sensitive Employee fields, safe for anyone with `read Employee`. */
export const EMPLOYEE_PUBLIC_FIELDS = [
  "id",
  "organizationId",
  "employeeCode",
  "firstName",
  "lastName",
  "displayName",
  "avatarColor",
  "status",
  "employmentType",
  "jobTitle",
  "positionId",
  "orgUnitId",
  "orgUnitPath",
  "siteId",
  "campId",
  "legalEmployerId",
  "contractorCompany",
  "workPhone",
  "workEmail",
  "supervisorId",
  "hiredAt",
  "rotationPatternId",
  "rotationAnchorDate",
  "qualifications",
] as const;
