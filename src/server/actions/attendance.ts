"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/authz/guard";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/server/audit";
import {
  correctAttendance,
  recordClockEvent,
  type ClockInput,
  type CorrectionInput,
} from "@/server/services/attendance";

export interface Outcome {
  ok: boolean;
  error?: string;
}

function fail(err: unknown): Outcome {
  if (err instanceof AppError) return { ok: false, error: err.message };
  console.error("[attendance]", err);
  return { ok: false, error: "Үйлдэл амжилтгүй боллоо." };
}

export async function recordClockEventAction(
  input: ClockInput,
  orgSlug: string,
): Promise<Outcome> {
  try {
    const ctx = await requireContext();
    const event = recordClockEvent(ctx, input);
    await recordAudit(ctx, {
      action: `attendance.${input.eventType}`,
      subject: "Attendance",
      subjectId: event.id,
      after: { employeeId: event.employeeId, occurredAt: event.occurredAt, source: event.source },
    });
    revalidatePath(`/${orgSlug}/attendance`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function correctAttendanceAction(
  input: CorrectionInput,
  orgSlug: string,
): Promise<Outcome> {
  try {
    const ctx = await requireContext();
    const correction = correctAttendance(ctx, input);
    // A correction is a human overruling the evidence, so the audit row keeps
    // both the assertion and what the system had concluded.
    await recordAudit(ctx, {
      action: "attendance.correct",
      subject: "Attendance",
      subjectId: correction.id,
      before: { status: correction.derivedStatus },
      after: { status: correction.status, employeeId: correction.employeeId, date: correction.date },
      reason: correction.reason,
    });
    revalidatePath(`/${orgSlug}/attendance`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
