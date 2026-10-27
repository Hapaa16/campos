import {
  EMPLOYEE_PII_FIELDS,
  EMPLOYEE_PUBLIC_FIELDS,
  VISITOR_PII_FIELDS,
  type RoleDefinition,
} from "./types";

/* ===========================================================================
   Seeded roles.

   A role is a *named bundle of permission tuples stored as data*. There is no
   `if (role === 'hr.manager')` anywhere in this codebase, and adding a role
   must never require a code change — Settings → Roles edits these same tuples.

   Conditions use scope placeholders ($orgId, $self, $campIds, …) which are
   resolved per-request in ability.ts. Every organization-scoped rule has
   `organizationId: '$orgId'` injected automatically, so a role definition
   cannot accidentally leak across tenants.
   ========================================================================= */

const PII = [...EMPLOYEE_PII_FIELDS];
const PUBLIC_EMPLOYEE = [...EMPLOYEE_PUBLIC_FIELDS];

/** Planning subjects a roster planner must read to do their job. */
const ROSTER_CONTEXT = [
  "Employee",
  "OrgUnit",
  "OrgUnitType",
  "Position",
  "PositionAssignment",
  "Site",
  "Camp",
  "LeaveRequest",
] as const;

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  /* ---------------------------------------------------------------- platform */
  {
    id: "platform.superadmin",
    scope: "platform",
    system: true,
    name: { mn: "Системийн супер админ", en: "Platform Superadmin" },
    description: {
      mn: "Бүх байгууллага дээр бүрэн эрхтэй. Зөвхөн системийн зохион байгуулагчид.",
      en: "Full authority across every tenant. Platform operators only.",
    },
    permissions: [{ action: "manage", subject: "all" }],
  },

  /* ------------------------------------------------------------ organization */
  {
    id: "org.admin",
    scope: "organization",
    system: true,
    name: { mn: "Байгууллагын админ", en: "Organization Admin" },
    description: {
      mn: "Өөрийн байгууллагын хүрээнд бүрэн эрхтэй.",
      en: "Full authority within a single organization.",
    },
    permissions: [
      { action: "manage", subject: "all" },
      {
        // Integrity rule: history is append-only, even for an admin.
        action: ["update", "delete"],
        subject: "AuditLog",
        inverted: true,
        reason: "Аудитын бүртгэлийг өөрчлөх, устгах боломжгүй.",
      },
    ],
  },

  /* ----------------------------------------------------------------- people */
  {
    id: "hr.manager",
    scope: "organization",
    system: true,
    name: { mn: "Хүний нөөцийн менежер", en: "HR Manager" },
    description: {
      mn: "Ажилтны бүртгэл, хувийн мэдээлэл, томилгоо. Ээлжийн хуваарь баталгаажуулах эрхгүй.",
      en: "Workforce records, personal data and assignments. Cannot publish rosters.",
    },
    permissions: [
      { action: "manage", subject: ["Employee", "Position", "PositionAssignment"] },
      { action: ["read", "update"], subject: ["OrgUnit", "OrgUnitType"] },
      { action: "read", subject: ["Site", "Camp", "RosterPeriod", "RosterAssignment", "Report"] },
      { action: ["read", "approve"], subject: "LeaveRequest" },
      { action: "export", subject: ["Employee", "Report"] },
      { action: "read", subject: "AuditLog" },
      // Explicitly absent: publish/approve RosterPeriod.
    ],
  },
  {
    id: "org.designer",
    scope: "organization",
    system: true,
    name: { mn: "Бүтэц зохион байгуулагч", en: "Org Structure Designer" },
    description: {
      mn: "Байгууллагын бүтэц, нэгж, албан тушаал. Хувийн мэдээлэл харах эрхгүй.",
      en: "Organizational units and positions. No access to personal data.",
    },
    permissions: [
      { action: "manage", subject: ["OrgUnit", "OrgUnitType", "Position", "PositionAssignment"] },
      { action: "read", subject: "Site" },
      // Field-restricted read: structure work needs names and units, not PII.
      { action: "read", subject: "Employee", fields: PUBLIC_EMPLOYEE },
      { action: "read", subject: "AuditLog" },
    ],
  },

  /* ---------------------------------------------------------------- rosters */
  {
    id: "roster.planner",
    scope: "organization",
    system: true,
    name: { mn: "Ээлж төлөвлөгч", en: "Roster Planner" },
    description: {
      mn: "Ноорог ээлжийн хуваарь үүсгэх, засах. Баталгаажуулах эрхгүй.",
      en: "Creates and edits draft rosters. Publication requires an approver.",
    },
    permissions: [
      { action: "manage", subject: ["RosterPattern", "ShiftTemplate"] },
      { action: ["read", "create"], subject: ["RosterPeriod", "RosterAssignment"] },
      {
        // No silent overwriting of published roster history.
        action: ["update", "delete"],
        subject: ["RosterPeriod", "RosterAssignment"],
        conditions: { status: { $in: ["draft", "review"] } },
      },
      { action: "read", subject: [...ROSTER_CONTEXT], fields: undefined },
      { action: "read", subject: "Employee", fields: PUBLIC_EMPLOYEE },
      { action: "export", subject: ["RosterPeriod", "Report"] },
      // Explicitly absent: publish, approve.
    ],
  },
  {
    id: "roster.approver",
    scope: "organization",
    system: true,
    name: { mn: "Ээлж батлагч", en: "Roster Approver" },
    description: {
      mn: "Ээлжийн хуваарь болон чөлөөний хүсэлтийг батлах, нийтлэх.",
      en: "Approves and publishes rosters; approves leave requests.",
    },
    permissions: [
      { action: ["read", "approve", "publish"], subject: "RosterPeriod" },
      { action: "read", subject: ["RosterAssignment", "RosterPattern", "ShiftTemplate"] },
      { action: ["read", "approve"], subject: "LeaveRequest" },
      { action: "read", subject: "Employee", fields: PUBLIC_EMPLOYEE },
      { action: "read", subject: ["OrgUnit", "Site", "Camp", "Report", "AuditLog"] },
    ],
  },

  /* ------------------------------------------------------------------ camps */
  {
    id: "camp.manager",
    scope: "organization",
    system: true,
    name: { mn: "Кэмпийн менежер", en: "Camp Manager" },
    description: {
      mn: "Хариуцсан кэмпийн байр, өрөө, ор, захиалга, бүртгэл.",
      en: "Buildings, rooms, beds, bookings and check-in for assigned camps only.",
    },
    permissions: [
      { action: ["read", "update"], subject: "Camp", conditions: { id: { $in: "$campIds" } } },
      {
        action: "manage",
        subject: ["Building", "Room", "Bed", "AccommodationBooking", "ServiceRequest"],
        conditions: { campId: { $in: "$campIds" } },
      },
      {
        action: ["checkin", "checkout"],
        subject: "AccommodationBooking",
        conditions: { campId: { $in: "$campIds" } },
      },
      { action: "read", subject: ["Site", "MealForecast"] },
      { action: "read", subject: "Employee", fields: [...PUBLIC_EMPLOYEE, "personalPhone"] },
      { action: "read", subject: ["RosterAssignment", "RosterPeriod"] },
      { action: "export", subject: "Report" },
    ],
  },

  /* -------------------------------------------------------------- transport */
  {
    id: "transport.coordinator",
    scope: "organization",
    system: true,
    name: { mn: "Тээврийн зохицуулагч", en: "Transport Coordinator" },
    description: {
      mn: "Тээврийн хэрэгсэл, жолооч, маршрут, рейс, зорчигчийн захиалга.",
      en: "Vehicles, drivers, routes, trips, bookings and manifests.",
    },
    permissions: [
      {
        action: "manage",
        subject: [
          "Vehicle",
          "Driver",
          "TransportRoute",
          "TransportTrip",
          "TransportBooking",
          "TransportPassenger",
        ],
      },
      { action: "read", subject: ["BoardingRecord", "Site", "Camp", "RosterAssignment"] },
      { action: "read", subject: "Employee", fields: [...PUBLIC_EMPLOYEE, "personalPhone"] },
      { action: "read", subject: "Visitor", fields: ["id", "fullName", "companyName"] },
      { action: "export", subject: "Report" },
    ],
  },
  {
    id: "boarding.agent",
    scope: "organization",
    system: true,
    name: { mn: "Суултын бүртгэгч", en: "Boarding Agent" },
    description: {
      mn: "Зорчигчийн жагсаалт харах, суулт бүртгэх. Өөр засвар хийх эрхгүй.",
      en: "Reads manifests and records boarding events. Nothing else.",
    },
    permissions: [
      { action: "read", subject: ["TransportTrip", "TransportPassenger", "TransportBooking"] },
      { action: ["create", "read"], subject: "BoardingRecord" },
      { action: "read", subject: "Employee", fields: ["id", "employeeCode", "displayName", "avatarColor"] },
    ],
  },

  /* --------------------------------------------------------------- visitors */
  {
    id: "reception.officer",
    scope: "organization",
    system: true,
    name: { mn: "Хүлээн авагч", en: "Reception Officer" },
    description: {
      mn: "Зочны бүртгэл, ирэлт/явалт, энгэрийн тэмдэг — хариуцсан талбай дээр.",
      en: "Visitor check-in/out and badges, limited to assigned sites.",
    },
    permissions: [
      { action: ["read", "create", "update"], subject: "Visitor" },
      {
        action: ["read", "create", "update", "checkin", "checkout"],
        subject: "Visit",
        conditions: { siteId: { $in: "$siteIds" } },
      },
      { action: "manage", subject: "VisitorBadge", conditions: { siteId: { $in: "$siteIds" } } },
      { action: "read", subject: "Employee", fields: [...PUBLIC_EMPLOYEE, "workPhone"] },
      { action: "read", subject: ["Site", "Camp"] },
      // Explicitly absent: approve Visit. Reception validates, it does not authorize.
    ],
  },
  {
    id: "security.gate",
    scope: "organization",
    system: true,
    name: { mn: "Хамгаалалтын хаалга", en: "Security Gate" },
    description: {
      mn: "QR шалгах, нэвтрэх эрх харах, бүртгэл хөтлөх. Хувийн мэдээлэл харахгүй.",
      en: "Validates passes and logs movement. Sees no personal data.",
    },
    permissions: [
      {
        action: ["read", "checkin", "checkout"],
        subject: "Visit",
        conditions: { siteId: { $in: "$siteIds" } },
      },
      { action: "read", subject: "Visitor", fields: ["id", "fullName", "companyName", "photoUrl"] },
      {
        action: "read",
        subject: "Visitor",
        inverted: true,
        fields: [...VISITOR_PII_FIELDS],
        reason: "Хаалганы бүртгэлд зочны хувийн мэдээлэл шаардлагагүй.",
      },
      { action: "read", subject: "Employee", fields: ["id", "employeeCode", "displayName", "avatarColor", "status"] },
      { action: "read", subject: ["BoardingRecord", "Site"] },
    ],
  },

  /* ------------------------------------------------------------ line manager */
  {
    id: "supervisor",
    scope: "organization",
    system: true,
    name: { mn: "Ахлах / Шууд удирдлага", en: "Supervisor" },
    description: {
      mn: "Өөрийн баг нэгжийн ээлж, ирц, чөлөөний хүсэлт.",
      en: "Roster, attendance and leave for their own org unit subtree.",
    },
    permissions: [
      {
        action: "read",
        subject: "Employee",
        conditions: { orgUnitPath: { $regex: "$orgUnitPathPrefix" } },
        fields: [...PUBLIC_EMPLOYEE, "personalPhone", "emergencyContactName", "emergencyContactPhone"],
      },
      {
        action: "read",
        subject: ["RosterAssignment", "Attendance"],
        conditions: { orgUnitPath: { $regex: "$orgUnitPathPrefix" } },
      },
      {
        action: ["read", "approve"],
        subject: "LeaveRequest",
        conditions: { orgUnitPath: { $regex: "$orgUnitPathPrefix" } },
      },
      { action: "read", subject: ["RosterPeriod", "OrgUnit", "Site", "Camp", "ShiftTemplate"] },
    ],
  },

  /* --------------------------------------------------------- self-service */
  {
    id: "employee",
    scope: "organization",
    system: true,
    name: { mn: "Ажилтан (өөрийн булан)", en: "Employee Self-Service" },
    description: {
      mn: "Зөвхөн өөрийн ээлж, захиалга, чөлөөний хүсэлт.",
      en: "Own roster, own bookings, own leave requests. Nothing belonging to anyone else.",
    },
    permissions: [
      { action: "read", subject: "Employee", conditions: { id: "$self" } },
      {
        action: "read",
        subject: ["RosterAssignment", "Attendance", "AccommodationBooking", "TransportBooking"],
        conditions: { employeeId: "$self" },
      },
      {
        action: ["create", "read"],
        subject: "LeaveRequest",
        conditions: { employeeId: "$self" },
      },
      {
        action: ["update", "delete"],
        subject: "LeaveRequest",
        conditions: { employeeId: "$self", status: "pending" },
      },
      { action: "read", subject: ["ShiftTemplate", "Site", "Camp", "RosterPeriod"] },
    ],
  },

  /* ---------------------------------------------------------------- audit */
  {
    id: "auditor",
    scope: "organization",
    system: true,
    name: { mn: "Аудитор", en: "Auditor" },
    description: {
      mn: "Бүх зүйлийг харна, юуг ч өөрчлөхгүй. Хувийн мэдээлэл харахгүй.",
      en: "Reads everything, mutates nothing, and sees no personal data.",
    },
    permissions: [
      { action: ["read", "export"], subject: "all" },
      {
        action: "read",
        subject: "Employee",
        inverted: true,
        fields: PII,
        reason: "Аудитын эрхээр хувийн мэдээлэл харах боломжгүй.",
      },
      {
        action: "read",
        subject: "Visitor",
        inverted: true,
        fields: [...VISITOR_PII_FIELDS],
        reason: "Аудитын эрхээр зочны хувийн мэдээлэл харах боломжгүй.",
      },
    ],
  },
];

export const ROLE_BY_ID = new Map(ROLE_DEFINITIONS.map((r) => [r.id, r]));

export function getRole(id: string): RoleDefinition | undefined {
  return ROLE_BY_ID.get(id);
}

export const ROLE_IDS = ROLE_DEFINITIONS.map((r) => r.id);
