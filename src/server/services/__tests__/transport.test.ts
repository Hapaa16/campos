import { beforeEach, describe, expect, it } from "vitest";
import { format, startOfDay } from "date-fns";
import { buildAbility } from "@/lib/authz/ability";
import type { AuthContext } from "@/lib/authz/types";
import type { DataContext } from "@/server/db/query";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { db, resetDb } from "@/server/db/store";
import { SEED_ORG_A, SEED_ORG_B } from "@/server/db/seed";
import {
  bookSeat,
  getTransportBoard,
  getTripManifest,
  recordBoarding,
  updateTrip,
} from "../transport";

function ctxFor(roleIds: string[], extra: Partial<AuthContext> = {}): DataContext {
  const auth: AuthContext = {
    userId: "u",
    organizationId: SEED_ORG_A,
    employeeId: null,
    roleIds,
    siteIds: ["site_ot_mine"],
    campIds: [],
    orgUnitPath: null,
    isPlatformAdmin: false,
    permVersion: 1,
    ...extra,
  };
  return { auth, ability: buildAbility(auth) };
}

const coordinator = () => ctxFor(["transport.coordinator"]);
const boardingAgent = () => ctxFor(["boarding.agent"]);
const admin = () => ctxFor(["org.admin"]);

const today = () => format(startOfDay(new Date()), "yyyy-MM-dd");

/**
 * A future trip on the four-stop UB→OT route with its seats cleared.
 *
 * The seed deliberately fills trips to capacity, so a test that needs room
 * has to make it — otherwise it is really testing the seed's load factor.
 */
const emptyFutureTrip = () => {
  const trip = futureLongTrip();
  db().transportPassengers = db().transportPassengers.filter((p) => p.tripId !== trip.id);
  return trip;
};

/** A future trip on the four-stop UB→OT route, with a vehicle assigned. */
const futureLongTrip = () => {
  const route = db().transportRoutes.find((r) => r.code === "UB-OT")!;
  return db().transportTrips.find(
    (t) =>
      t.routeId === route.id &&
      t.status === "scheduled" &&
      t.vehicleId !== null &&
      t.departureAt > new Date().toISOString(),
  )!;
};

const stopsOfTrip = (tripId: string) => {
  const trip = db().transportTrips.find((t) => t.id === tripId)!;
  return db()
    .transportStops.filter((s) => s.routeId === trip.routeId)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
};

const freeEmployee = (tripId: string) => {
  const taken = new Set(
    db().transportPassengers.filter((p) => p.tripId === tripId).map((p) => p.employeeId),
  );
  return db().employees.find(
    (e) => e.organizationId === SEED_ORG_A && e.status === "active" && !taken.has(e.id),
  )!;
};

beforeEach(() => resetDb());

describe("a booking is not a seat and a seat is not a journey", () => {
  it("creates a booking and a passenger, and asserts nothing about travel", () => {
    const trip = emptyFutureTrip();
    const stops = stopsOfTrip(trip.id);
    const result = bookSeat(coordinator(), {
      tripId: trip.id,
      employeeId: freeEmployee(trip.id).id,
      boardingStopId: stops[0].id,
      destinationStopId: stops[stops.length - 1].id,
    });

    expect(result.booking.status).toBe("confirmed");
    // Booked, not boarded. Only a boarding record can change that.
    expect(result.passenger.status).toBe("booked");
    expect(db().boardingRecords.some((b) => b.passengerId === result.passenger.id)).toBe(false);
  });

  it("keeps the booking record when the trip is cancelled", () => {
    const trip = futureLongTrip();
    const before = db().transportBookings.filter((b) => b.organizationId === SEED_ORG_A).length;

    updateTrip(coordinator(), {
      tripId: trip.id,
      status: "cancelled",
      statusReason: "Цасан шуурга",
    });

    // Seats are released, but what was requested is still on the record.
    expect(db().transportBookings.filter((b) => b.organizationId === SEED_ORG_A).length).toBe(before);
    const passengers = db().transportPassengers.filter((p) => p.tripId === trip.id);
    for (const p of passengers) expect(p.status).not.toBe("booked");
  });

  it("counts boarded separately from booked on the board", () => {
    const board = getTransportBoard(admin(), { from: today(), days: 14 });
    const past = board.trips.filter((t) => t.status === "arrived" && t.booked > 0);
    const anyPast = getTransportBoard(admin(), {
      from: format(new Date(Date.now() - 10 * 864e5), "yyyy-MM-dd"),
      days: 10,
    }).trips.filter((t) => t.status === "arrived");

    const sample = past.length > 0 ? past : anyPast;
    expect(sample.length).toBeGreaterThan(0);
    // Some people booked and did not travel; that gap is the point.
    expect(sample.some((t) => t.noShows > 0)).toBe(true);
    for (const trip of sample) expect(trip.boarded).toBeLessThanOrEqual(trip.booked + trip.noShows);
  });
});

describe("seat capacity is a per-leg question", () => {
  it("reports occupancy for each leg, not one number for the trip", () => {
    const board = getTransportBoard(admin(), {
      from: format(new Date(Date.now() - 14 * 864e5), "yyyy-MM-dd"),
      days: 28,
    });
    const multiLeg = board.trips.find((t) => t.legs.length > 2 && t.booked > 10)!;
    expect(multiLeg).toBeTruthy();
    expect(multiLeg.legs.length).toBe(multiLeg.stops.length - 1);

    // With part-way journeys in the data, the legs must not all be identical.
    const occupancies = new Set(multiLeg.legs.map((l) => l.occupancy));
    expect(occupancies.size).toBeGreaterThan(1);
    expect(multiLeg.peakOccupancy).toBe(Math.max(...multiLeg.legs.map((l) => l.occupancy)));
  });

  it("refuses a booking on a full leg even when the trip has free seats elsewhere", () => {
    const ctx = coordinator();
    const trip = futureLongTrip();
    const stops = stopsOfTrip(trip.id);
    const vehicle = db().vehicles.find((v) => v.id === trip.vehicleId)!;

    // Fill the FIRST leg only: everyone rides stop 0 → stop 1.
    db().transportPassengers = db().transportPassengers.filter((p) => p.tripId !== trip.id);
    for (let i = 0; i < vehicle.seatingCapacity; i++) {
      db().transportPassengers.push({
        id: `fill_${i}`,
        organizationId: SEED_ORG_A,
        bookingId: "fill",
        tripId: trip.id,
        employeeId: `ghost_${i}`,
        visitorId: null,
        boardingStopId: stops[0].id,
        destinationStopId: stops[1].id,
        status: "booked",
        seatNumber: null,
      });
    }

    // Stop 0 → 1 is full…
    expect(() =>
      bookSeat(ctx, {
        tripId: trip.id,
        employeeId: freeEmployee(trip.id).id,
        boardingStopId: stops[0].id,
        destinationStopId: stops[1].id,
      }),
    ).toThrow(ConflictError);

    // …while stop 1 → 3 is completely empty.
    expect(() =>
      bookSeat(ctx, {
        tripId: trip.id,
        employeeId: freeEmployee(trip.id).id,
        boardingStopId: stops[1].id,
        destinationStopId: stops[stops.length - 1].id,
      }),
    ).not.toThrow();
  });

  it("refuses a full-route booking when any crossed leg is full", () => {
    const ctx = coordinator();
    const trip = futureLongTrip();
    const stops = stopsOfTrip(trip.id);
    const vehicle = db().vehicles.find((v) => v.id === trip.vehicleId)!;

    db().transportPassengers = db().transportPassengers.filter((p) => p.tripId !== trip.id);
    for (let i = 0; i < vehicle.seatingCapacity; i++) {
      db().transportPassengers.push({
        id: `mid_${i}`,
        organizationId: SEED_ORG_A,
        bookingId: "fill",
        tripId: trip.id,
        employeeId: `ghost_${i}`,
        visitorId: null,
        boardingStopId: stops[1].id,
        destinationStopId: stops[2].id,
        status: "booked",
        seatNumber: null,
      });
    }

    expect(() =>
      bookSeat(ctx, {
        tripId: trip.id,
        employeeId: freeEmployee(trip.id).id,
        boardingStopId: stops[0].id,
        destinationStopId: stops[stops.length - 1].id,
      }),
    ).toThrow(ConflictError);
  });

  it("frees the seat again once a passenger is cancelled", () => {
    const ctx = coordinator();
    const trip = futureLongTrip();
    const stops = stopsOfTrip(trip.id);
    const vehicle = db().vehicles.find((v) => v.id === trip.vehicleId)!;

    db().transportPassengers = db().transportPassengers.filter((p) => p.tripId !== trip.id);
    for (let i = 0; i < vehicle.seatingCapacity; i++) {
      db().transportPassengers.push({
        id: `full_${i}`,
        organizationId: SEED_ORG_A,
        bookingId: "fill",
        tripId: trip.id,
        employeeId: `ghost_${i}`,
        visitorId: null,
        boardingStopId: stops[0].id,
        destinationStopId: stops[stops.length - 1].id,
        status: i === 0 ? "cancelled" : "booked",
        seatNumber: null,
      });
    }

    // Exactly one cancellation means exactly one seat.
    expect(() =>
      bookSeat(ctx, {
        tripId: trip.id,
        employeeId: freeEmployee(trip.id).id,
        boardingStopId: stops[0].id,
        destinationStopId: stops[stops.length - 1].id,
      }),
    ).not.toThrow();
  });

  it("refuses a journey that does not move forward", () => {
    const trip = futureLongTrip();
    const stops = stopsOfTrip(trip.id);
    expect(() =>
      bookSeat(coordinator(), {
        tripId: trip.id,
        employeeId: freeEmployee(trip.id).id,
        boardingStopId: stops[2].id,
        destinationStopId: stops[1].id,
      }),
    ).toThrow(ValidationError);
  });

  it("refuses a stop from a different route", () => {
    const trip = futureLongTrip();
    const stops = stopsOfTrip(trip.id);
    const foreign = db().transportStops.find((s) => s.routeId !== trip.routeId)!;
    expect(() =>
      bookSeat(coordinator(), {
        tripId: trip.id,
        employeeId: freeEmployee(trip.id).id,
        boardingStopId: stops[0].id,
        destinationStopId: foreign.id,
      }),
    ).toThrow(ValidationError);
  });
});

describe("booking guards", () => {
  it("refuses a cancelled trip", () => {
    const trip = futureLongTrip();
    const stops = stopsOfTrip(trip.id);
    updateTrip(coordinator(), { tripId: trip.id, status: "cancelled", statusReason: "x" });
    expect(() =>
      bookSeat(coordinator(), {
        tripId: trip.id,
        employeeId: freeEmployee(trip.id).id,
        boardingStopId: stops[0].id,
        destinationStopId: stops[1].id,
      }),
    ).toThrow(ConflictError);
  });

  it("refuses to book the same person onto one trip twice", () => {
    const ctx = coordinator();
    const trip = emptyFutureTrip();
    const stops = stopsOfTrip(trip.id);
    const employee = freeEmployee(trip.id);

    bookSeat(ctx, {
      tripId: trip.id,
      employeeId: employee.id,
      boardingStopId: stops[0].id,
      destinationStopId: stops[1].id,
    });
    expect(() =>
      bookSeat(ctx, {
        tripId: trip.id,
        employeeId: employee.id,
        boardingStopId: stops[1].id,
        destinationStopId: stops[2].id,
      }),
    ).toThrow(ConflictError);
  });

  it("is idempotent on a repeated request key", () => {
    const ctx = coordinator();
    const trip = emptyFutureTrip();
    const stops = stopsOfTrip(trip.id);
    const input = {
      tripId: trip.id,
      employeeId: freeEmployee(trip.id).id,
      boardingStopId: stops[0].id,
      destinationStopId: stops[1].id,
      idempotencyKey: "req-7",
    };
    const before = db().transportBookings.length;

    const first = bookSeat(ctx, input);
    const second = bookSeat(ctx, input);

    expect(second.booking.id).toBe(first.booking.id);
    expect(db().transportBookings.length).toBe(before + 1);
  });

  it("refuses another tenant's trip as non-existent", () => {
    const other = ctxFor(["org.admin"], { organizationId: SEED_ORG_B });
    const trip = futureLongTrip();
    const stops = stopsOfTrip(trip.id);
    expect(() =>
      bookSeat(other, {
        tripId: trip.id,
        employeeId: freeEmployee(trip.id).id,
        boardingStopId: stops[0].id,
        destinationStopId: stops[1].id,
      }),
    ).toThrow(NotFoundError);
  });

  it("refuses the boarding agent, who may record but not book", () => {
    const trip = futureLongTrip();
    const stops = stopsOfTrip(trip.id);
    expect(() =>
      bookSeat(boardingAgent(), {
        tripId: trip.id,
        employeeId: freeEmployee(trip.id).id,
        boardingStopId: stops[0].id,
        destinationStopId: stops[1].id,
      }),
    ).toThrow();
  });
});

describe("boarding is the only thing that turns a booking into travel", () => {
  const bookedPassenger = () => {
    const trip = emptyFutureTrip();
    const stops = stopsOfTrip(trip.id);
    return bookSeat(coordinator(), {
      tripId: trip.id,
      employeeId: freeEmployee(trip.id).id,
      boardingStopId: stops[0].id,
      destinationStopId: stops[stops.length - 1].id,
    }).passenger;
  };

  it("records the event with actor and timestamp", () => {
    const passenger = bookedPassenger();
    const record = recordBoarding(boardingAgent(), {
      passengerId: passenger.id,
      eventType: "boarded",
    });

    expect(record.eventType).toBe("boarded");
    expect(record.recordedBy).toBe("u");
    expect(record.occurredAt).toBeTruthy();
    expect(db().transportPassengers.find((p) => p.id === passenger.id)!.status).toBe("boarded");
  });

  it("records a no-show without pretending the person travelled", () => {
    const passenger = bookedPassenger();
    recordBoarding(boardingAgent(), { passengerId: passenger.id, eventType: "no_show" });
    expect(db().transportPassengers.find((p) => p.id === passenger.id)!.status).toBe("no_show");
  });

  it("refuses a second boarding for the same passenger", () => {
    const passenger = bookedPassenger();
    recordBoarding(boardingAgent(), { passengerId: passenger.id, eventType: "boarded" });
    expect(() =>
      recordBoarding(boardingAgent(), { passengerId: passenger.id, eventType: "boarded" }),
    ).toThrow(ConflictError);
  });

  it("keeps a scanned QR code on the record when one was used", () => {
    const passenger = bookedPassenger();
    const record = recordBoarding(boardingAgent(), {
      passengerId: passenger.id,
      eventType: "boarded",
      scannedCode: "QR-ABC",
    });
    expect(record.scannedCode).toBe("QR-ABC");
  });

  it("refuses boarding onto a cancelled trip", () => {
    const passenger = bookedPassenger();
    updateTrip(coordinator(), {
      tripId: passenger.tripId,
      status: "cancelled",
      statusReason: "Цасан шуурга",
    });
    expect(() =>
      recordBoarding(boardingAgent(), { passengerId: passenger.id, eventType: "boarded" }),
    ).toThrow(ConflictError);
  });
});

describe("vehicle and driver assignment", () => {
  it("refuses a vehicle already committed to an overlapping trip", () => {
    const ctx = coordinator();
    const trips = db()
      .transportTrips.filter((t) => t.status === "scheduled" && t.vehicleId)
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt));
    const first = trips[0];
    const clashing = trips.find(
      (t) =>
        t.id !== first.id &&
        t.departureAt < first.estimatedArrivalAt &&
        first.departureAt < t.estimatedArrivalAt,
    );
    if (!clashing) return;

    expect(() => updateTrip(ctx, { tripId: clashing.id, vehicleId: first.vehicleId })).toThrow(
      ConflictError,
    );
  });

  it("refuses a vehicle that is in maintenance", () => {
    const maintenance = db().vehicles.find((v) => v.status === "maintenance")!;
    expect(() =>
      updateTrip(coordinator(), { tripId: futureLongTrip().id, vehicleId: maintenance.id }),
    ).toThrow(ConflictError);
  });

  it("refuses downsizing to a vehicle that cannot carry the people already booked", () => {
    const trip = db()
      .transportTrips.filter((t) => t.status === "scheduled" && t.vehicleId)
      .find((t) => db().transportPassengers.filter((p) => p.tripId === t.id).length > 12);
    if (!trip) return;

    const small = db().vehicles.find((v) => v.status === "active" && v.seatingCapacity <= 11)!;
    expect(() => updateTrip(coordinator(), { tripId: trip.id, vehicleId: small.id })).toThrow(
      ConflictError,
    );
  });

  it("requires a reason to cancel or delay", () => {
    expect(() => updateTrip(coordinator(), { tripId: futureLongTrip().id, status: "cancelled" })).toThrow(
      ValidationError,
    );
  });
});

describe("the roster says who must move", () => {
  it("compares planned mobilisation against booked seats", () => {
    const board = getTransportBoard(admin(), { from: today(), days: 7 });
    expect(board.mobilisation).not.toBeNull();

    const withDemand = board.mobilisation!.find((m) => m.inboundPlanned + m.outboundPlanned > 0);
    expect(withDemand).toBeTruthy();
    expect(withDemand!.inboundBooked).toBeLessThanOrEqual(withDemand!.inboundPlanned);
    expect(withDemand!.outboundBooked).toBeLessThanOrEqual(withDemand!.outboundPlanned);
  });

  it("names the people with a travel day and no seat", () => {
    const board = getTransportBoard(admin(), { from: today(), days: 7 });
    const day = board.mobilisation!.find((m) => m.unbooked.length > 0);
    if (!day) return;
    for (const person of day.unbooked) {
      expect(person.displayName).not.toBe("—");
      expect(["in", "out"]).toContain(person.direction);
    }
  });

  it("reports unknown, not zero, when the actor cannot read rosters", () => {
    // The transport coordinator can read RosterAssignment; the boarding agent
    // cannot, and must not be told "nobody needs to travel".
    expect(getTransportBoard(coordinator(), { from: today() }).mobilisation).not.toBeNull();
    expect(getTransportBoard(boardingAgent(), { from: today() }).mobilisation).toBeNull();
  });
});

describe("manifest", () => {
  it("lists passengers with boarding kept separate from booking", () => {
    const trip = db().transportTrips.find(
      (t) =>
        t.status === "arrived" &&
        db().transportPassengers.some((p) => p.tripId === t.id),
    )!;
    const manifest = getTripManifest(admin(), trip.id);

    expect(manifest.passengers.length).toBeGreaterThan(0);
    for (const passenger of manifest.passengers) {
      if (passenger.status === "no_show") expect(passenger.boardedAt).toBeNull();
      expect(passenger.boardingStopName).not.toBe("—");
      expect(passenger.destinationStopName).not.toBe("—");
    }
  });

  it("404s on another tenant's trip", () => {
    const other = ctxFor(["org.admin"], { organizationId: SEED_ORG_B });
    expect(() => getTripManifest(other, futureLongTrip().id)).toThrow(NotFoundError);
  });

  it("separates the right to board from the right to manage", () => {
    expect(getTransportBoard(boardingAgent(), {}).canBoard).toBe(true);
    expect(getTransportBoard(boardingAgent(), {}).canManage).toBe(false);
    expect(getTransportBoard(coordinator(), {}).canManage).toBe(true);
  });
});

describe("tenant isolation", () => {
  it("shows the other tenant no trips of ours", () => {
    const other = ctxFor(["org.admin"], { organizationId: SEED_ORG_B });
    const board = getTransportBoard(other, { from: today(), days: 14 });
    expect(board.trips).toEqual([]);
    expect(board.routes).toEqual([]);
  });
});
