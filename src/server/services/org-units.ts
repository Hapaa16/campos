import "server-only";
import { db } from "@/server/db/store";
import { authorizeOn, query, requireOne, type DataContext } from "@/server/db/query";
import { recomputePaths, validateOrgUnitMove } from "@/server/db/invariants";
import { ValidationError } from "@/lib/errors";
import { canType } from "@/lib/authz/ability";
import type { OrgUnit } from "@/server/db/schema";

/* ===========================================================================
   Organizational structure.

   The hierarchy is configurable: unit types come from org_unit_types, so a
   customer can run Company → Division → Department → Section → Team, or three
   levels, or seven. Nothing here assumes a fixed ladder.
   ========================================================================= */

export interface OrgTreeNode {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  path: string;
  depth: number;
  status: OrgUnit["status"];
  unitTypeId: string;
  unitTypeName: string;
  unitTypeCode: string;
  /** People assigned to this unit directly. */
  directHeadcount: number;
  /** People in this unit and everything beneath it. */
  totalHeadcount: number;
  headcountTarget: number | null;
  childIds: string[];
}

export interface OrgTree {
  nodes: OrgTreeNode[];
  rootIds: string[];
  unitTypes: { id: string; code: string; name: string; sortOrder: number }[];
}

export function getOrgTree(ctx: DataContext): OrgTree {
  const data = db();
  const units = query(ctx, "OrgUnit", data.orgUnits)
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
    .all();

  const unitTypes = query(ctx, "OrgUnitType", data.orgUnitTypes)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .all();
  const typeById = new Map(unitTypes.map((t) => [t.id, t]));

  // Headcount is computed from employees this actor may see, so a supervisor's
  // chart shows their own numbers rather than the organization's.
  const employees = query(ctx, "Employee", data.employees)
    .where((e) => e.status !== "terminated")
    .all();

  const directCount = new Map<string, number>();
  for (const e of employees) {
    if (!e.orgUnitId) continue;
    directCount.set(e.orgUnitId, (directCount.get(e.orgUnitId) ?? 0) + 1);
  }

  const childIds = new Map<string, string[]>();
  for (const u of units) {
    if (!u.parentId) continue;
    const list = childIds.get(u.parentId) ?? [];
    list.push(u.id);
    childIds.set(u.parentId, list);
  }

  // Subtree totals: walk deepest-first so a parent can sum children already done.
  const totals = new Map<string, number>();
  for (const u of [...units].sort((a, b) => b.depth - a.depth)) {
    const own = directCount.get(u.id) ?? 0;
    const fromChildren = (childIds.get(u.id) ?? []).reduce(
      (sum, id) => sum + (totals.get(id) ?? 0),
      0,
    );
    totals.set(u.id, own + fromChildren);
  }

  const visibleIds = new Set(units.map((u) => u.id));

  return {
    nodes: units.map((u) => ({
      id: u.id,
      // A unit whose parent is outside this actor's scope reads as a root,
      // rather than as an orphan pointing at something they cannot see.
      parentId: u.parentId && visibleIds.has(u.parentId) ? u.parentId : null,
      code: u.code,
      name: u.name,
      path: u.path,
      depth: u.depth,
      status: u.status,
      unitTypeId: u.unitTypeId,
      unitTypeName: typeById.get(u.unitTypeId)?.name ?? "—",
      unitTypeCode: typeById.get(u.unitTypeId)?.code ?? "",
      directHeadcount: directCount.get(u.id) ?? 0,
      totalHeadcount: totals.get(u.id) ?? 0,
      headcountTarget: u.headcountTarget,
      childIds: childIds.get(u.id) ?? [],
    })),
    rootIds: units.filter((u) => !u.parentId || !visibleIds.has(u.parentId)).map((u) => u.id),
    unitTypes: unitTypes.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      sortOrder: t.sortOrder,
    })),
  };
}

/* ------------------------------------------------- unit detail ------------ */

export interface OrgUnitMember {
  id: string;
  displayName: string;
  jobTitle: string;
  avatarColor: string;
  supervisorId: string | null;
  supervisorName: string | null;
  /** Set when the supervisor sits in a different unit — a cross-unit report. */
  supervisorUnitId: string | null;
  supervisorUnitName: string | null;
}

export interface OrgUnitDetail {
  unit: OrgTreeNode;
  members: OrgUnitMember[];
  /** Units this unit's people report into, other than their own. */
  externalReportingUnitIds: string[];
}

export function getOrgUnitDetail(ctx: DataContext, unitId: string): OrgUnitDetail {
  const data = db();
  const tree = getOrgTree(ctx);
  const node = tree.nodes.find((n) => n.id === unitId);
  if (!node) throw new ValidationError("Нэгж олдсонгүй.");

  const byId = new Map(query(ctx, "Employee", data.employees).all().map((e) => [e.id, e]));
  const unitNames = new Map(tree.nodes.map((n) => [n.id, n.name]));

  const members = query(ctx, "Employee", data.employees)
    .where((e) => e.orgUnitId === unitId && e.status !== "terminated")
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "mn"))
    .all()
    .map((e) => {
      const supervisor = e.supervisorId ? byId.get(e.supervisorId) : undefined;
      const supervisorUnitId =
        supervisor && supervisor.orgUnitId !== unitId ? supervisor.orgUnitId : null;
      return {
        id: e.id,
        displayName: e.displayName,
        jobTitle: e.jobTitle,
        avatarColor: e.avatarColor,
        supervisorId: e.supervisorId,
        supervisorName: supervisor?.displayName ?? null,
        supervisorUnitId,
        supervisorUnitName: supervisorUnitId ? (unitNames.get(supervisorUnitId) ?? null) : null,
      };
    });

  return {
    unit: node,
    members,
    externalReportingUnitIds: [
      ...new Set(members.map((m) => m.supervisorUnitId).filter((id): id is string => Boolean(id))),
    ],
  };
}

/* ------------------------------------------------- restructuring ---------- */

export interface MovePreview {
  valid: boolean;
  error?: string;
  errorCode?: string;
  unitName: string;
  fromParentName: string | null;
  toParentName: string | null;
  /** Units whose materialised path changes — the unit plus its whole subtree. */
  pathChanges: { id: string; name: string; from: string; to: string }[];
  /** Assignment rows that carry a denormalised path and must be rewritten. */
  affectedAssignments: number;
  affectedEmployees: number;
  /**
   * Published roster rows referencing a changing path — historical, and
   * deliberately not rewritten.
   *
   * `null` when the actor cannot read rosters at all. A figure you are not
   * allowed to compute must not be rendered as 0: "no history will be
   * affected" and "you cannot see the history" are opposite conclusions.
   */
  historicalRosterRows: number | null;
}

/**
 * Dry-run a structural move.
 *
 * Nothing mutates. This exists so a restructure can be *seen* before it is
 * applied: who moves, how many assignments are rewritten, and how much
 * published roster history references the old paths.
 */
export function previewOrgUnitMove(
  ctx: DataContext,
  unitId: string,
  newParentId: string | null,
): MovePreview {
  const data = db();
  const unit = requireOne(ctx, "OrgUnit", data.orgUnits, unitId);
  const scopedUnits = query(ctx, "OrgUnit", data.orgUnits).all();
  const nameById = new Map(scopedUnits.map((u) => [u.id, u.name]));

  const base: Omit<MovePreview, "valid"> = {
    unitName: unit.name,
    fromParentName: unit.parentId ? (nameById.get(unit.parentId) ?? null) : null,
    toParentName: newParentId ? (nameById.get(newParentId) ?? null) : null,
    pathChanges: [],
    affectedAssignments: 0,
    affectedEmployees: 0,
    historicalRosterRows: null,
  };

  const verdict = validateOrgUnitMove(unitId, newParentId, scopedUnits);
  if (!verdict.ok) {
    return { ...base, valid: false, error: verdict.message, errorCode: verdict.code };
  }

  // Simulate on a copy. The real tables are untouched by a preview.
  const simulated = scopedUnits.map((u) => ({ ...u }));
  const target = simulated.find((u) => u.id === unitId)!;
  target.parentId = newParentId;

  const newPaths = recomputePaths(simulated);
  const pathChanges = scopedUnits
    .filter((u) => newPaths.get(u.id)?.path !== u.path)
    .map((u) => ({
      id: u.id,
      name: u.name,
      from: u.path,
      to: newPaths.get(u.id)?.path ?? u.path,
    }));

  const changedPaths = new Set(pathChanges.map((c) => c.from));
  const touchesChangedPath = (path: string | null) =>
    path !== null && [...changedPaths].some((p) => path === p || path.startsWith(`${p}.`));

  const affectedEmployees = query(ctx, "Employee", data.employees)
    .where((e) => touchesChangedPath(e.orgUnitPath))
    .count();

  const affectedAssignments = query(ctx, "PositionAssignment", data.positionAssignments)
    .where((a) => touchesChangedPath(a.orgUnitPath))
    .count();

  // Published roster rows keep their original path: they describe what was
  // true when the roster was published, and rewriting them would silently
  // falsify history.
  const canSeeRosters =
    canType(ctx.ability, "read", "RosterPeriod") &&
    canType(ctx.ability, "read", "RosterAssignment");

  let historicalRosterRows: number | null = null;
  if (canSeeRosters) {
    const publishedPeriodIds = new Set(
      query(ctx, "RosterPeriod", data.rosterPeriods)
        .where((p) => p.status === "published")
        .all()
        .map((p) => p.id),
    );
    historicalRosterRows = query(ctx, "RosterAssignment", data.rosterAssignments)
      .where((a) => publishedPeriodIds.has(a.rosterPeriodId) && touchesChangedPath(a.orgUnitPath))
      .count();
  }

  return {
    ...base,
    valid: true,
    pathChanges,
    affectedAssignments,
    affectedEmployees,
    historicalRosterRows,
  };
}

export interface MoveResult {
  movedUnitId: string;
  pathChanges: number;
  rewrittenAssignments: number;
  rewrittenEmployees: number;
}

/** Apply a validated move inside a single transaction-like block. */
export function applyOrgUnitMove(
  ctx: DataContext,
  unitId: string,
  newParentId: string | null,
): MoveResult {
  const data = db();
  const unit = requireOne(ctx, "OrgUnit", data.orgUnits, unitId);
  authorizeOn(ctx, "update", "OrgUnit", unit);
  if (newParentId) {
    authorizeOn(ctx, "update", "OrgUnit", requireOne(ctx, "OrgUnit", data.orgUnits, newParentId));
  }

  // Validate against the full tenant table, not the actor's visible subset: a
  // cycle through a unit they cannot see is still a cycle.
  const tenantUnits = data.orgUnits.filter((u) => u.organizationId === unit.organizationId);
  const verdict = validateOrgUnitMove(unitId, newParentId, tenantUnits);
  if (!verdict.ok) throw new ValidationError(verdict.message, { code: verdict.code });

  const previousPaths = new Map(tenantUnits.map((u) => [u.id, u.path]));
  unit.parentId = newParentId;

  const newPaths = recomputePaths(tenantUnits);
  let pathChanges = 0;
  for (const u of tenantUnits) {
    const next = newPaths.get(u.id);
    if (!next || (next.path === u.path && next.depth === u.depth)) continue;
    u.path = next.path;
    u.depth = next.depth;
    pathChanges++;
  }

  // Rewrite the denormalised paths that describe CURRENT state.
  const pathOf = new Map(tenantUnits.map((u) => [u.id, u.path]));
  let rewrittenEmployees = 0;
  for (const e of data.employees) {
    if (e.organizationId !== unit.organizationId || !e.orgUnitId) continue;
    const next = pathOf.get(e.orgUnitId);
    if (next && next !== e.orgUnitPath) {
      e.orgUnitPath = next;
      rewrittenEmployees++;
    }
  }

  let rewrittenAssignments = 0;
  for (const a of data.positionAssignments) {
    if (a.organizationId !== unit.organizationId) continue;
    const next = pathOf.get(a.orgUnitId);
    // Only open assignments follow the structure. A closed assignment records
    // where someone sat during a period that has ended.
    if (next && next !== a.orgUnitPath && a.effectiveTo === null) {
      a.orgUnitPath = next;
      rewrittenAssignments++;
    }
  }

  // Roster assignments are deliberately NOT rewritten — see previewOrgUnitMove.
  void previousPaths;

  return { movedUnitId: unitId, pathChanges, rewrittenAssignments, rewrittenEmployees };
}
