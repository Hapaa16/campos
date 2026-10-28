import "server-only";
import { headers } from "next/headers";
import { db } from "@/server/db/store";
import type { DataContext } from "@/server/db/query";
import type { AuditLog } from "@/server/db/schema";

/* ===========================================================================
   Audit trail.

   Wraps mutating operations so the record is written from one place and cannot
   drift from what actually happened. Decisions that affect people — publishing
   a roster, approving leave, restructuring a unit, checking someone in —
   require a reason, because "who changed this and why" is the question asked
   six months later.
   ========================================================================= */

export interface AuditEntry {
  action: string;
  subject: string;
  subjectId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Operations where an unexplained change is not acceptable. */
const REASON_REQUIRED = new Set([
  "roster.publish",
  "roster.unpublish",
  "leave.approve",
  "leave.reject",
  "orgunit.move",
  "orgunit.archive",
  "booking.cancel",
  "role.update",
  "employee.terminate",
  "attendance.correct",
]);

export async function recordAudit(ctx: DataContext, entry: AuditEntry): Promise<AuditLog> {
  if (REASON_REQUIRED.has(entry.action) && !entry.reason?.trim()) {
    throw new Error(`Audit action "${entry.action}" requires a reason.`);
  }

  const actor = db().users.find((u) => u.id === ctx.auth.userId);
  let ip: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  } catch {
    // Outside a request scope (jobs, tests) — an absent IP is honest.
  }

  const log: AuditLog = {
    id: `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    organizationId: ctx.auth.organizationId ?? "platform",
    actorUserId: ctx.auth.userId,
    actorName: actor?.name ?? ctx.auth.userId,
    action: entry.action,
    subject: entry.subject,
    subjectId: entry.subjectId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    ip,
    at: new Date().toISOString(),
  };

  db().auditLogs.unshift(log);
  return log;
}

/**
 * Run a mutation and record it, but only once it has actually succeeded —
 * a failed operation must not leave an audit row claiming it happened.
 */
export async function withAudit<T>(
  ctx: DataContext,
  entry: AuditEntry | ((result: T) => AuditEntry),
  fn: () => T | Promise<T>,
): Promise<T> {
  const result = await fn();
  await recordAudit(ctx, typeof entry === "function" ? entry(result) : entry);
  return result;
}

/** Shallow diff, so the log stores what changed rather than two whole rows. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const k = key as keyof T;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a };
}
