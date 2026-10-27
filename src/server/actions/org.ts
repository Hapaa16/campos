"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/authz/guard";
import {
  applyOrgUnitMove,
  getOrgUnitDetail,
  previewOrgUnitMove,
  type MovePreview,
} from "@/server/services/org-units";
import { db } from "@/server/db/store";
import { recordAudit } from "@/server/audit";
import { AppError } from "@/lib/errors";

export async function previewMoveAction(
  unitId: string,
  newParentId: string | null,
): Promise<MovePreview | { error: string }> {
  try {
    const ctx = await requireContext();
    return previewOrgUnitMove(ctx, unitId, newParentId);
  } catch (err) {
    return { error: err instanceof AppError ? err.message : "Урьдчилан харах боломжгүй." };
  }
}

export async function applyMoveAction(
  unitId: string,
  newParentId: string | null,
  reason: string,
  orgSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await requireContext();

    const before = db().orgUnits.find((u) => u.id === unitId);
    const snapshot = before ? { parentId: before.parentId, path: before.path } : null;

    const result = applyOrgUnitMove(ctx, unitId, newParentId);

    const after = db().orgUnits.find((u) => u.id === unitId)!;
    // A restructure is a decision about people's reporting lines; it is never
    // recorded without a stated reason.
    await recordAudit(ctx, {
      action: "orgunit.move",
      subject: "OrgUnit",
      subjectId: unitId,
      before: snapshot,
      after: { parentId: after.parentId, path: after.path, ...result },
      reason,
    });

    revalidatePath(`/${orgSlug}/org-chart`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof AppError ? err.message : "Шилжүүлэг амжилтгүй боллоо.",
    };
  }
}

export async function loadUnitDetailAction(unitId: string) {
  try {
    const ctx = await requireContext();
    return getOrgUnitDetail(ctx, unitId);
  } catch {
    // The panel treats null as "nothing to show" rather than surfacing an
    // error for a unit that simply is not visible to this actor.
    return null;
  }
}
