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
  /** Minutes after shift start before an arrival counts as late. */
  attendanceGraceMinutes: number;
  /** Minutes before shift end that leaving early stops being rounding. */
  earlyLeaveGraceMinutes: number;
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

/* ----------------------------------------------------------- transport ---- */

export type VehicleOwnership = "owned" | "contracted";
export type VehicleStatus = "active" | "maintenance" | "retired";

export interface Vehicle {
  id: string;
  organizationId: string;
  registrationNumber: string;
  vehicleType: "bus" | "coaster" | "van" | "4wd";
  seatingCapacity: number;
  ownership: VehicleOwnership;
  /** Set when the vehicle belongs to a contractor rather than to us. */
  providerName: string | null;
  status: VehicleStatus;
  note: string | null;
}

export interface Driver {
  id: string;
  organizationId: string;
  /** Null for a contractor's driver, who is not our employee. */
  employeeId: string | null;
  fullName: string;
  phone: string;
  licenceNumber: string;
  licenceExpiresAt: ISODate;
  providerName: string | null;
  status: "active" | "suspended" | "inactive";
}

export interface TransportRoute {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  origin: string;
  destination: string;
  /** Scheduled duration, used to seed a trip's estimated arrival. */
  durationMinutes: number;
  status: "active" | "archived";
}

export interface TransportStop {
  id: string;
  organizationId: string;
  routeId: string;
  name: string;
  /** Position along the route. Legs are expressed between these numbers. */
  sequenceNumber: number;
  /** Minutes after departure that the vehicle reaches this stop. */
  scheduledOffsetMinutes: number;
  siteId: string | null;
  campId: string | null;
}

export type TripStatus =
  | "scheduled"
  | "boarding"
  | "departed"
  | "arrived"
  | "cancelled"
  | "delayed";

export interface TransportTrip {
  id: string;
  organizationId: string;
  routeId: string;
  /** Null until a vehicle is assigned — a scheduled trip need not have one. */
  vehicleId: string | null;
  driverId: string | null;
  departureAt: ISODateTime;
  estimatedArrivalAt: ISODateTime;
  actualDepartureAt: ISODateTime | null;
  actualArrivalAt: ISODateTime | null;
  status: TripStatus;
  /** Set when status is `cancelled` or `delayed`. */
  statusReason: string | null;
  note: string | null;
}

export type BookingStatusTransport = "requested" | "confirmed" | "cancelled" | "completed";

/**
 * A request to travel.
 *
 * Deliberately NOT a seat on a bus. One booking can span several trips (an
 * overnight leg, a transfer, a return) and a trip carries passengers from many
 * bookings. Modelling a booking as "one person on one bus" is what makes
 * transfers and returns impossible to express later.
 */
export interface TransportBooking {
  id: string;
  organizationId: string;
  bookingReference: string;
  requestedBy: string;
  requestedAt: ISODateTime;
  status: BookingStatusTransport;
  purpose: string | null;
  note: string | null;
  idempotencyKey: string | null;
}

export type PassengerStatus = "booked" | "boarded" | "no_show" | "cancelled" | "arrived";

/**
 * One person on one trip, between two stops.
 *
 * The stop pair is what makes seat capacity a segment problem rather than a
 * headcount: a passenger riding stops 1→2 does not occupy a seat on leg 3→4.
 */
export interface TransportPassenger {
  id: string;
  organizationId: string;
  bookingId: string;
  tripId: string;
  /** Exactly one of these is set. */
  employeeId: string | null;
  visitorId: string | null;
  boardingStopId: string;
  destinationStopId: string;
  status: PassengerStatus;
  seatNumber: string | null;
}

/**
 * A physical boarding event.
 *
 * Separate from the passenger row on purpose: being booked on a bus is not
 * evidence of having got on it, exactly as a bed reservation is not evidence
 * of having slept in it.
 */
export interface BoardingRecord {
  id: string;
  organizationId: string;
  passengerId: string;
  tripId: string;
  eventType: "boarded" | "alighted" | "no_show";
  occurredAt: ISODateTime;
  stopId: string;
  recordedBy: string;
  /** Set when a QR pass was scanned rather than a name ticked off. */
  scannedCode: string | null;
}

export interface TransportIncident {
  id: string;
  organizationId: string;
  tripId: string;
  incidentType: "breakdown" | "delay" | "road_closure" | "accident" | "weather" | "other";
  description: string;
  occurredAt: ISODateTime;
  delayMinutes: number | null;
  status: "open" | "resolved";
  reportedBy: string;
}

/* ---------------------------------------------------------- attendance ---- */

/**
 * A raw clock fact.
 *
 * Append-only and never edited: it records that a reader, a terminal or a
 * supervisor asserted someone was at work at an instant. Corrections produce
 * a new event or adjust the derived record — they do not rewrite history.
 *
 * Deliberately NOT the same thing as an accommodation check-in. Sleeping in
 * camp is not evidence of working, and working is not evidence of sleeping in
 * camp; conflating them is how a site reports attendance it never observed.
 */
export interface AttendanceEvent {
  id: string;
  organizationId: string;
  employeeId: string;
  siteId: string;
  eventType: "clock_in" | "clock_out";
  occurredAt: ISODateTime;
  source: "terminal" | "biometric" | "manual" | "import" | "mobile";
  /** Reader or terminal identifier, when the source is a device. */
  deviceId: string | null;
  /** The user who entered it, when the source is manual. */
  recordedBy: string | null;
  /** Set once the event has been folded into a daily record. */
  attendanceRecordId: string | null;
  /** Repeat submissions from a flaky reader must not double-count. */
  idempotencyKey: string | null;
}

export type AttendanceStatus =
  /** Rostered, but the shift has not started yet. */
  | "expected"
  /** Clocked in within the grace period. */
  | "present"
  /** Clocked in after the grace period. */
  | "late"
  /** Clocked in but left early, or never clocked out. */
  | "partial"
  /** Rostered, shift over, nothing observed. */
  | "absent"
  /** Rostered but covered by approved leave — not the same as absent. */
  | "excused"
  /** Observed at work with no roster assignment. */
  | "unplanned";

/**
 * A supervisor's override of a derived status.
 *
 * Attendance itself is NOT stored: the daily view is a projection of the
 * roster, the clock events and the leave register. Materialising it would
 * create a third truth that silently drifts whenever any of those three
 * change — a roster edit, a late clock event, a retroactive leave approval.
 *
 * What cannot be derived is a human judgement ("the reader was broken, he was
 * here"), so that is the only thing written down, as a sparse overlay with
 * the actor and the reason attached.
 */
export interface AttendanceCorrection {
  id: string;
  organizationId: string;
  employeeId: string;
  siteId: string;
  date: ISODate;
  /** The status a supervisor asserts, overriding what was derived. */
  status: AttendanceStatus;
  /** What the system had derived, kept so the disagreement stays visible. */
  derivedStatus: AttendanceStatus;
  reason: string;
  correctedBy: string;
  correctedAt: ISODateTime;
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
