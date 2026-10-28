import { describe, expect, it } from "vitest";
import { buildAbility, canOn, canType, readableFields } from "../ability";
import type { AuthContext } from "../types";
import { NAV_GROUPS } from "@/lib/nav";

function ctx(roleIds: string[], extra: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "u",
    organizationId: "org_a",
    employeeId: "e1",
    roleIds,
    siteIds: ["s1"],
    campIds: ["c1"],
    orgUnitPath: "1.4",
    isPlatformAdmin: false,
    permVersion: 1,
    ...extra,
  };
}

/**
 * The page guards use type-level checks, which is all a page-entry decision
 * can use. These assert the checks actually discriminate — a guard that says
 * yes to everyone is worse than no guard, because it looks like protection.
 */
describe("page-entry gates discriminate between roles", () => {
  it("denies the gate officer the roles screen and the roster planner", () => {
    const gate = buildAbility(ctx(["security.gate"]));
    expect(canType(gate, "read", "Role")).toBe(false);
    expect(canType(gate, "read", "RosterPeriod")).toBe(false);
    expect(canType(gate, "read", "Camp")).toBe(false);
    expect(canType(gate, "approve", "LeaveRequest")).toBe(false);
  });

  it("denies self-service everything but their own corner", () => {
    const me = buildAbility(ctx(["employee"]));
    expect(canType(me, "read", "OrgUnit")).toBe(false);
    expect(canType(me, "read", "Role")).toBe(false);
    expect(canType(me, "read", "AccommodationBooking")).toBe(true); // own only
    expect(canType(me, "approve", "LeaveRequest")).toBe(false);
  });

  it("denies the boarding agent the workforce and camp screens", () => {
    const agent = buildAbility(ctx(["boarding.agent"]));
    expect(canType(agent, "read", "Camp")).toBe(false);
    expect(canType(agent, "read", "OrgUnit")).toBe(false);
    expect(canType(agent, "read", "Role")).toBe(false);
  });

  it("denies the camp manager the org chart and the roles screen", () => {
    const camp = buildAbility(ctx(["camp.manager"]));
    expect(canType(camp, "read", "OrgUnit")).toBe(false);
    expect(canType(camp, "read", "Role")).toBe(false);
    expect(canType(camp, "read", "Camp")).toBe(true);
  });

  it("grants the admin everything the navigation offers", () => {
    const admin = buildAbility(ctx(["org.admin"]));
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(
          canType(admin, item.permission.action, item.permission.subject),
          `${item.key}`,
        ).toBe(true);
      }
    }
  });

  /**
   * Entries every role legitimately reaches, narrowed by scope and fields
   * rather than by whether the screen opens at all.
   *
   * - dashboard: the widget set inside it differs per role; the page itself
   *   is everyone's landing page.
   * - workforce: the gate officer needs a name to match against a face, and
   *   self-service needs their own record. Both get `read Employee`; what
   *   differs is which rows and which columns survive layers 3 and 5.
   */
  const UNIVERSAL_BY_DESIGN = new Set(["dashboard", "workforce"]);

  it("gives at least one role a denial for every other navigation entry", () => {
    // A nav entry no role is ever denied is an entry whose permission does
    // not discriminate — almost always a mis-specified gate.
    const roles = [
      "security.gate", "employee", "boarding.agent", "camp.manager",
      "roster.planner", "org.designer", "reception.officer",
    ];
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (UNIVERSAL_BY_DESIGN.has(item.key)) continue;
        const denials = roles.filter(
          (r) => !canType(buildAbility(ctx([r])), item.permission.action, item.permission.subject),
        );
        expect(denials.length, `${item.key} is granted to every role`).toBeGreaterThan(0);
      }
    }
  });

  it("narrows the universal entries by scope or fields instead", () => {
    // Being reachable by everyone is only acceptable because layers 3 and 5
    // cut the rows and columns down per role.
    const gate = buildAbility(ctx(["security.gate"]));
    const self = buildAbility(ctx(["employee"], { employeeId: "e1" }));
    const other = { id: "e2", organizationId: "org_a", orgUnitPath: "1.4" };

    // Self-service: row-scoped to one person.
    expect(canOn(self, "read", "Employee", { ...other, id: "e1" })).toBe(true);
    expect(canOn(self, "read", "Employee", other)).toBe(false);

    // Gate: every row, but almost no columns.
    const fields = readableFields(gate, "Employee", other, [
      "id", "displayName", "nationalId", "personalPhone", "medicalNotes",
    ]);
    expect(fields).toContain("displayName");
    expect(fields).not.toContain("nationalId");
    expect(fields).not.toContain("medicalNotes");
  });
});
