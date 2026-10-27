/* ===========================================================================
   Domain model.

   Shaped to mirror the eventual PostgreSQL schema one-for-one, so moving to
   the Fastify + Postgres backend is a transport swap rather than a rewrite.

   Two separations are load-bearing and must never be collapsed:
     - planned state vs actual state (booking ≠ check-in, roster ≠ attendance)
     - identity vs authorization vs physical presence
   ========================================================================= */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // RFC3339, always UTC

/* ------------------------------------------------------------- tenancy ---- */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  defaultLocale: "mn" | "en";
  status: "active" | "suspended";
}

export interface Site {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  timezone: string;
  status: "active" | "archived";
}

/* -------------------------------------------------- organizational chart --- */

export interface OrgUnitType {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  /** Whether employees may be assigned directly to units of this type. */
  isAssignable: boolean;
  sortOrder: number;
}

export interface OrgUnit {
  id: string;
  organizationId: string;
  parentId: string | null;
  unitTypeId: string;
  code: string;
  name: string;
  status: "active" | "archived";
  sortOrder: number;
  /** Materialised path, e.g. "1.4.9". Derived — never written by a client. */
  path: string;
  depth: number;
  headcountTarget: number | null;
}

export interface Position {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  jobFamily: string;
  grade: string;
}

export interface PositionAssignment {
  id: string;
  organizationId: string;
  employeeId: string;
  orgUnitId: string;
  orgUnitPath: string;
  positionId: string;
  /**
   * Reporting line. Deliberately separate from OrgUnit.parentId: who you
   * report to is not the same relationship as where your unit sits.
   */
  reportsToAssignmentId: string | null;
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  isPrimary: boolean;
}

/* ----------------------------------------------------------- workforce ---- */

export type EmploymentStatus = "active" | "on_leave" | "suspended" | "terminated";
export type EmploymentType = "employee" | "contractor" | "subcontractor";

export interface Employee {
  id: string;
  organizationId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarColor: string;
  status: EmploymentStatus;
  employmentType: EmploymentType;
  jobTitle: string;
  positionId: string | null;
  orgUnitId: string | null;
  orgUnitPath: string | null;
  siteId: string | null;
  campId: string | null;
  /** Legal employer — a subcontractor's worker is not our employee. */
  legalEmployerId: string | null;
  contractorCompany: string | null;
  workPhone: string | null;
  workEmail: string | null;
  supervisorId: string | null;
  hiredAt: ISODate;
  rotationPatternId: string | null;
  /** Per-employee rotation start. Never assume a shared anchor. */
  rotationAnchorDate: ISODate | null;
  qualifications: Qualification[];

  /* ---- personal information: gated at field level (layer 5) ------------- */
  nationalId: string | null;
  passportNo: string | null;
  dateOfBirth: ISODate | null;
  personalPhone: string | null;
  personalEmail: string | null;
  homeAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  medicalNotes: string | null;
  bankAccount: string | null;
  salaryGrade: string | null;
}

export interface Qualification {
  code: string;
  name: string;
  issuedAt: ISODate;
  expiresAt: ISODate | null;
}

/* -------------------------------------------------------------- roster ---- */

export type ShiftType = "day" | "night" | "swing" | "travel" | "standby";

export interface ShiftTemplate {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  /** Local wall-clock at the site; converted to UTC per site timezone. */
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  breakMinutes: number;
  shiftType: ShiftType;
  colorToken: "plan" | "ok" | "warn" | "danger" | "neutral" | "accent";
}

/** One slot per day of the cycle. `null` means a rest day. */
export type RotationSlot = { shiftTemplateId: string } | { rest: true } | { travel: "in" | "out" };

export interface RosterPattern {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  cycleLength: number;
  configuration: RotationSlot[];
}

export type RosterPeriodStatus = "draft" | "review" | "published" | "archived";

export interface RosterPeriod {
  id: string;
  organizationId: string;
  siteId: string;
  name: string;
  startDate: ISODate;
  endDate: ISODate;
  status: RosterPeriodStatus;
  version: number;
  publishedAt: ISODateTime | null;
  publishedBy: string | null;
  createdAt: ISODateTime;
}

export type AssignmentStatus = "planned" | "confirmed" | "cancelled";

export interface RosterAssignment {
  id: string;
  organizationId: string;
  rosterPeriodId: string;
  employeeId: string;
  /** Denormalised for subtree-scoped authorization without a join. */
  orgUnitPath: string | null;
  siteId: string;
  date: ISODate;
  shiftTemplateId: string | null;
  /** `rest` and `travel` days carry no shift template. */
  dayType: "shift" | "rest" | "travel_in" | "travel_out" | "leave";
  startAt: ISODateTime | null;
  endAt: ISODateTime | null;
  status: AssignmentStatus;
  source: "generated" | "manual" | "swap";
  note: string | null;
}

export type LeaveType = "annual" | "sick" | "unpaid" | "parental" | "training" | "compassionate";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  organizationId: string;
  employeeId: string;
  orgUnitPath: string | null;
  startAt: ISODateTime;
  endAt: ISODateTime;
  leaveType: LeaveType;
  status: LeaveStatus;
  reason: string | null;
  requestedAt: ISODateTime;
  decidedBy: string | null;
  decidedAt: ISODateTime | null;
  decisionReason: string | null;
}

/* ---------------------------------------------------------------- camp ---- */

export interface Camp {
  id: string;
  organizationId: string;
  siteId: string;
  code: string;
  name: string;
  status: "active" | "closed";
}

export interface Building {
  id: string;
  organizationId: string;
  campId: string;
  code: string;
  name: string;
  floorCount: number;
}

export type RoomType = "single" | "double" | "twin" | "quad" | "dorm";
export type RoomStatus = "available" | "maintenance" | "out_of_service";

export interface Room {
  id: string;
  organizationId: string;
  campId: string;
  buildingId: string;
  floor: number;
  roomNumber: string;
  roomType: RoomType;
  capacity: number;
  status: RoomStatus;
  /** Housekeeping is a separate axis from availability. */
  housekeeping: "clean" | "dirty" | "in_progress";
  genderPolicy: "any" | "male" | "female";
}

export type BedStatus = "available" | "maintenance" | "out_of_service";

export interface Bed {
  id: string;
  organizationId: string;
  campId: string;
  buildingId: string;
  roomId: string;
  bedCode: string;
  status: BedStatus;
}

export type BookingStatus =
  | "reserved"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export interface AccommodationBooking {
  id: string;
  organizationId: string;
  campId: string;
  buildingId: string;
  roomId: string;
  bedId: string;
  personType: "employee" | "visitor";
  employeeId: string | null;
  visitorId: string | null;
  /** Planned occupancy window. Half-open: [startAt, endAt). */
  startAt: ISODateTime;
  endAt: ISODateTime;
  status: BookingStatus;
  /** Actual events — never inferred from the booking window. */
  checkedInAt: ISODateTime | null;
  checkedInBy: string | null;
  checkedOutAt: ISODateTime | null;
  checkedOutBy: string | null;
  createdAt: ISODateTime;
  createdBy: string;
  idempotencyKey: string | null;
  note: string | null;
}

/* -------------------------------------------------- users & membership ---- */

export interface Membership {
  organizationId: string;
  roleIds: string[];
  /** Links the login to a workforce record, enabling `$self` scoping. */
  employeeId: string | null;
  siteIds: string[];
  campIds: string[];
  orgUnitPath: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  /** Demo-only credential. A real deployment hashes with argon2id. */
  devPassword: string;
  isPlatformAdmin: boolean;
  memberships: Membership[];
  permVersion: number;
  status: "active" | "disabled";
}

/* --------------------------------------------------------------- audit ---- */

export interface AuditLog {
  id: string;
  organizationId: string;
  actorUserId: string;
  actorName: string;
  action: string;
  subject: string;
  subjectId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  at: ISODateTime;
}
