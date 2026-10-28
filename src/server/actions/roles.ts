"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/authz/guard";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/server/audit";
import { editRolePermissions, type RoleEdit } from "@/server/services/roles";

export async function editRoleAction(
  edit: RoleEdit,
  reason: string,
  orgSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await requireContext();
    const before = structuredClone(
      (await import("@/server/db/store")).db().roles.find((r) => r.id === edit.roleId)?.permissions,
    );

    const role = editRolePermissions(ctx, edit);

    await recordAudit(ctx, {
      action: "role.update",
      subject: "Role",
      subjectId: edit.roleId,
      before,
      after: structuredClone(role.permissions),
      reason,
    });

    revalidatePath(`/${orgSlug}/settings/roles`);
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    console.error("[roles]", err);
    return { ok: false, error: "Үйлдэл амжилтгүй боллоо." };
  }
}
