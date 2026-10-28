"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/authz/guard";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/server/audit";
import {
  cancelBooking,
  checkInBooking,
  checkOutBooking,
  createBooking,
  type CreateBookingInput,
} from "@/server/services/camps";
import { db } from "@/server/db/store";
import { query } from "@/server/db/query";

export interface Outcome<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

function fail<T>(err: unknown): Outcome<T> {
  if (err instanceof AppError) return { ok: false, error: err.message, details: err.details };
  console.error("[camp action]", err);
  return { ok: false, error: "Үйлдэл амжилтгүй боллоо." };
}

export async function createBookingAction(
  input: CreateBookingInput,
  orgSlug: string,
): Promise<Outcome<{ id: string }>> {
  try {
    const ctx = await requireContext();
    const booking = createBooking(ctx, input);
    await recordAudit(ctx, {
      action: "booking.create",
      subject: "AccommodationBooking",
      subjectId: booking.id,
      after: { bedId: booking.bedId, startAt: booking.startAt, endAt: booking.endAt },
    });
    revalidatePath(`/${orgSlug}/accommodation`);
    return { ok: true, data: { id: booking.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function checkInAction(bookingId: string, orgSlug: string): Promise<Outcome> {
  try {
    const ctx = await requireContext();
    const booking = checkInBooking(ctx, bookingId);
    // An arrival is an event with an actor and a timestamp, recorded as such.
    await recordAudit(ctx, {
      action: "booking.checkin",
      subject: "AccommodationBooking",
      subjectId: bookingId,
      after: { checkedInAt: booking.checkedInAt },
    });
    revalidatePath(`/${orgSlug}/accommodation`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function checkOutAction(bookingId: string, orgSlug: string): Promise<Outcome> {
  try {
    const ctx = await requireContext();
    const booking = checkOutBooking(ctx, bookingId);
    await recordAudit(ctx, {
      action: "booking.checkout",
      subject: "AccommodationBooking",
      subjectId: bookingId,
      after: { checkedOutAt: booking.checkedOutAt },
    });
    revalidatePath(`/${orgSlug}/accommodation`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelBookingAction(
  bookingId: string,
  reason: string,
  orgSlug: string,
): Promise<Outcome> {
  try {
    const ctx = await requireContext();
    cancelBooking(ctx, bookingId);
    await recordAudit(ctx, {
      action: "booking.cancel",
      subject: "AccommodationBooking",
      subjectId: bookingId,
      reason,
    });
    revalidatePath(`/${orgSlug}/accommodation`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Employee lookup for the booking dialog, scoped like everything else. */
export async function searchBookableEmployeesAction(
  search: string,
  campId: string,
): Promise<{ id: string; displayName: string; employeeCode: string; jobTitle: string }[]> {
  const ctx = await requireContext();
  const needle = search.trim().toLowerCase();

  return query(ctx, "Employee", db().employees)
    .where(
      (e) =>
        e.status !== "terminated" &&
        (needle === "" ||
          e.displayName.toLowerCase().includes(needle) ||
          e.employeeCode.toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      // Workers already assigned to this camp first — they are who a camp
      // manager is almost always booking.
      const aHere = a.campId === campId ? 0 : 1;
      const bHere = b.campId === campId ? 0 : 1;
      return aHere - bHere || a.displayName.localeCompare(b.displayName, "mn");
    })
    .all()
    .slice(0, 30)
    .map((e) => ({
      id: e.id,
      displayName: e.displayName,
      employeeCode: e.employeeCode,
      jobTitle: e.jobTitle,
    }));
}
