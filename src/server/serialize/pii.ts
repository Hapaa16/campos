import "server-only";
import { readableFields, type AppAbility } from "@/lib/authz/ability";
import type { Subject } from "@/lib/authz/types";

/* ===========================================================================
   Layer 5 — field-level masking.

   Real enforcement, not presentation. Personal data is removed on the server
   before serialization, so a field the actor may not read never crosses the
   wire and cannot be recovered from a network tab, a cached payload, or a
   client-side bug.
   ========================================================================= */

/** Full column list per subject. CASL can only subtract from a known set. */
const FIELD_CATALOGUE: Partial<Record<Subject, readonly string[]>> = {};

export function registerFields(type: Subject, fields: readonly string[]) {
  FIELD_CATALOGUE[type] = fields;
}

export function fieldsOf(type: Subject): readonly string[] | undefined {
  return FIELD_CATALOGUE[type];
}

/**
 * Strip every field the ability may not read.
 *
 * Returns `null` when the actor cannot read the record at all, so callers can
 * surface a 404 rather than an empty object that implies existence.
 */
export function maskRecord<T extends object>(
  ability: AppAbility,
  type: Subject,
  record: T,
): Partial<T> | null {
  const all = FIELD_CATALOGUE[type];
  if (!all) {
    throw new Error(
      `No field catalogue registered for subject "${type}". ` +
        `Register one in src/server/db/schema.ts — masking must never silently pass through.`,
    );
  }

  const allowed = new Set(readableFields(ability, type, record, all));
  if (allowed.size === 0) return null;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record as Record<string, unknown>)) {
    if (allowed.has(key)) out[key] = (record as Record<string, unknown>)[key];
  }
  return out as Partial<T>;
}

export function maskList<T extends object>(
  ability: AppAbility,
  type: Subject,
  records: readonly T[],
): Partial<T>[] {
  const out: Partial<T>[] = [];
  for (const r of records) {
    const masked = maskRecord(ability, type, r);
    if (masked) out.push(masked);
  }
  return out;
}

/**
 * Which personal fields were withheld — so the UI can render an honest
 * "hidden" affordance instead of pretending the data does not exist.
 */
export function withheldFields<T extends object>(
  ability: AppAbility,
  type: Subject,
  record: T,
): string[] {
  const all = FIELD_CATALOGUE[type];
  if (!all) return [];
  const allowed = new Set(readableFields(ability, type, record, all));
  return all.filter((f) => !allowed.has(f));
}
