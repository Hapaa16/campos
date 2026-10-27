import "server-only";
import { db } from "@/server/db/store";
import { query, requireOne, type DataContext, type Page } from "@/server/db/query";
import { maskList, maskRecord, withheldFields } from "@/server/serialize/pii";
import { NotFoundError } from "@/lib/errors";
import type { Employee, EmploymentStatus, EmploymentType } from "@/server/db/schema";

/* ===========================================================================
   Workforce reads.

   Shared by the server components and the route handlers, so there is one
   implementation of "which employees may this actor see" rather than two that
   drift. Scoping is not written here — it comes from query(), which applies
   the tenant predicate and the row conditions before this code sees a row.
   ========================================================================= */

export type EmployeeSort =
  | "name"
  | "-name"
  | "code"
  | "-code"
  | "hired"
  | "-hired"
  | "unit"
  | "-unit";

export interface EmployeeListParams {
  search?: string;
  status?: EmploymentStatus[];
  employmentType?: EmploymentType[];
  siteIds?: string[];
  campId?: string;
  /** Materialised path: includes the unit and everything beneath it. */
  orgUnitPath?: string;
  /** Only people with a certification expiring within N days (or expired). */
  expiringWithinDays?: number;
  sort?: EmployeeSort;
  offset?: number;
  limit?: number;
}

export interface EmployeeListResult extends Page<Partial<Employee>> {
  /** Personal fields withheld from this actor, so the UI can say so honestly. */
  withheld: string[];
  facets: {
    status: Record<string, number>;
    employmentType: Record<string, number>;
    site: Record<string, number>;
  };
}

const collator = new Intl.Collator("mn", { sensitivity: "base", numeric: true });

export function listEmployees(ctx: DataContext, params: EmployeeListParams): EmployeeListResult {
  const data = db();
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);

  let q = query(ctx, "Employee", data.employees);

  if (params.search?.trim()) {
    const needle = params.search.trim().toLowerCase();
    q = q.where(
      (e) =>
        e.displayName.toLowerCase().includes(needle) ||
        e.firstName.toLowerCase().includes(needle) ||
        e.lastName.toLowerCase().includes(needle) ||
        e.employeeCode.toLowerCase().includes(needle) ||
        e.jobTitle.toLowerCase().includes(needle),
    );
  }

  if (params.status?.length) {
    const set = new Set(params.status);
    q = q.where((e) => set.has(e.status));
  }

  if (params.employmentType?.length) {
    const set = new Set(params.employmentType);
    q = q.where((e) => set.has(e.employmentType));
  }

  if (params.siteIds?.length) {
    const set = new Set(params.siteIds);
    q = q.where((e) => (e.siteId ? set.has(e.siteId) : false));
  }
  if (params.campId) q = q.where((e) => e.campId === params.campId);

  if (params.orgUnitPath) {
    const prefix = params.orgUnitPath;
    // Subtree, with the same boundary rule the authorization layer uses:
    // unit "1.4" must not swallow unit "1.40".
    q = q.where((e) => e.orgUnitPath === prefix || (e.orgUnitPath?.startsWith(`${prefix}.`) ?? false));
  }

  if (params.expiringWithinDays !== undefined) {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + params.expiringWithinDays);
    const cutoff = horizon.toISOString().slice(0, 10);
    q = q.where((e) => e.qualifications.some((qa) => qa.expiresAt !== null && qa.expiresAt <= cutoff));
  }

  const filtered = q.all();

  /* Facets are counted after filtering so the numbers describe the result set
     the user is actually looking at. */
  const facets = {
    status: countBy(filtered, (e) => e.status),
    employmentType: countBy(filtered, (e) => e.employmentType),
    site: countBy(filtered, (e) => e.siteId ?? "—"),
  };

  const sorted = sortEmployees(filtered, params.sort ?? "name");
  const items = maskList(ctx.ability, "Employee", sorted.slice(offset, offset + limit));

  return {
    items,
    total: sorted.length,
    offset,
    limit,
    withheld: sorted.length ? withheldFields(ctx.ability, "Employee", sorted[0]) : [],
    facets,
  };
}

function sortEmployees(rows: Employee[], sort: EmployeeSort): Employee[] {
  const [key, dir] = sort.startsWith("-") ? [sort.slice(1), -1] : [sort, 1];
  const compare: Record<string, (a: Employee, b: Employee) => number> = {
    name: (a, b) => collator.compare(a.displayName, b.displayName),
    code: (a, b) => collator.compare(a.employeeCode, b.employeeCode),
    hired: (a, b) => a.hiredAt.localeCompare(b.hiredAt),
    unit: (a, b) => collator.compare(a.orgUnitPath ?? "", b.orgUnitPath ?? ""),
  };
  const fn = compare[key] ?? compare.name;
  return [...rows].sort((a, b) => fn(a, b) * dir);
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export interface EmployeeDetail {
  employee: Partial<Employee>;
  withheld: string[];
  orgUnitName: string | null;
  siteName: string | null;
  campName: string | null;
  positionTitle: string | null;
  supervisorName: string | null;
  directReports: { id: string; displayName: string; jobTitle: string }[];
}

export function getEmployee(ctx: DataContext, id: string): EmployeeDetail {
  const data = db();
  const employee = requireOne(ctx, "Employee", data.employees, id);
  const masked = maskRecord(ctx.ability, "Employee", employee);
  if (!masked) throw new NotFoundError();

  const unit = employee.orgUnitId
    ? query(ctx, "OrgUnit", data.orgUnits).where((u) => u.id === employee.orgUnitId).first()
    : null;
  const site = employee.siteId
    ? query(ctx, "Site", data.sites).where((s) => s.id === employee.siteId).first()
    : null;
  const camp = employee.campId
    ? query(ctx, "Camp", data.camps).where((c) => c.id === employee.campId).first()
    : null;
  const position = employee.positionId
    ? query(ctx, "Position", data.positions).where((p) => p.id === employee.positionId).first()
    : null;
  const supervisor = employee.supervisorId
    ? query(ctx, "Employee", data.employees).where((e) => e.id === employee.supervisorId).first()
    : null;

  const directReports = query(ctx, "Employee", data.employees)
    .where((e) => e.supervisorId === employee.id)
    .sort((a, b) => collator.compare(a.displayName, b.displayName))
    .all()
    .slice(0, 50)
    .map((e) => ({ id: e.id, displayName: e.displayName, jobTitle: e.jobTitle }));

  return {
    employee: masked,
    withheld: withheldFields(ctx.ability, "Employee", employee),
    orgUnitName: unit?.name ?? null,
    siteName: site?.name ?? null,
    campName: camp?.name ?? null,
    positionTitle: position?.title ?? null,
    supervisorName: supervisor?.displayName ?? null,
    directReports,
  };
}

/** Lookup lists for the filter bar, scoped the same way everything else is. */
export function getWorkforceFilterOptions(ctx: DataContext) {
  const data = db();
  return {
    sites: query(ctx, "Site", data.sites)
      .where((s) => s.status === "active")
      .all()
      .map((s) => ({ id: s.id, name: s.name })),
    camps: query(ctx, "Camp", data.camps)
      .where((c) => c.status === "active")
      .all()
      .map((c) => ({ id: c.id, name: c.name })),
  };
}
