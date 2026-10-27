import { describe, expect, it } from "vitest";
import { buildAbility, canOn, canType, readableFields } from "../ability";
import { EMPLOYEE_PII_FIELDS, EMPLOYEE_PUBLIC_FIELDS, type AuthContext } from "../types";
import { ROLE_DEFINITIONS } from "../roles";

const ORG_A = "org_a";
const ORG_B = "org_b";

const ALL_EMPLOYEE_FIELDS = [...EMPLOYEE_PUBLIC_FIELDS, ...EMPLOYEE_PII_FIELDS];

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "u1",
    organizationId: ORG_A,
    employeeId: "e1",
    roleIds: [],
    siteIds: [],
    campIds: [],
    orgUnitPath: null,
    isPlatformAdmin: false,
    permVersion: 1,
    ...overrides,
  };
}

const employee = (o: Partial<Record<string, unknown>> = {}) => ({
  id: "e99",
  organizationId: ORG_A,
  orgUnitPath: "1.4.9",
  status: "active",
  ...o,
});

describe("tenant isolation", () => {
  it("denies every subject belonging to another organization", () => {
    const a = buildAbility(ctx({ roleIds: ["org.admin"] }));
    const foreign = { id: "x", organizationId: ORG_B };

    for (const s of ["Employee", "OrgUnit", "RosterPeriod", "Camp", "Bed", "Visit"] as const) {
      expect(canOn(a, "read", s, foreign), `${s} must be invisible cross-tenant`).toBe(false);
      expect(canOn(a, "update", s, foreign)).toBe(false);
      expect(canOn(a, "delete", s, foreign)).toBe(false);
    }
  });

  it("allows the same subjects inside the actor's own organization", () => {
    const a = buildAbility(ctx({ roleIds: ["org.admin"] }));
    expect(canOn(a, "read", "Employee", employee())).toBe(true);
    expect(canOn(a, "update", "Employee", employee())).toBe(true);
  });

  it("a platform-role id in a tampered session is inert without the platform flag", () => {
    const a = buildAbility(ctx({ roleIds: ["platform.superadmin"], isPlatformAdmin: false }));
    expect(canOn(a, "read", "Employee", { id: "x", organizationId: ORG_B })).toBe(false);
    expect(canType(a, "manage", "all")).toBe(false);
  });

  it("a genuine platform admin crosses tenants", () => {
    const a = buildAbility(
      ctx({ roleIds: ["platform.superadmin"], isPlatformAdmin: true, organizationId: null }),
    );
    expect(canOn(a, "read", "Employee", { id: "x", organizationId: ORG_B })).toBe(true);
  });

  it("an actor with no active organization can reach nothing", () => {
    const a = buildAbility(ctx({ roleIds: ["org.admin"], organizationId: null }));
    expect(canOn(a, "read", "Employee", employee())).toBe(false);
  });
});

describe("separation of roster planning from publication", () => {
  const planner = () => buildAbility(ctx({ roleIds: ["roster.planner"] }));
  const approver = () => buildAbility(ctx({ roleIds: ["roster.approver"] }));
  const draft = { id: "rp1", organizationId: ORG_A, status: "draft" };
  const published = { id: "rp2", organizationId: ORG_A, status: "published" };

  it("a planner may edit a draft but not publish it", () => {
    const a = planner();
    expect(canOn(a, "update", "RosterPeriod", draft)).toBe(true);
    expect(canOn(a, "publish", "RosterPeriod", draft)).toBe(false);
    expect(canOn(a, "approve", "RosterPeriod", draft)).toBe(false);
  });

  it("a planner cannot overwrite published roster history", () => {
    const a = planner();
    expect(canOn(a, "update", "RosterPeriod", published)).toBe(false);
    expect(canOn(a, "delete", "RosterPeriod", published)).toBe(false);
  });

  it("an approver may publish but not author assignments", () => {
    const a = approver();
    expect(canOn(a, "publish", "RosterPeriod", draft)).toBe(true);
    expect(canOn(a, "create", "RosterAssignment", { organizationId: ORG_A })).toBe(false);
  });

  it("an HR manager cannot publish rosters", () => {
    const a = buildAbility(ctx({ roleIds: ["hr.manager"] }));
    expect(canOn(a, "publish", "RosterPeriod", draft)).toBe(false);
  });
});

describe("field-level personal data", () => {
  it("HR sees personal data", () => {
    const a = buildAbility(ctx({ roleIds: ["hr.manager"] }));
    const fields = readableFields(a, "Employee", employee(), ALL_EMPLOYEE_FIELDS);
    expect(fields).toContain("nationalId");
    expect(fields).toContain("medicalNotes");
  });

  it("the structure designer sees names and units but no personal data", () => {
    const a = buildAbility(ctx({ roleIds: ["org.designer"] }));
    const fields = readableFields(a, "Employee", employee(), ALL_EMPLOYEE_FIELDS);
    expect(fields).toContain("displayName");
    expect(fields).toContain("orgUnitId");
    for (const pii of EMPLOYEE_PII_FIELDS) expect(fields).not.toContain(pii);
  });

  it("the auditor reads everything except personal data", () => {
    const a = buildAbility(ctx({ roleIds: ["auditor"] }));
    expect(canOn(a, "read", "AuditLog", { id: "l1", organizationId: ORG_A })).toBe(true);
    expect(canOn(a, "update", "Employee", employee())).toBe(false);
    const fields = readableFields(a, "Employee", employee(), ALL_EMPLOYEE_FIELDS);
    for (const pii of EMPLOYEE_PII_FIELDS) expect(fields).not.toContain(pii);
  });

  it("the gate sees a name and nothing identifying", () => {
    const a = buildAbility(ctx({ roleIds: ["security.gate"], siteIds: ["s1"] }));
    const fields = readableFields(a, "Visitor", { id: "v1", organizationId: ORG_A }, [
      "id",
      "fullName",
      "companyName",
      "photoUrl",
      "nationalId",
      "passportNo",
      "phone",
    ]);
    expect(fields).toContain("fullName");
    expect(fields).not.toContain("nationalId");
    expect(fields).not.toContain("passportNo");
    expect(fields).not.toContain("phone");
  });
});

describe("subtree scoping for supervisors", () => {
  const sup = () => buildAbility(ctx({ roleIds: ["supervisor"], orgUnitPath: "1.4" }));

  it("reaches its own subtree", () => {
    expect(canOn(sup(), "read", "Employee", employee({ orgUnitPath: "1.4" }))).toBe(true);
    expect(canOn(sup(), "read", "Employee", employee({ orgUnitPath: "1.4.9.2" }))).toBe(true);
  });

  it("stops at the path boundary — unit 1.40 is not inside unit 1.4", () => {
    expect(canOn(sup(), "read", "Employee", employee({ orgUnitPath: "1.40" }))).toBe(false);
    expect(canOn(sup(), "read", "Employee", employee({ orgUnitPath: "1.40.1" }))).toBe(false);
  });

  it("does not reach a sibling subtree", () => {
    expect(canOn(sup(), "read", "Employee", employee({ orgUnitPath: "1.5.1" }))).toBe(false);
  });

  it("approves leave only inside its subtree", () => {
    const a = sup();
    const inside = { id: "l1", organizationId: ORG_A, orgUnitPath: "1.4.2" };
    const outside = { id: "l2", organizationId: ORG_A, orgUnitPath: "2.1" };
    expect(canOn(a, "approve", "LeaveRequest", inside)).toBe(true);
    expect(canOn(a, "approve", "LeaveRequest", outside)).toBe(false);
  });

  it("a supervisor with no unit reaches nothing rather than everything", () => {
    const a = buildAbility(ctx({ roleIds: ["supervisor"], orgUnitPath: null }));
    expect(canOn(a, "read", "Employee", employee({ orgUnitPath: "1.4" }))).toBe(false);
  });
});

describe("camp scoping", () => {
  const mgr = () => buildAbility(ctx({ roleIds: ["camp.manager"], campIds: ["c1", "c2"] }));

  it("manages beds in assigned camps only", () => {
    expect(canOn(mgr(), "update", "Bed", { id: "b1", organizationId: ORG_A, campId: "c1" })).toBe(true);
    expect(canOn(mgr(), "update", "Bed", { id: "b2", organizationId: ORG_A, campId: "c9" })).toBe(false);
  });

  it("checks guests in at assigned camps only", () => {
    const a = mgr();
    const ok = { id: "bk1", organizationId: ORG_A, campId: "c2" };
    const no = { id: "bk2", organizationId: ORG_A, campId: "c7" };
    expect(canOn(a, "checkin", "AccommodationBooking", ok)).toBe(true);
    expect(canOn(a, "checkin", "AccommodationBooking", no)).toBe(false);
  });

  it("a camp manager with no camps assigned manages nothing", () => {
    const a = buildAbility(ctx({ roleIds: ["camp.manager"], campIds: [] }));
    expect(canOn(a, "update", "Bed", { id: "b1", organizationId: ORG_A, campId: "c1" })).toBe(false);
  });
});

describe("self-service", () => {
  const me = () => buildAbility(ctx({ roleIds: ["employee"], employeeId: "e1" }));

  it("reads own records and no one else's", () => {
    const a = me();
    expect(canOn(a, "read", "Employee", employee({ id: "e1" }))).toBe(true);
    expect(canOn(a, "read", "Employee", employee({ id: "e2" }))).toBe(false);
    expect(canOn(a, "read", "RosterAssignment", { organizationId: ORG_A, employeeId: "e1" })).toBe(true);
    expect(canOn(a, "read", "RosterAssignment", { organizationId: ORG_A, employeeId: "e2" })).toBe(false);
  });

  it("withdraws a pending leave request but not an approved one", () => {
    const a = me();
    const base = { organizationId: ORG_A, employeeId: "e1" };
    expect(canOn(a, "delete", "LeaveRequest", { ...base, status: "pending" })).toBe(true);
    expect(canOn(a, "delete", "LeaveRequest", { ...base, status: "approved" })).toBe(false);
  });

  it("a user with no linked employee record matches nothing via $self", () => {
    const a = buildAbility(ctx({ roleIds: ["employee"], employeeId: null }));
    // $self falls back to a sentinel that cannot match, rather than to
    // `undefined` — which Mongo-style matching would read as "any employee".
    expect(canOn(a, "read", "Employee", employee({ id: "e1" }))).toBe(false);
    expect(canOn(a, "read", "RosterAssignment", { organizationId: ORG_A, employeeId: "e1" })).toBe(false);
  });
});

describe("integrity rules that outrank the admin", () => {
  it("nobody rewrites the audit log", () => {
    const a = buildAbility(ctx({ roleIds: ["org.admin"] }));
    const log = { id: "l1", organizationId: ORG_A };
    expect(canOn(a, "read", "AuditLog", log)).toBe(true);
    expect(canOn(a, "update", "AuditLog", log)).toBe(false);
    expect(canOn(a, "delete", "AuditLog", log)).toBe(false);
  });

  it("the boarding agent records boarding and nothing more", () => {
    const a = buildAbility(ctx({ roleIds: ["boarding.agent"] }));
    expect(canOn(a, "create", "BoardingRecord", { organizationId: ORG_A })).toBe(true);
    expect(canOn(a, "update", "TransportTrip", { id: "t1", organizationId: ORG_A })).toBe(false);
    expect(canOn(a, "delete", "TransportBooking", { id: "b1", organizationId: ORG_A })).toBe(false);
  });

  it("reception checks visitors in but does not authorize the visit", () => {
    const a = buildAbility(ctx({ roleIds: ["reception.officer"], siteIds: ["s1"] }));
    const visit = { id: "v1", organizationId: ORG_A, siteId: "s1" };
    expect(canOn(a, "checkin", "Visit", visit)).toBe(true);
    expect(canOn(a, "approve", "Visit", visit)).toBe(false);
  });

  it("reception is confined to its assigned sites", () => {
    const a = buildAbility(ctx({ roleIds: ["reception.officer"], siteIds: ["s1"] }));
    expect(canOn(a, "checkin", "Visit", { id: "v2", organizationId: ORG_A, siteId: "s9" })).toBe(false);
  });
});

describe("role catalogue", () => {
  it("every seeded role builds without throwing", () => {
    for (const role of ROLE_DEFINITIONS) {
      expect(() =>
        buildAbility(
          ctx({
            roleIds: [role.id],
            isPlatformAdmin: role.scope === "platform",
            orgUnitPath: "1.4",
            siteIds: ["s1"],
            campIds: ["c1"],
          }),
        ),
      ).not.toThrow();
    }
  });

  it("no role other than the two admin roles can manage everything", () => {
    for (const role of ROLE_DEFINITIONS) {
      if (role.id === "platform.superadmin" || role.id === "org.admin") continue;
      const a = buildAbility(ctx({ roleIds: [role.id], campIds: ["c1"], siteIds: ["s1"] }));
      expect(canOn(a, "delete", "Organization", { id: ORG_A, organizationId: ORG_A }), role.id).toBe(false);
    }
  });
});

describe("rules survive the server → client handoff", () => {
  it("packs to JSON without losing a condition", async () => {
    const { packRules, unpackRules } = await import("@casl/ability/extra");
    const { createMongoAbility } = await import("@casl/ability");
    const { withSubject } = await import("../ability");

    const server = buildAbility(ctx({ roleIds: ["supervisor"], orgUnitPath: "1.4" }));

    // Exactly what crosses the wire: pack, serialise, parse, rebuild.
    const wire = JSON.parse(JSON.stringify(packRules(server.rules)));
    const client = createMongoAbility(unpackRules(wire) as never, {
      detectSubjectType: (o) => (o as { __caslSubjectType__?: string }).__caslSubjectType__ as never,
    });

    const inside = withSubject("Employee", { id: "e1", organizationId: ORG_A, orgUnitPath: "1.4.9" });
    const outside = withSubject("Employee", { id: "e2", organizationId: ORG_A, orgUnitPath: "1.40" });
    const sibling = withSubject("Employee", { id: "e3", organizationId: ORG_A, orgUnitPath: "2.1" });

    // A RegExp object would serialise to `{}` here and quietly change the answer.
    expect(client.can("read", inside as never)).toBe(true);
    expect(client.can("read", outside as never)).toBe(false);
    expect(client.can("read", sibling as never)).toBe(false);
  });

  it("agrees with the server ability on every seeded role", async () => {
    const { packRules, unpackRules } = await import("@casl/ability/extra");
    const { createMongoAbility } = await import("@casl/ability");
    const { withSubject } = await import("../ability");

    const probes = [
      ["read", "Employee", { id: "e1", organizationId: ORG_A, orgUnitPath: "1.4.9" }],
      ["update", "Bed", { id: "b1", organizationId: ORG_A, campId: "c1" }],
      ["publish", "RosterPeriod", { id: "r1", organizationId: ORG_A, status: "draft" }],
      ["checkin", "Visit", { id: "v1", organizationId: ORG_A, siteId: "s1" }],
    ] as const;

    for (const role of ROLE_DEFINITIONS) {
      const auth = ctx({
        roleIds: [role.id],
        isPlatformAdmin: role.scope === "platform",
        orgUnitPath: "1.4",
        siteIds: ["s1"],
        campIds: ["c1"],
        employeeId: "e1",
      });
      const server = buildAbility(auth);
      const wire = JSON.parse(JSON.stringify(packRules(server.rules)));
      const client = createMongoAbility(unpackRules(wire) as never, {
        detectSubjectType: (o) => (o as { __caslSubjectType__?: string }).__caslSubjectType__ as never,
      });

      for (const [action, type, record] of probes) {
        expect(
          client.can(action, withSubject(type, record) as never),
          `${role.id}: ${action} ${type}`,
        ).toBe(server.can(action, withSubject(type, record) as never));
      }
    }
  });
});
