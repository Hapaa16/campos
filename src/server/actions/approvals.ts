"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/authz/guard";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/server/audit";
import { decideLeave } from "@/server/services/approvals";

export async function decideLeaveAction(
  requestId: string,
  decision: "approved" | "rejected",
  reason: string,
  orgSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await requireContext();
    const request = decideLeave(ctx, requestId, decision, reason);

    await recordAudit(ctx, {
      action: decision === "approved" ? "leave.approve" : "leave.reject",
      subject: "LeaveRequest",
      subjectId: requestId,
      after: { status: request.status, decidedAt: request.decidedAt },
      reason,
    });

    revalidatePath(`/${orgSlug}/approvals`);
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    console.error("[approvals]", err);
    return { ok: false, error: "Үйлдэл амжилтгүй боллоо." };
  }
}
