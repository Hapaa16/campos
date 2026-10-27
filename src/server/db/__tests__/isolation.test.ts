import { describe, expect, it } from "vitest";
import { buildAbility } from "@/lib/authz/ability";
import { NotFoundError } from "@/lib/errors";
import { buildSeed, SEED_ORG_A, SEED_ORG_B } from "../seed";
import { authorizeCreate, query, requireOne, type DataContext } from "../query";
import type { AuthContext } from "@/lib/authz/types";
import "../fields";

const database = buildSeed();

function ctxFor(partial: Partial<AuthContext>): DataContext {
  const auth: AuthContext = {
    userId: "u",
    organizationId: SEED_ORG_A,
    employeeId: null,
    roleIds: ["org.admin"],
    siteIds: [],
    campIds: [],
    orgUnitPath: null,
    isPlatformAdmin: false,
    permVersion: 1,
    ...partial,
  };
  return { auth, ability: buildAbility(auth) };
}

/** Every tenant-scoped table, with the subject name the query layer uses. */
const TABLES = [
  ["Employee", database.employees],
  ["OrgUnit", database.orgUnits],
  ["OrgUnitType", database.orgUnitTypes],
  ["Position", database.positions],
  ["PositionAssignment", database.positionAssignments],
  ["Site", database.sites],
  ["ShiftTemplate", database.shiftTemplates],
  ["RosterPattern", database.rosterPatterns],
  ["RosterPeriod", database.rosterPeriods],
  ["RosterAssignment", database.rosterAssignments],
  ["LeaveRequest", database.leaveRequests],
  ["Camp", database.camps],
  ["Building", database.buildings],
  ["Room", database.rooms],
  ["Bed", database.beds],
  ["AccommodationBooking", database.accommodationBookings],
] as const;

describe("seed integrity", () => {
  it("produces a populated two-tenant dataset", () => {
    expect(database.organizations).toHaveLength(2);
    expect(database.employees.filter((e) => e.organizationId === SEED_ORG_A).length).toBeGreaterThan(1000);
    expect(database.employees.filter((e) => e.organizationId === SEED_ORG_B).length).toBeGreaterThan(0);
    expect(database.beds.length).toBeGreaterThan(500);
    expect(database.rosterAssignments.length).toBeGreaterThan(10_000);
  });

  it("is deterministic across rebuilds", () => {
    const again = buildSeed();
    expect(again.employees.length).toBe(database.employees.length);
    expect(again.employees[0].displayName).toBe(database.employees[0].displayName);
    expect(again.beds.length).toBe(database.beds.length);
  });

  it("gives every employee their own rotation anchor rather than a shared one", () => {
    const anchors = new Set(
      database.employees.filter((e) => e.rotationAnchorDate).map((e) => e.rotationAnchorDate),
    );
    expect(anchors.size).toBeGreaterThan(20);
  });

  it("never seeds two occupying bookings on one bed at the same time", () => {
    const byBed = new Map<string, { startAt: string; endAt: string }[]>();
    for (const b of database.accommodationBookings) {
      if (b.status !== "reserved" && b.status !== "checked_in") continue;
      const list = byBed.get(b.bedId) ?? [];
      for (const other of list) {
        expect(
          b.startAt < other.endAt && other.startAt < b.endAt,
          `bed ${b.bedId} double-booked`,
        ).toBe(false);
      }
      list.push(b);
      byBed.set(b.bedId, list);
    }
  });

  it("never seeds a booking onto an unavailable bed", () => {
    const bedStatus = new Map(database.beds.map((b) => [b.id, b.status]));
    for (const booking of database.accommodationBookings) {
      expect(bedStatus.get(booking.bedId)).toBe("available");
    }
  });

  it("keeps planned bookings distinct from actual check-ins", () => {
    const reserved = database.accommodationBookings.filter((b) => b.status === "reserved");
    expect(reserved.length).toBeGreaterThan(0);
    for (const b of reserved) expect(b.checkedInAt).toBeNull();
  });

  it("builds a hierarchy with no cycles and consistent paths", () => {
    const byId = new Map(database.orgUnits.map((u) => [u.id, u]));
    for (const unit of database.orgUnits) {
      const seen = new Set<string>();
      let cursor = unit;
      while (cursor.parentId) {
        expect(seen.has(cursor.id)).toBe(false);
        seen.add(cursor.id);
        const parent = byId.get(cursor.parentId)!;
        expect(parent.organizationId).toBe(cursor.organizationId);
        expect(cursor.path.startsWith(`${parent.path}.`)).toBe(true);
        cursor = parent;
      }
    }
  });
});

describe("cross-tenant sweep — org A session against org B data", () => {
  const a = ctxFor({ organizationId: SEED_ORG_A });

  it.each(TABLES)("%s: every row returned belongs to org A", (subject, rows) => {
    const visible = query(a, subject, rows as never).all();
    expect(visible.length).toBeGreaterThan(0);
    for (const row of visible) expect(row.organizationId).toBe(SEED_ORG_A);
  });

  it.each(TABLES)("%s: requireOne on an org B id raises 404, not 403", (subject, rows) => {
    const foreign = (rows as readonly { id: string; organizationId: string }[]).find(
      (r) => r.organizationId === SEED_ORG_B,
    );
    if (!foreign) return; // table has no org B rows seeded
    expect(() => requireOne(a, subject, rows as never, foreign.id)).toThrow(NotFoundError);
  });

  it("an org B admin sees org B rows and none of org A's", () => {
    const b = ctxFor({ organizationId: SEED_ORG_B });
    const employees = query(b, "Employee", database.employees).all();
    expect(employees.length).toBeGreaterThan(0);
    for (const e of employees) expect(e.organizationId).toBe(SEED_ORG_B);
  });

  it("a platform admin crosses both tenants", () => {
    const p = ctxFor({ isPlatformAdmin: true, roleIds: ["platform.superadmin"], organizationId: SEED_ORG_A });
    const orgs = new Set(query(p, "Employee", database.employees).all().map((e) => e.organizationId));
    expect(orgs).toEqual(new Set([SEED_ORG_A, SEED_ORG_B]));
  });

  it("refuses to create a record in another tenant", () => {
    expect(() =>
      authorizeCreate(a, "Employee", { id: "new", organizationId: SEED_ORG_B } as never),
    ).toThrow();
  });
});

describe("scoped roles see only their slice", () => {
  it("a camp manager sees beds only in assigned camps", () => {
    const camp = ctxFor({ roleIds: ["camp.manager"], campIds: ["camp_ot_main"] });
    const beds = query(camp, "Bed", database.beds).all();
    expect(beds.length).toBeGreaterThan(0);
    for (const b of beds) expect(b.campId).toBe("camp_ot_main");
  });

  it("a supervisor sees only their own org unit subtree", () => {
    const section = database.orgUnits.find((u) => u.code === "MIN-OP-HL")!;
    const sup = ctxFor({ roleIds: ["supervisor"], orgUnitPath: section.path });
    const people = query(sup, "Employee", database.employees).all();
    expect(people.length).toBeGreaterThan(0);
    for (const e of people) {
      expect(e.orgUnitPath === section.path || e.orgUnitPath!.startsWith(`${section.path}.`)).toBe(true);
    }
    // And is strictly smaller than the whole org.
    expect(people.length).toBeLessThan(database.employees.filter((e) => e.organizationId === SEED_ORG_A).length);
  });

  it("self-service sees exactly one employee — their own", () => {
    const target = database.employees.find((e) => e.organizationId === SEED_ORG_A)!;
    const me = ctxFor({ roleIds: ["employee"], employeeId: target.id });
    const people = query(me, "Employee", database.employees).all();
    expect(people.map((p) => p.id)).toEqual([target.id]);
  });
});

describe("field masking on the way out", () => {
  it("strips personal data for a structure designer but not for HR", () => {
    const designer = ctxFor({ roleIds: ["org.designer"] });
    const hr = ctxFor({ roleIds: ["hr.manager"] });

    const asDesigner = query(designer, "Employee", database.employees).masked()[0]!;
    const asHr = query(hr, "Employee", database.employees).masked()[0]!;

    expect(asDesigner).not.toHaveProperty("nationalId");
    expect(asDesigner).not.toHaveProperty("medicalNotes");
    expect(asDesigner).toHaveProperty("displayName");

    expect(asHr).toHaveProperty("nationalId");
    expect(asHr).toHaveProperty("medicalNotes");
  });

  it("masked payloads carry no personal field anywhere in the page", () => {
    const auditor = ctxFor({ roleIds: ["auditor"] });
    const page = query(auditor, "Employee", database.employees).page(0, 50);
    const serialized = JSON.stringify(page.items);
    expect(serialized).not.toContain("nationalId");
    expect(serialized).not.toContain("bankAccount");
    expect(page.items.length).toBe(50);
  });
});
