import {
  AbilityBuilder,
  createMongoAbility,
  subject as asSubject,
  type MongoAbility,
  type MongoQuery,
} from "@casl/ability";
import { permittedFieldsOf } from "@casl/ability/extra";
import { ROLE_BY_ID } from "./roles";
import type { Action, AuthContext, PermissionTuple, Subject } from "./types";

export type AppAbility = MongoAbility<[Action, Subject | Record<string, unknown>], MongoQuery>;

/**
 * Attach a subject type to a record so CASL can match rules against it.
 *
 * The clone is load-bearing: CASL's `subject()` *mutates* its argument, writing
 * a permanent `__caslSubjectType__` brand. Passing a store record straight in
 * would brand the stored object, and the second check against a different
 * subject type would throw "previously it was casted to …".
 */
export function withSubject<T extends object>(type: Subject, record: T) {
  return asSubject(type as string, { ...(record as Record<string, unknown>) }) as unknown as T;
}

/* ---------------------------------------------------------------------------
   Scope placeholder resolution.

   Role permissions are stored as data, so scopes are written as placeholder
   strings ($self, $campIds, …) and bound to the actor at build time. A role
   row in the database therefore never contains another tenant's identifiers.
   --------------------------------------------------------------------------- */

function resolvePlaceholder(value: unknown, ctx: AuthContext): unknown {
  switch (value) {
    case "$orgId":
      return ctx.organizationId;
    case "$userId":
      return ctx.userId;
    case "$self":
      // No linked employee ⇒ an id that cannot match anything, rather than
      // `undefined`, which Mongo-style matching would treat as "any".
      return ctx.employeeId ?? "__no_employee__";
    case "$siteIds":
      return ctx.siteIds;
    case "$campIds":
      return ctx.campIds;
    case "$orgUnitPathPrefix":
      // A STRING pattern, not a RegExp object. Rules are packed to JSON and
      // handed to the client for UI gating, and `JSON.stringify(/re/)` yields
      // `{}` — which would silently turn this rule into something that matches
      // the wrong rows. CASL compiles a string pattern identically.
      //
      // The (\.|$) boundary is also load-bearing: a plain `^1.4` prefix would
      // match unit "1.40" too, silently widening the supervisor's scope.
      return ctx.orgUnitPath
        ? `^${escapeRegExp(ctx.orgUnitPath)}(\\.|$)`
        : "$^"; // matches nothing
    default:
      return value;
  }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hydrate(node: unknown, ctx: AuthContext): unknown {
  if (typeof node === "string") return resolvePlaceholder(node, ctx);
  if (Array.isArray(node)) return node.map((n) => hydrate(n, ctx));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = hydrate(v, ctx);
    }
    return out;
  }
  return node;
}

/* ---------------------------------------------------------------------------
   Ability construction
   --------------------------------------------------------------------------- */

export function buildAbility(ctx: AuthContext): AppAbility {
  const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
  const { can, cannot, build } = builder;

  for (const roleId of ctx.roleIds) {
    const role = ROLE_BY_ID.get(roleId);
    if (!role) continue;

    // A platform role on a user who is not a platform admin is inert. This
    // stops a tampered session from claiming superadmin by listing the id.
    if (role.scope === "platform" && !ctx.isPlatformAdmin) continue;

    for (const tuple of role.permissions) {
      applyTuple(can, cannot, tuple, ctx, role.scope === "platform");
    }
  }

  // ---- Tenant floor ------------------------------------------------------
  // Belt-and-braces only. The authoritative tenant filter lives in the query
  // builder (src/server/db/query.ts), because a conditional `cannot` cannot be
  // evaluated on a type-only check such as can('read', 'Employee').
  if (!ctx.isPlatformAdmin) {
    cannot("manage", "all", { organizationId: { $ne: ctx.organizationId } }).because(
      "Өөр байгууллагын өгөгдөлд хандах боломжгүй.",
    );
  }

  return build({
    detectSubjectType: (obj) =>
      (obj as { __caslSubjectType__?: string }).__caslSubjectType__ as Subject,
  });
}

type CanFn = AbilityBuilder<AppAbility>["can"];
type CannotFn = AbilityBuilder<AppAbility>["cannot"];

function applyTuple(
  can: CanFn,
  cannot: CannotFn,
  tuple: PermissionTuple,
  ctx: AuthContext,
  isPlatformRule: boolean,
) {
  const conditions = buildConditions(tuple, ctx, isPlatformRule);
  const fields = tuple.fields ? ([...tuple.fields] as string[]) : undefined;
  const fn = tuple.inverted ? cannot : can;

  // CASL's overloads are positional; narrow to the shape we actually use.
  const rule = (
    fn as unknown as (
      a: Action | Action[],
      s: Subject | Subject[],
      f?: string[] | Record<string, unknown>,
      c?: Record<string, unknown>,
    ) => { because: (r: string) => void }
  )(tuple.action, tuple.subject, fields, conditions);

  if (tuple.reason) rule.because(tuple.reason);
}

function buildConditions(
  tuple: PermissionTuple,
  ctx: AuthContext,
  isPlatformRule: boolean,
): Record<string, unknown> | undefined {
  const hydrated = tuple.conditions
    ? (hydrate(tuple.conditions, ctx) as Record<string, unknown>)
    : undefined;

  // Platform rules are deliberately unscoped. Everything else is pinned to the
  // active tenant here, at build time, so a role definition cannot forget to.
  if (isPlatformRule || ctx.isPlatformAdmin) return hydrated;
  if (!ctx.organizationId) return { organizationId: "__no_org__" };

  return { ...(hydrated ?? {}), organizationId: ctx.organizationId };
}

/* ---------------------------------------------------------------------------
   Field-level helpers
   --------------------------------------------------------------------------- */

/**
 * Fields of `type` that `ability` may read on `record`.
 * `allFields` is the full column list — CASL can only subtract from a known set.
 */
export function readableFields(
  ability: AppAbility,
  type: Subject,
  record: object | null,
  allFields: readonly string[],
): string[] {
  const target = record ? withSubject(type, record) : (type as unknown as object);
  return permittedFieldsOf(ability, "read", target as never, {
    fieldsFrom: (rule) => (rule.fields as string[] | undefined) ?? [...allFields],
  });
}

/** Convenience: does `ability` permit `action` on this concrete record? */
export function canOn(
  ability: AppAbility,
  action: Action,
  type: Subject,
  record: object,
): boolean {
  return ability.can(action, withSubject(type, record) as never);
}

/** Type-level check. UI-grade only — never the last line of defence. */
export function canType(ability: AppAbility, action: Action, type: Subject): boolean {
  return ability.can(action, type as never);
}
