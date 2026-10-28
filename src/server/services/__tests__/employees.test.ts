import { describe, expect, it } from "vitest";
import { buildAbility } from "@/lib/authz/ability";
import type { AuthContext } from "@/lib/authz/types";
import { EMPLOYEE_PII_FIELDS } from "@/lib/authz/types";
import type { DataContext } from "@/server/db/query";
import { getEmployee, listEmployees } from "../employees";
import { db } from "@/server/db/store";
import { SEED_ORG_A, SEED_ORG_B } from "@/server/db/seed";
import { NotFoundError } from "@/lib/errors";

function ctxFor(roleIds: string[], extra: Partial<AuthContext> = {}): DataContext {
  const auth: AuthContext = {
    userId: "u",
    organizationId: SEED_ORG_A,
    employeeId: null,
    roleIds,
    siteIds: [],
    campIds: [],
    orgUnitPath: null,
    isPlatformAdmin: false,
    permVersion: 1,
    ...extra,
  };
  return { auth, ability: buildAbility(auth) };
}

describe("employee list payloads", () => {
  it("never serialises a personal field the actor may not read", () => {
    const designer = ctxFor(["org.designer"]);
    const result = listEmployees(designer, { limit: 500 });
    const wire = JSON.stringify(result.items);

    // The point of layer 5: the field is absent from the payload, not merely
    // hidden by the component. Nothing in devtools can recover it.
    for (const field of EMPLOYEE_PII_FIELDS) {
      expect(wire, `"${field}" must not reach the client`).not.toContain(field);
    }
    expect(result.items.length).toBeGreaterThan(100);
    expect(wire).toContain("displayName");
  });

  it("does serialise personal fields for HR", () => {
    const hr = ctxFor(["hr.manager"]);
    const wire = JSON.stringify(listEmployees(hr, { limit: 10 }).items);
    expect(wire).toContain("nationalId");
    expect(wire).toContain("emergencyContactPhone");
  });

  it("reports which fields were withheld, so the UI can say so", () => {
    expect(listEmployees(ctxFor(["org.designer"]), { limit: 1 }).withheld).toEqual(
      expect.arrayContaining([...EMPLOYEE_PII_FIELDS]),
    );
    expect(listEmployees(ctxFor(["hr.manager"]), { limit: 1 }).withheld).toEqual([]);
  });

  it("gives a camp manager a phone number but not a national ID", () => {
    const camp = ctxFor(["camp.manager"], { campIds: ["camp_ot_main"] });
    const wire = JSON.stringify(listEmployees(camp, { limit: 50 }).items);
    expect(wire).toContain("personalPhone");
    expect(wire).not.toContain("nationalId");
    expect(wire).not.toContain("medicalNotes");
  });
});

describe("employee list scoping and filters", () => {
  it("search matches name, code and job title", () => {
    const hr = ctxFor(["hr.manager"]);
    const all = listEmployees(hr, { limit: 1 }).total;
    const narrowed = listEmployees(hr, { search: "механикч", limit: 1 }).total;
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(all);
  });

  it("the subtree filter respects the path boundary", () => {
    const hr = ctxFor(["hr.manager"]);
    const unit = db().orgUnits.find((u) => u.code === "MIN-OP-HL")!;
    const rows = listEmployees(hr, { orgUnitPath: unit.path, limit: 500 }).items;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.orgUnitPath === unit.path || row.orgUnitPath!.startsWith(`${unit.path}.`)).toBe(
        true,
      );
    }
  });

  it("facet counts describe the filtered set, not the whole table", () => {
    const hr = ctxFor(["hr.manager"]);
    const unfiltered = listEmployees(hr, { limit: 1 });
    const filtered = listEmployees(hr, { status: ["active"], limit: 1 });
    expect(filtered.facets.status.on_leave ?? 0).toBe(0);
    expect(unfiltered.facets.status.on_leave ?? 0).toBeGreaterThan(0);
  });

  it("paging is stable and covers the set exactly once", () => {
    const hr = ctxFor(["hr.manager"]);
    const first = listEmployees(hr, { offset: 0, limit: 50 }).items.map((e) => e.id);
    const second = listEmployees(hr, { offset: 50, limit: 50 }).items.map((e) => e.id);
    expect(new Set([...first, ...second]).size).toBe(100);
  });

  it("the site filter accepts a multi-select", () => {
    const hr = ctxFor(["hr.manager"]);
    const one = listEmployees(hr, { siteIds: ["site_ot_mine"], limit: 1 }).total;
    const two = listEmployees(hr, { siteIds: ["site_ot_mine", "site_ot_ub"], limit: 1 }).total;
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
  });

  it("self-service sees exactly one row", () => {
    const target = db().employees.find((e) => e.organizationId === SEED_ORG_A)!;
    const me = ctxFor(["employee"], { employeeId: target.id });
    expect(listEmployees(me, { limit: 50 }).total).toBe(1);
  });
});

describe("employee detail", () => {
  it("404s on another tenant's employee rather than revealing it exists", () => {
    const hr = ctxFor(["hr.manager"]);
    const foreign = db().employees.find((e) => e.organizationId === SEED_ORG_B)!;
    expect(() => getEmployee(hr, foreign.id)).toThrow(NotFoundError);
  });

  it("404s on an employee outside a supervisor's subtree", () => {
    const unit = db().orgUnits.find((u) => u.code === "MIN-OP-HL")!;
    const sup = ctxFor(["supervisor"], { orgUnitPath: unit.path });
    const outside = db().employees.find(
      (e) =>
        e.organizationId === SEED_ORG_A &&
        e.orgUnitPath !== null &&
        !e.orgUnitPath.startsWith(unit.path),
    )!;
    expect(() => getEmployee(sup, outside.id)).toThrow(NotFoundError);
  });

  it("masks the detail payload too, not just the list", () => {
    const designer = ctxFor(["org.designer"]);
    const target = db().employees.find((e) => e.organizationId === SEED_ORG_A)!;
    const detail = getEmployee(designer, target.id);
    const wire = JSON.stringify(detail.employee);
    for (const field of EMPLOYEE_PII_FIELDS) expect(wire).not.toContain(field);
    expect(detail.orgUnitName).toBeTruthy();
  });
});

describe("dashboard reports unknown rather than zero", () => {
  it("omits roster coverage when the actor cannot read org units", async () => {
    const { getDashboard } = await import("../dashboard");
    // A camp manager can read rosters but not org units, so the establishment
    // behind "assigned / required" is not visible to them.
    const camp = ctxFor(["camp.manager"], { campIds: ["camp_ot_main"] });
    expect(getDashboard(camp).rosterCoverage).toBeNull();
  });

  it("computes coverage for a role that can see both", async () => {
    const { getDashboard } = await import("../dashboard");
    const coverage = getDashboard(ctxFor(["org.admin"])).rosterCoverage;
    expect(coverage).not.toBeNull();
    expect(coverage!.required).toBeGreaterThan(0);
  });

  it("omits bed figures entirely for a role with no bed permission", async () => {
    const { getDashboard } = await import("../dashboard");
    const hr = getDashboard(ctxFor(["hr.manager"]));
    expect(hr.freeBeds).toBeNull();
    expect(hr.inCamp).toBeNull();
    // And no half-populated camp table, which reads as "the camps are empty".
    expect(hr.occupancyByCamp).toEqual([]);
  });

  it("gives a camp manager bed figures for their camps only", async () => {
    const { getDashboard } = await import("../dashboard");
    const camp = getDashboard(ctxFor(["camp.manager"], { campIds: ["camp_ot_main"] }));
    expect(camp.freeBeds).not.toBeNull();
    expect(camp.occupancyByCamp.map((c) => c.campId)).toEqual(["camp_ot_main"]);
  });
});
