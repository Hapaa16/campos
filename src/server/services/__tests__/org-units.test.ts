import { beforeEach, describe, expect, it } from "vitest";
import { buildAbility } from "@/lib/authz/ability";
import type { AuthContext } from "@/lib/authz/types";
import type { DataContext } from "@/server/db/query";
import { ValidationError } from "@/lib/errors";
import { resetDb, db } from "@/server/db/store";
import { SEED_ORG_A, SEED_ORG_B } from "@/server/db/seed";
import {
  applyOrgUnitMove,
  getOrgTree,
  getOrgUnitDetail,
  previewOrgUnitMove,
} from "../org-units";

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

const designer = () => ctxFor(["org.designer"]);
const unitByCode = (code: string) => db().orgUnits.find((u) => u.code === code)!;

describe("org tree", () => {
  it("builds a configurable multi-level hierarchy, not a fixed ladder", () => {
    const tree = getOrgTree(designer());
    const depths = new Set(tree.nodes.map((n) => n.depth));
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(4);
    expect(tree.unitTypes.map((t) => t.code)).toEqual([
      "COMPANY",
      "DIVISION",
      "DEPARTMENT",
      "SECTION",
      "TEAM",
    ]);
  });

  it("rolls headcount up the subtree", () => {
    const tree = getOrgTree(designer());
    const root = tree.nodes.find((n) => n.id === tree.rootIds[0])!;
    const leafTotal = tree.nodes
      .filter((n) => n.childIds.length === 0)
      .reduce((sum, n) => sum + n.directHeadcount, 0);
    expect(root.totalHeadcount).toBe(leafTotal);
    expect(root.directHeadcount).toBe(0);
  });

  it("excludes terminated staff from headcount", () => {
    const tree = getOrgTree(designer());
    const total = tree.nodes.find((n) => n.id === tree.rootIds[0])!.totalHeadcount;
    const activeish = db().employees.filter(
      (e) => e.organizationId === SEED_ORG_A && e.status !== "terminated",
    ).length;
    expect(total).toBe(activeish);
  });

  it("shows only the other tenant's units to the other tenant", () => {
    const other = ctxFor(["org.admin"], { organizationId: SEED_ORG_B });
    const tree = getOrgTree(other);
    expect(tree.nodes.length).toBeGreaterThan(0);
    for (const node of tree.nodes) {
      expect(db().orgUnits.find((u) => u.id === node.id)!.organizationId).toBe(SEED_ORG_B);
    }
  });

  it("presents a unit whose parent is out of scope as a root, not an orphan", () => {
    const section = unitByCode("MIN-OP-HL");
    const sup = ctxFor(["supervisor"], { orgUnitPath: section.path });
    const tree = getOrgTree(sup);
    // A supervisor may read OrgUnit org-wide, so assert the invariant generally:
    // every node's parentId, when set, must resolve inside the returned set.
    const ids = new Set(tree.nodes.map((n) => n.id));
    for (const node of tree.nodes) {
      if (node.parentId !== null) expect(ids.has(node.parentId)).toBe(true);
    }
    expect(tree.rootIds.length).toBeGreaterThan(0);
  });
});

describe("move preview is a dry run", () => {
  it("reports the subtree whose paths would change, and mutates nothing", () => {
    const ctx = designer();
    const moving = unitByCode("MIN-OP-HL");
    const target = unitByCode("MIN-UG");
    const before = db().orgUnits.map((u) => `${u.id}:${u.path}`).join("|");

    const preview = previewOrgUnitMove(ctx, moving.id, target.id);

    expect(preview.valid).toBe(true);
    expect(preview.pathChanges.length).toBeGreaterThan(1); // the unit plus its teams
    expect(preview.pathChanges.some((c) => c.id === moving.id)).toBe(true);
    expect(preview.affectedEmployees).toBeGreaterThan(0);
    expect(preview.affectedAssignments).toBeGreaterThan(0);

    expect(db().orgUnits.map((u) => `${u.id}:${u.path}`).join("|")).toBe(before);
  });

  it("counts published roster rows for an actor who can see rosters", () => {
    // Published history is reported so the operator knows it exists — and it
    // is deliberately not rewritten by the apply step.
    const admin = ctxFor(["org.admin"]);
    const preview = previewOrgUnitMove(admin, unitByCode("MIN-OP-HL").id, unitByCode("MIN-UG").id);
    expect(preview.historicalRosterRows).toBeGreaterThan(0);
  });

  it("reports unknown, not zero, when the actor cannot read rosters", () => {
    // org.designer has no roster permission. Reporting 0 here would read as
    // "this restructure touches no history", which is the opposite of true.
    const preview = previewOrgUnitMove(designer(), unitByCode("MIN-OP-HL").id, unitByCode("MIN-UG").id);
    expect(preview.historicalRosterRows).toBeNull();
  });

  it("refuses a move into the unit's own descendant", () => {
    const preview = previewOrgUnitMove(designer(), unitByCode("MIN").id, unitByCode("MIN-OP-HL").id);
    expect(preview.valid).toBe(false);
    expect(preview.errorCode).toBe("cycle");
    expect(preview.pathChanges).toEqual([]);
  });

  it("refuses a unit becoming its own parent", () => {
    const unit = unitByCode("MIN-OP");
    expect(previewOrgUnitMove(designer(), unit.id, unit.id).errorCode).toBe("self_parent");
  });

  it("treats another tenant's unit as non-existent rather than as a conflict", () => {
    const foreignParent = db().orgUnits.find((u) => u.organizationId === SEED_ORG_B)!;
    const preview = previewOrgUnitMove(designer(), unitByCode("MIN-OP").id, foreignParent.id);
    expect(preview.valid).toBe(false);
    expect(preview.errorCode).toBe("missing_parent");
  });
});

describe("applying a move", () => {
  // Only this block mutates, so only this block pays for a reseed.
  beforeEach(() => resetDb());

  it("rewrites current paths and leaves published roster history alone", () => {
    const ctx = designer();
    const moving = unitByCode("MIN-OP-HL");
    const target = unitByCode("MIN-UG");
    const oldPath = moving.path;

    const publishedPeriodIds = new Set(
      db().rosterPeriods.filter((p) => p.status === "published").map((p) => p.id),
    );
    const historicalBefore = db()
      .rosterAssignments.filter(
        (a) =>
          publishedPeriodIds.has(a.rosterPeriodId) &&
          a.orgUnitPath !== null &&
          (a.orgUnitPath === oldPath || a.orgUnitPath.startsWith(`${oldPath}.`)),
      )
      .map((a) => a.orgUnitPath);
    expect(historicalBefore.length).toBeGreaterThan(0);

    const result = applyOrgUnitMove(ctx, moving.id, target.id);

    expect(result.pathChanges).toBeGreaterThan(0);
    expect(result.rewrittenEmployees).toBeGreaterThan(0);

    const moved = db().orgUnits.find((u) => u.id === moving.id)!;
    expect(moved.parentId).toBe(target.id);
    expect(moved.path).not.toBe(oldPath);
    expect(moved.path.startsWith(`${db().orgUnits.find((u) => u.id === target.id)!.path}.`)).toBe(
      true,
    );

    // Current state follows the structure…
    for (const e of db().employees) {
      if (e.orgUnitId === moving.id) expect(e.orgUnitPath).toBe(moved.path);
    }

    // …but what a published roster recorded stays as it was recorded.
    const historicalAfter = db()
      .rosterAssignments.filter(
        (a) =>
          publishedPeriodIds.has(a.rosterPeriodId) &&
          a.orgUnitPath !== null &&
          (a.orgUnitPath === oldPath || a.orgUnitPath.startsWith(`${oldPath}.`)),
      )
      .map((a) => a.orgUnitPath);
    expect(historicalAfter).toEqual(historicalBefore);
  });

  it("keeps closed position assignments pinned to where the person actually sat", () => {
    const ctx = designer();
    const moving = unitByCode("MIN-OP-HL");
    const assignment = db().positionAssignments.find(
      (a) => a.orgUnitPath === moving.path || a.orgUnitPath.startsWith(`${moving.path}.`),
    )!;
    assignment.effectiveTo = "2026-01-01";
    const frozen = assignment.orgUnitPath;

    applyOrgUnitMove(ctx, moving.id, unitByCode("MIN-UG").id);

    expect(assignment.orgUnitPath).toBe(frozen);
  });

  it("throws rather than corrupting the tree on an invalid move", () => {
    const ctx = designer();
    const before = db().orgUnits.map((u) => `${u.id}:${u.path}:${u.parentId}`).join("|");

    expect(() => applyOrgUnitMove(ctx, unitByCode("MIN").id, unitByCode("MIN-OP-HL").id)).toThrow(
      ValidationError,
    );

    expect(db().orgUnits.map((u) => `${u.id}:${u.path}:${u.parentId}`).join("|")).toBe(before);
  });

  it("refuses a restructure to a role without update rights", () => {
    const planner = ctxFor(["roster.planner"]);
    expect(() =>
      applyOrgUnitMove(planner, unitByCode("MIN-OP-HL").id, unitByCode("MIN-UG").id),
    ).toThrow();
  });

  it("promotes a unit to root", () => {
    const ctx = designer();
    const moving = unitByCode("MIN-OP");
    applyOrgUnitMove(ctx, moving.id, null);
    const moved = db().orgUnits.find((u) => u.id === moving.id)!;
    expect(moved.parentId).toBeNull();
    expect(moved.depth).toBe(0);
    expect(moved.path).not.toContain(".");
  });
});

describe("unit detail", () => {
  it("lists members and flags reports that sit outside the unit", () => {
    const detail = getOrgUnitDetail(designer(), unitByCode("MIN-OP-HL-A").id);
    expect(detail.members.length).toBeGreaterThan(0);
    for (const member of detail.members) {
      // A cross-unit report must name the other unit, not just the person.
      if (member.supervisorUnitId) expect(member.supervisorUnitName).toBeTruthy();
    }
  });
});
