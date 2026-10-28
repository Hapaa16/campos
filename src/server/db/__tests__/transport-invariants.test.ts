import { describe, expect, it } from "vitest";
import {
  findTripResourceConflicts,
  legLoads,
  passengerHoldsSeat,
  seatsAvailableForLeg,
  tripHoldsResources,
  type TripWindow,
} from "../invariants";

/* A route with four stops: UB(0) → Mandalgovi(1) → Dalanzadgad(2) → OT(3). */
const STOPS = 4;

describe("seat availability is a per-leg question", () => {
  it("sells the same seat twice when the journeys do not overlap", () => {
    const existing = Array.from({ length: 45 }, () => ({ boardingSeq: 0, destinationSeq: 1 }));
    // Everyone gets off at stop 1, so leg 1→2 is completely empty.
    expect(seatsAvailableForLeg(existing, { boardingSeq: 1, destinationSeq: 2 }, 45)).toBe(45);
    expect(seatsAvailableForLeg(existing, { boardingSeq: 0, destinationSeq: 1 }, 45)).toBe(0);
  });

  it("reports the worst leg a journey crosses, not the average", () => {
    const existing = [
      ...Array.from({ length: 40 }, () => ({ boardingSeq: 0, destinationSeq: 1 })),
      ...Array.from({ length: 5 }, () => ({ boardingSeq: 1, destinationSeq: 3 })),
    ];
    // Leg 0→1 carries 40, legs 1→2 and 2→3 carry 5. A full-route passenger is
    // limited by the busiest leg they cross.
    expect(seatsAvailableForLeg(existing, { boardingSeq: 0, destinationSeq: 3 }, 45)).toBe(5);
    expect(seatsAvailableForLeg(existing, { boardingSeq: 1, destinationSeq: 3 }, 45)).toBe(40);
  });

  it("never reports negative seats on an oversold leg", () => {
    const existing = Array.from({ length: 60 }, () => ({ boardingSeq: 0, destinationSeq: 3 }));
    expect(seatsAvailableForLeg(existing, { boardingSeq: 0, destinationSeq: 1 }, 45)).toBe(0);
  });

  it("refuses a journey that does not move forward", () => {
    expect(() => seatsAvailableForLeg([], { boardingSeq: 2, destinationSeq: 2 }, 45)).toThrow(
      RangeError,
    );
    expect(() => seatsAvailableForLeg([], { boardingSeq: 3, destinationSeq: 1 }, 45)).toThrow(
      RangeError,
    );
  });

  it("is full capacity on an empty trip", () => {
    expect(seatsAvailableForLeg([], { boardingSeq: 0, destinationSeq: 3 }, 45)).toBe(45);
  });
});

describe("leg loads tell the coordinator where the bus is full", () => {
  it("reports occupancy for every leg of the route", () => {
    const legs = [
      { boardingSeq: 0, destinationSeq: 3 },
      { boardingSeq: 0, destinationSeq: 1 },
      { boardingSeq: 2, destinationSeq: 3 },
    ];
    expect(legLoads(legs, STOPS)).toEqual([
      { fromSeq: 0, toSeq: 1, occupancy: 2 },
      { fromSeq: 1, toSeq: 2, occupancy: 1 },
      { fromSeq: 2, toSeq: 3, occupancy: 2 },
    ]);
  });

  it("is all zeroes for an empty trip", () => {
    expect(legLoads([], STOPS).every((l) => l.occupancy === 0)).toBe(true);
  });

  it("produces one entry fewer than the stop count", () => {
    expect(legLoads([], STOPS)).toHaveLength(STOPS - 1);
  });
});

describe("a seat is held by some passenger states and not others", () => {
  it("counts booked, boarded and arrived", () => {
    for (const status of ["booked", "boarded", "arrived"]) {
      expect(passengerHoldsSeat(status)).toBe(true);
    }
  });

  it("releases the seat on cancellation and no-show", () => {
    expect(passengerHoldsSeat("cancelled")).toBe(false);
    expect(passengerHoldsSeat("no_show")).toBe(false);
  });
});

describe("a vehicle and a driver cannot be in two places", () => {
  const trip = (over: Partial<TripWindow> = {}): TripWindow => ({
    id: "t1",
    vehicleId: "v1",
    driverId: "d1",
    departureAt: "2026-11-02T00:00:00.000Z",
    estimatedArrivalAt: "2026-11-02T08:00:00.000Z",
    status: "scheduled",
    ...over,
  });

  it("flags an overlapping trip for both the vehicle and the driver", () => {
    const other = trip({ id: "t2", departureAt: "2026-11-02T06:00:00.000Z", estimatedArrivalAt: "2026-11-02T14:00:00.000Z" });
    const conflicts = findTripResourceConflicts(trip(), [other]);
    expect(conflicts.map((c) => c.kind).sort()).toEqual(["driver", "vehicle"]);
  });

  it("flags only the driver when the vehicle differs", () => {
    const other = trip({ id: "t2", vehicleId: "v2", departureAt: "2026-11-02T06:00:00.000Z", estimatedArrivalAt: "2026-11-02T14:00:00.000Z" });
    expect(findTripResourceConflicts(trip(), [other]).map((c) => c.kind)).toEqual(["driver"]);
  });

  it("enforces turnaround — arriving at 08:00 does not free the bus at 08:05", () => {
    const tooSoon = trip({
      id: "t2",
      departureAt: "2026-11-02T08:05:00.000Z",
      estimatedArrivalAt: "2026-11-02T16:00:00.000Z",
    });
    expect(findTripResourceConflicts(trip(), [tooSoon]).length).toBeGreaterThan(0);

    const enoughSlack = trip({
      id: "t3",
      departureAt: "2026-11-02T09:00:00.000Z",
      estimatedArrivalAt: "2026-11-02T17:00:00.000Z",
    });
    expect(findTripResourceConflicts(trip(), [enoughSlack])).toEqual([]);
  });

  it("ignores cancelled trips, which hold nothing", () => {
    const cancelled = trip({ id: "t2", status: "cancelled", departureAt: "2026-11-02T06:00:00.000Z", estimatedArrivalAt: "2026-11-02T14:00:00.000Z" });
    expect(findTripResourceConflicts(trip(), [cancelled])).toEqual([]);

    // And a cancelled candidate conflicts with nothing either.
    expect(findTripResourceConflicts(trip({ status: "cancelled" }), [trip({ id: "t2" })])).toEqual([]);
  });

  it("ignores an arrived trip, whose vehicle is back", () => {
    const done = trip({ id: "t2", status: "arrived", departureAt: "2026-11-02T06:00:00.000Z", estimatedArrivalAt: "2026-11-02T14:00:00.000Z" });
    expect(findTripResourceConflicts(trip(), [done])).toEqual([]);
  });

  it("does not conflict with itself when a trip is edited", () => {
    expect(findTripResourceConflicts(trip(), [trip()])).toEqual([]);
  });

  it("ignores an unassigned vehicle or driver", () => {
    const unassigned = trip({ vehicleId: null, driverId: null });
    const other = trip({ id: "t2", departureAt: "2026-11-02T06:00:00.000Z", estimatedArrivalAt: "2026-11-02T14:00:00.000Z" });
    expect(findTripResourceConflicts(unassigned, [other])).toEqual([]);
  });

  it("treats delayed and boarding trips as still holding resources", () => {
    expect(tripHoldsResources("delayed")).toBe(true);
    expect(tripHoldsResources("boarding")).toBe(true);
    expect(tripHoldsResources("departed")).toBe(true);
    expect(tripHoldsResources("arrived")).toBe(false);
    expect(tripHoldsResources("cancelled")).toBe(false);
  });
});

describe("seeded timetable", () => {
  it("departs at the intended local hours", async () => {
    const { buildSeed } = await import("../seed");
    const { format } = await import("date-fns");
    const db = buildSeed();

    const expected: Record<string, string[]> = {
      "UB-OT": ["07:00"],
      "OT-UB": ["07:00"],
      "OT-GS": ["09:00", "15:00"],
      "OT-SHIFT": ["06:00", "18:00"],
    };

    for (const [code, hours] of Object.entries(expected)) {
      const route = db.transportRoutes.find((r) => r.code === code)!;
      const actual = [
        ...new Set(
          db.transportTrips
            .filter((t) => t.routeId === route.id)
            .map((t) => format(new Date(t.departureAt), "HH:mm")),
        ),
      ].sort();
      // A 07:00 departure appearing at 23:00 the previous day is an hour-
      // arithmetic bug, and it silently moves every trip to the wrong date.
      expect(actual, code).toEqual(hours);
    }
  });

  it("gives every trip an arrival after its departure", async () => {
    const { buildSeed } = await import("../seed");
    const db = buildSeed();
    for (const trip of db.transportTrips) {
      expect(trip.estimatedArrivalAt > trip.departureAt, trip.id).toBe(true);
    }
  });

  it("never seeds a trip over its vehicle's capacity", async () => {
    const { buildSeed } = await import("../seed");
    const db = buildSeed();
    const bySeq = new Map(db.transportStops.map((s) => [s.id, s.sequenceNumber]));

    for (const trip of db.transportTrips) {
      const vehicle = db.vehicles.find((v) => v.id === trip.vehicleId);
      if (!vehicle) continue;
      const legs = db.transportPassengers
        .filter((p) => p.tripId === trip.id && passengerHoldsSeat(p.status))
        .map((p) => ({
          boardingSeq: bySeq.get(p.boardingStopId)!,
          destinationSeq: bySeq.get(p.destinationStopId)!,
        }));
      if (legs.length === 0) continue;
      const peak = Math.max(...legLoads(legs, 4).map((l) => l.occupancy));
      expect(peak, trip.id).toBeLessThanOrEqual(vehicle.seatingCapacity);
    }
  });
});
