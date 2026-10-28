import "server-only";
import { canOn, type AppAbility } from "@/lib/authz/ability";
import type { Action, AuthContext, Subject } from "@/lib/authz/types";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { maskList, maskRecord } from "@/server/serialize/pii";

/* ===========================================================================
   Layer 3 — the data layer.

   Real enforcement. Every read goes through `query()`, which applies the
   tenant predicate *inside the builder* before the caller sees a row. A caller
   therefore cannot forget the organizationId filter — there is no code path
   that returns rows without it.

   Order matters and is fixed:
     1. tenant floor   (organizationId, unless platform admin)
     2. ability        (row-level conditions: camp, site, subtree, $self)
     3. caller filters (search, status, date range …)
     4. field masking  (layer 5, on the way out)
   ========================================================================= */

export interface DataContext {
  auth: AuthContext;
  ability: AppAbility;
}

export interface TenantRow {
  id: string;
  organizationId: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export class Query<T extends TenantRow> {
  constructor(
    private readonly ctx: DataContext,
    private readonly type: Subject,
    private rows: T[],
  ) {}

  where(predicate: (row: T) => boolean): Query<T> {
    return new Query(this.ctx, this.type, this.rows.filter(predicate));
  }

  sort(compare: (a: T, b: T) => number): Query<T> {
    return new Query(this.ctx, this.type, [...this.rows].sort(compare));
  }

  count(): number {
    return this.rows.length;
  }

  all(): T[] {
    return this.rows;
  }

  first(): T | null {
    return this.rows[0] ?? null;
  }

  /** Raw rows, already tenant- and ability-filtered but not field-masked. */
  rawPage(offset: number, limit: number): Page<T> {
    return {
      items: this.rows.slice(offset, offset + limit),
      total: this.rows.length,
      offset,
      limit,
    };
  }

  /** Field-masked page — what a route handler should return to a client. */
  page(offset: number, limit: number): Page<Partial<T>> {
    const raw = this.rawPage(offset, limit);
    return { ...raw, items: maskList(this.ctx.ability, this.type, raw.items) };
  }

  masked(): Partial<T>[] {
    return maskList(this.ctx.ability, this.type, this.rows);
  }
}

/**
 * Entry point for every read.
 *
 * `rows` is the whole table; the tenant and ability filters are applied here
 * and cannot be bypassed by the caller.
 */
export function query<T extends TenantRow>(
  ctx: DataContext,
  type: Subject,
  rows: readonly T[],
  /**
   * Optional narrowing predicate applied BEFORE the ability pass.
   *
   * Safe by construction: it can only remove rows, never add them, so the
   * tenant floor and the ability filter still see every row that survives.
   * It exists because evaluating CASL conditions across a 58,000-row table to
   * then keep 2,000 of them is wasted work — this is the index the real
   * database will do in SQL.
   */
  prefilter?: (row: T) => boolean,
): Query<T> {
  const candidates = prefilter ? rows.filter(prefilter) : rows;

  // 1 — tenant floor. The authoritative isolation boundary.
  const tenantScoped = ctx.auth.isPlatformAdmin
    ? [...candidates]
    : candidates.filter((r) => r.organizationId === ctx.auth.organizationId);

  // 2 — row-level ability (camp/site/subtree/$self conditions).
  const visible = tenantScoped.filter((r) => canOn(ctx.ability, "read", type, r));

  return new Query(ctx, type, visible);
}

/**
 * Fetch one row by id, or throw.
 *
 * Deliberately 404, never 403: answering "forbidden" for another tenant's id
 * confirms that the id exists, which is itself a cross-tenant leak. A foreign
 * id must be indistinguishable from a typo.
 */
export function requireOne<T extends TenantRow>(
  ctx: DataContext,
  type: Subject,
  rows: readonly T[],
  id: string,
): T {
  const row = query(ctx, type, rows).where((r) => r.id === id).first();
  if (!row) throw new NotFoundError();
  return row;
}

/** Same as requireOne but returns the field-masked projection. */
export function requireOneMasked<T extends TenantRow>(
  ctx: DataContext,
  type: Subject,
  rows: readonly T[],
  id: string,
): Partial<T> {
  const row = requireOne(ctx, type, rows, id);
  const masked = maskRecord(ctx.ability, type, row);
  if (!masked) throw new NotFoundError();
  return masked;
}

/**
 * Authorize a mutation against a concrete record.
 *
 * Always pass the record, never just the type: a type-level check cannot
 * evaluate row conditions, so `can('update','Bed')` would wave through a bed
 * in a camp the actor does not manage.
 */
export function authorizeOn<T extends object>(
  ctx: DataContext,
  action: Action,
  type: Subject,
  record: T,
): void {
  if (!canOn(ctx.ability, action, type, record)) {
    const rule = ctx.ability.relevantRuleFor(action, type as never);
    throw new ForbiddenError(
      rule?.reason ?? "Энэ үйлдлийг гүйцэтгэх эрх байхгүй.",
      { action, subject: type },
    );
  }
}

/**
 * Authorize creating a new record. The candidate must already carry its
 * organizationId and scope fields so row conditions can be evaluated — a
 * create check that skips them is how scoped roles end up able to write
 * anywhere.
 */
export function authorizeCreate<T extends { organizationId: string }>(
  ctx: DataContext,
  type: Subject,
  candidate: T,
): void {
  if (!ctx.auth.isPlatformAdmin && candidate.organizationId !== ctx.auth.organizationId) {
    throw new ForbiddenError("Өөр байгууллагад бичлэг үүсгэх боломжгүй.");
  }
  authorizeOn(ctx, "create", type, candidate);
}
