"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/authz/guard";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db/store";
import { query } from "@/server/db/query";
import {
  bookSeat,
  getTripManifest,
  recordBoarding,
  updateTrip,
  type BookSeatInput,
  type BoardingInput,
  type TripUpdateInput,
} from "@/server/services/transport";

export interface Outcome<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

function fail<T>(err: unknown): Outcome<T> {
  if (err instanceof AppError) return { ok: false, error: err.message };
  console.error("[transport]", err);
  return { ok: false, error: "Үйлдэл амжилтгүй боллоо." };
}

export async function bookSeatAction(
  input: BookSeatInput,
  orgSlug: string,
): Promise<Outcome<{ reference: string; seatsLeft: number }>> {
  try {
    const ctx = await requireContext();
    const result = bookSeat(ctx, input);
    await recordAudit(ctx, {
      action: "transport.book",
      subject: "TransportBooking",
      subjectId: result.booking.id,
      after: {
        tripId: input.tripId,
        employeeId: input.employeeId,
        from: input.boardingStopId,
        to: input.destinationStopId,
      },
    });
    revalidatePath(`/${orgSlug}/transport`);
    return {
      ok: true,
      data: { reference: result.booking.bookingReference, seatsLeft: result.seatsLeftOnLeg },
    };
  } catch (err) {
    return fail(err);
  }
}

export async function recordBoardingAction(
  input: BoardingInput,
  orgSlug: string,
): Promise<Outcome> {
  try {
    const ctx = await requireContext();
    const record = recordBoarding(ctx, input);
    // The event, not the booking — this is what makes it travel.
    await recordAudit(ctx, {
      action: `transport.${input.eventType}`,
      subject: "BoardingRecord",
      subjectId: record.id,
      after: { passengerId: record.passengerId, occurredAt: record.occurredAt },
    });
    revalidatePath(`/${orgSlug}/transport`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateTripAction(
  input: TripUpdateInput,
  orgSlug: string,
): Promise<Outcome> {
  try {
    const ctx = await requireContext();
    const before = db().transportTrips.find((t) => t.id === input.tripId);
    const snapshot = before
      ? { vehicleId: before.vehicleId, driverId: before.driverId, status: before.status }
      : null;

    const trip = updateTrip(ctx, input);

    await recordAudit(ctx, {
      action: "transport.trip.update",
      subject: "TransportTrip",
      subjectId: trip.id,
      before: snapshot,
      after: { vehicleId: trip.vehicleId, driverId: trip.driverId, status: trip.status },
      reason: input.statusReason ?? null,
    });

    revalidatePath(`/${orgSlug}/transport`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function loadManifestAction(tripId: string) {
  try {
    const ctx = await requireContext();
    return getTripManifest(ctx, tripId);
  } catch {
    return null;
  }
}

/** Fleet and driver options for the assignment control. */
export async function loadAssignableResourcesAction() {
  const ctx = await requireContext();
  const data = db();
  return {
    vehicles: query(ctx, "Vehicle", data.vehicles)
      .where((v) => v.status === "active")
      .all()
      .map((v) => ({
        id: v.id,
        label: `${v.registrationNumber} · ${v.seatingCapacity}`,
        ownership: v.ownership,
        providerName: v.providerName,
      })),
    drivers: query(ctx, "Driver", data.drivers)
      .where((d) => d.status === "active")
      .all()
      .map((d) => ({
        id: d.id,
        label: d.fullName,
        providerName: d.providerName,
        licenceExpiresAt: d.licenceExpiresAt,
      })),
  };
}

/** Employees not already holding a seat on this trip. */
export async function searchTripCandidatesAction(tripId: string, search: string) {
  const ctx = await requireContext();
  const data = db();
  const taken = new Set(
    data.transportPassengers
      .filter((p) => p.tripId === tripId && p.status !== "cancelled" && p.status !== "no_show")
      .map((p) => p.employeeId),
  );
  const needle = search.trim().toLowerCase();

  return query(ctx, "Employee", data.employees)
    .where(
      (e) =>
        e.status !== "terminated" &&
        !taken.has(e.id) &&
        (needle === "" ||
          e.displayName.toLowerCase().includes(needle) ||
          e.employeeCode.toLowerCase().includes(needle)),
    )
    .all()
    .slice(0, 25)
    .map((e) => ({
      id: e.id,
      displayName: e.displayName,
      employeeCode: e.employeeCode,
      jobTitle: e.jobTitle,
    }));
}
