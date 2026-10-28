"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/authz/guard";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db/store";
import {
  applyCellEdits,
  generateRoster,
  publishRoster,
  type CellEdit,
} from "@/server/services/rosters";

export interface ActionOutcome<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

export async function applyCellEditsAction(
  periodId: string,
  edits: CellEdit[],
  orgSlug: string,
): Promise<ActionOutcome<{ applied: number; cleared: number; conflicts: number }>> {
  try {
    const ctx = await requireContext();
    const result = applyCellEdits(ctx, periodId, edits);
    revalidatePath(`/${orgSlug}/rosters`);
    return {
      ok: true,
      data: { applied: result.applied, cleared: result.cleared, conflicts: result.conflicts.length },
    };
  } catch (err) {
    return toOutcome(err);
  }
}

export async function generateRosterAction(
  periodId: string,
  overwriteManual: boolean,
  orgSlug: string,
): Promise<ActionOutcome<{ created: number; skippedManual: number; employeesWithoutPattern: number }>> {
  try {
    const ctx = await requireContext();
    const result = generateRoster(ctx, { periodId, overwriteManual });
    await recordAudit(ctx, {
      action: "roster.generate",
      subject: "RosterPeriod",
      subjectId: periodId,
      after: result,
    });
    revalidatePath(`/${orgSlug}/rosters`);
    return { ok: true, data: result };
  } catch (err) {
    return toOutcome(err);
  }
}

export async function publishRosterAction(
  periodId: string,
  reason: string,
  orgSlug: string,
): Promise<ActionOutcome<{ version: number; confirmed: number }>> {
  try {
    const ctx = await requireContext();
    const before = db().rosterPeriods.find((p) => p.id === periodId);
    const snapshot = before ? { status: before.status, version: before.version } : null;

    const result = publishRoster(ctx, periodId);

    // Publication is the moment a plan becomes an instruction to people, so it
    // is never recorded without an actor, a timestamp and a stated reason.
    await recordAudit(ctx, {
      action: "roster.publish",
      subject: "RosterPeriod",
      subjectId: periodId,
      before: snapshot,
      after: { status: "published", version: result.version, confirmed: result.confirmed },
      reason,
    });

    revalidatePath(`/${orgSlug}/rosters`);
    return { ok: true, data: { version: result.version, confirmed: result.confirmed } };
  } catch (err) {
    return toOutcome(err);
  }
}

function toOutcome<T>(err: unknown): ActionOutcome<T> {
  if (err instanceof AppError) {
    return { ok: false, error: err.message, details: err.details };
  }
  console.error("[roster action]", err);
  return { ok: false, error: "Үйлдэл амжилтгүй боллоо." };
}
