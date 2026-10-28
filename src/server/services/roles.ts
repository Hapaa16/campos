import "server-only";
import { db } from "@/server/db/store";
import type { DataContext } from "@/server/db/query";
import { authorizeOn } from "@/server/db/query";
import { ValidationError } from "@/lib/errors";
import { ACTIONS, SUBJECTS, type Action, type PermissionTuple, type RoleDefinition, type Subject } from "@/lib/authz/types";

/* ===========================================================================
   Role administration.

   Roles are stored as data, so this is ordinary CRUD over permission tuples —
   there is no code path anywhere that branches on a role name, which is what
   makes editing one safe.
   ========================================================================= */

/** How a given (action, subject) pair resolves for a role. */
export type CellState =
  | { kind: "none" }
  | { kind: "allow"; scoped: boolean; fieldLimited: boolean; reason?: string }
  | { kind: "deny"; reason?: string };

export interface RoleMatrix {
  role: RoleDefinition;
  /** Subjects this role mentions, in catalogue order. */
  subjects: Subject[];
  actions: Action[];
  /** `cells[subject][action]` */
  cells: Record<string, Record<string, CellState>>;
  /** Count of users currently carrying this role in the active organization. */
  assignedUsers: number;
}

const EDITABLE_ACTIONS: Action[] = ACTIONS.filter((a) => a !== "manage");

export function listRoles(ctx: DataContext): RoleDefinition[] {
  void ctx;
  return db().roles;
}

export function getRoleMatrix(ctx: DataContext, roleId: string): RoleMatrix {
  const role = db().roles.find((r) => r.id === roleId);
  if (!role) throw new ValidationError("Дүр олдсонгүй.");

  const mentioned = new Set<Subject>();
  for (const tuple of role.permissions) {
    for (const subject of asArray(tuple.subject)) {
      if (subject === "all") {
        // `manage all` touches everything, so show the whole catalogue.
        for (const s of SUBJECTS) if (s !== "all") mentioned.add(s);
      } else {
        mentioned.add(subject);
      }
    }
  }

  const subjects = SUBJECTS.filter((s) => s !== "all" && mentioned.has(s));
  const cells: Record<string, Record<string, CellState>> = {};

  for (const subject of subjects) {
    cells[subject] = {};
    for (const action of EDITABLE_ACTIONS) {
      cells[subject][action] = resolveCell(role.permissions, action, subject);
    }
  }

  const assignedUsers = db().users.filter((u) =>
    u.memberships.some(
      (m) => m.organizationId === ctx.auth.organizationId && m.roleIds.includes(roleId),
    ),
  ).length;

  return { role, subjects, actions: EDITABLE_ACTIONS, cells, assignedUsers };
}

/**
 * Resolve one (action, subject) pair the way CASL would.
 *
 * Inverted rules win, which is why denials are checked last and overwrite.
 */
function resolveCell(
  permissions: readonly PermissionTuple[],
  action: Action,
  subject: Subject,
): CellState {
  let state: CellState = { kind: "none" };

  for (const tuple of permissions) {
    const actions = asArray(tuple.action);
    const subjects = asArray(tuple.subject);
    const matchesAction = actions.includes(action) || actions.includes("manage");
    const matchesSubject = subjects.includes(subject) || subjects.includes("all");
    if (!matchesAction || !matchesSubject) continue;

    if (tuple.inverted) {
      state = { kind: "deny", reason: tuple.reason };
      continue; // a denial stands, but keep scanning for a later one
    }
    if (state.kind !== "deny") {
      state = {
        kind: "allow",
        scoped: tuple.conditions !== undefined,
        fieldLimited: tuple.fields !== undefined,
        reason: tuple.reason,
      };
    }
  }

  return state;
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

export interface RoleEdit {
  roleId: string;
  /** Index into `role.permissions`; omit to append a new tuple. */
  index?: number;
  tuple?: PermissionTuple;
  /** Set to remove the tuple at `index`. */
  remove?: boolean;
}

export function editRolePermissions(ctx: DataContext, edit: RoleEdit): RoleDefinition {
  const role = db().roles.find((r) => r.id === edit.roleId);
  if (!role) throw new ValidationError("Дүр олдсонгүй.");

  // Editing permissions is itself a permission.
  authorizeOn(ctx, "update", "Role", {
    id: role.id,
    organizationId: ctx.auth.organizationId ?? "",
  });

  if (edit.remove) {
    if (edit.index === undefined || !role.permissions[edit.index]) {
      throw new ValidationError("Устгах дүрэм олдсонгүй.");
    }
    role.permissions.splice(edit.index, 1);
  } else if (edit.tuple) {
    validateTuple(edit.tuple);
    if (edit.index !== undefined && role.permissions[edit.index]) {
      role.permissions[edit.index] = edit.tuple;
    } else {
      role.permissions.push(edit.tuple);
    }
  } else {
    throw new ValidationError("Өөрчлөлт заагаагүй байна.");
  }

  // Every session carrying the old grants is now stale. Bumping the
  // generation forces them to be re-issued rather than silently keeping
  // permissions that have just been revoked.
  for (const user of db().users) {
    if (user.memberships.some((m) => m.roleIds.includes(role.id))) {
      user.permVersion += 1;
    }
  }

  return role;
}

function validateTuple(tuple: PermissionTuple) {
  const actions = asArray(tuple.action);
  const subjects = asArray(tuple.subject);

  if (actions.length === 0 || subjects.length === 0) {
    throw new ValidationError("Үйлдэл болон обьект шаардлагатай.");
  }
  for (const action of actions) {
    if (!(ACTIONS as readonly string[]).includes(action)) {
      throw new ValidationError(`Үл мэдэгдэх үйлдэл: ${action}`);
    }
  }
  for (const subject of subjects) {
    if (!(SUBJECTS as readonly string[]).includes(subject)) {
      throw new ValidationError(`Үл мэдэгдэх обьект: ${subject}`);
    }
  }
}
