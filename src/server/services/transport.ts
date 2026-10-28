import "server-only";
import { addDays, format, startOfDay } from "date-fns";
import { db } from "@/server/db/store";
import { authorizeOn, query, requireOne, type DataContext } from "@/server/db/query";
import {
  findTripResourceConflicts,
  legLoads,
  passengerHoldsSeat,
  seatsAvailableForLeg,
  type LegLoad,
  type SegmentLeg,
} from "@/server/db/invariants";
import { canType } from "@/lib/authz/ability";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type {
  BoardingRecord,
  ISODate,
  TransportBooking,
  TransportPassenger,
  TransportStop,
  TransportTrip,
  TripStatus,
} from "@/server/db/schema";

/* ===========================================================================
   Transport.

   Three things are kept apart, and the module is mostly the consequence of
   that:

     - A BOOKING is a request to travel. It may span several trips, and a trip
       carries passengers from many bookings. It is not a seat.
     - A PASSENGER row is one person on one trip between two stops. That stop
       pair is why capacity is a per-leg question, not a headcount.
     - A BOARDING RECORD is someone physically getting on. Being booked is not
       evidence of having travelled, exactly as a bed reservation is not
       evidence of having slept in it.
   ========================================================================= */

export interface StopView {
  id: string;
  name: string;
  sequenceNumber: number;
  scheduledOffsetMinutes: number;
  campId: string | null;
  siteId: string | null;
}

export interface TripLegLoad extends LegLoad {
  fromName: string;
  toName: string;
  /** Seats left on this leg; negative is impossible by construction. */
  free: number;
}

export interface TripView {
  id: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  departureAt: string;
  estimatedArrivalAt: string;
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  status: TripStatus;
  statusReason: string | null;

  vehicleId: string | null;
  vehicleRegistration: string | null;
  vehicleOwnership: "owned" | "contracted" | null;
  providerName: string | null;
  seatingCapacity: number | null;

  driverId: string | null;
  driverName: string | null;

  stops: StopView[];
  legs: TripLegLoad[];
  /** Passengers still holding a seat. */
  booked: number;
  /** Actually got on. Always ≤ booked, and the difference is the point. */
  boarded: number;
  noShows: number;
  /** Busiest leg — the figure that decides whether another vehicle is needed. */
  peakOccupancy: number;
  delayMinutes: number | null;
  incidentCount: number;
}

export interface MobilisationDemand {
  date: ISODate;
  /** People the roster says travel in on this date. */
  inboundPlanned: number;
  /** …of whom this many hold a seat. */
  inboundBooked: number;
  outboundPlanned: number;
  outboundBooked: number;
  /** Named people with a travel day and no seat. */
  unbooked: {
    employeeId: string;
    displayName: string;
    employeeCode: string;
    avatarColor: string;
    direction: "in" | "out";
  }[];
}

export interface TransportBoard {
  from: ISODate;
  days: number;
  trips: TripView[];
  routes: { id: string; code: string; name: string }[];
  /** `null` when the actor cannot read rosters — not "no demand". */
  mobilisation: MobilisationDemand[] | null;
  fleet: { total: number; active: number; contracted: number };
  canManage: boolean;
  canBoard: boolean;
}

export interface TransportBoardParams {
  from?: ISODate;
  days?: number;
  routeId?: string;
  /** Only trips whose busiest leg is at or over capacity. */
  fullOnly?: boolean;
  search?: string;
}

function stopsOf(stops: readonly TransportStop[], routeId: string): StopView[] {
  return stops
    .filter((s) => s.routeId === routeId)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((s) => ({
      id: s.id,
      name: s.name,
      sequenceNumber: s.sequenceNumber,
      scheduledOffsetMinutes: s.scheduledOffsetMinutes,
      campId: s.campId,
      siteId: s.siteId,
    }));
}

export function getTransportBoard(
  ctx: DataContext,
  params: TransportBoardParams,
): TransportBoard {
  const data = db();

  const from = params.from ? startOfDay(new Date(params.from)) : startOfDay(new Date());
  const days = Math.min(Math.max(params.days ?? 7, 1), 31);
  const windowStart = from.toISOString();
  const windowEnd = addDays(from, days).toISOString();

  const routes = query(ctx, "TransportRoute", data.transportRoutes)
    .where((r) => r.status === "active")
    .all();
  const routeById = new Map(routes.map((r) => [r.id, r]));

  // Stops are read through the route's permission: a stop is part of a route,
  // not a separately-governed thing.
  const visibleRouteIds = new Set(routes.map((r) => r.id));
  const allStops = data.transportStops.filter(
    (s) => s.organizationId === ctx.auth.organizationId && visibleRouteIds.has(s.routeId),
  );
  const stopBySeq = new Map(allStops.map((s) => [s.id, s.sequenceNumber]));

  const vehicles = new Map(query(ctx, "Vehicle", data.vehicles).all().map((v) => [v.id, v]));
  const drivers = new Map(query(ctx, "Driver", data.drivers).all().map((d) => [d.id, d]));

  const trips = query(
    ctx,
    "TransportTrip",
    data.transportTrips,
    (t) => t.departureAt >= windowStart && t.departureAt < windowEnd,
  )
    .where((t) => !params.routeId || t.routeId === params.routeId)
    .sort((a, b) => a.departureAt.localeCompare(b.departureAt))
    .all();

  const tripIds = new Set(trips.map((t) => t.id));
  const passengers = query(
    ctx,
    "TransportPassenger",
    data.transportPassengers,
    (p) => tripIds.has(p.tripId),
  ).all();

  const passengersByTrip = new Map<string, TransportPassenger[]>();
  for (const passenger of passengers) {
    const list = passengersByTrip.get(passenger.tripId) ?? [];
    list.push(passenger);
    passengersByTrip.set(passenger.tripId, list);
  }

  const boardingByTrip = new Map<string, number>();
  for (const record of query(
    ctx,
    "BoardingRecord",
    data.boardingRecords,
    (b) => tripIds.has(b.tripId) && b.eventType === "boarded",
  ).all()) {
    boardingByTrip.set(record.tripId, (boardingByTrip.get(record.tripId) ?? 0) + 1);
  }

  const incidentsByTrip = new Map<string, { count: number; delay: number }>();
  for (const incident of data.transportIncidents.filter(
    (i) => i.organizationId === ctx.auth.organizationId && tripIds.has(i.tripId),
  )) {
    const current = incidentsByTrip.get(incident.tripId) ?? { count: 0, delay: 0 };
    incidentsByTrip.set(incident.tripId, {
      count: current.count + 1,
      delay: current.delay + (incident.delayMinutes ?? 0),
    });
  }

  let tripViews: TripView[] = trips.map((trip) => {
    const route = routeById.get(trip.routeId);
    const stops = stopsOf(allStops, trip.routeId);
    const vehicle = trip.vehicleId ? vehicles.get(trip.vehicleId) : undefined;
    const driver = trip.driverId ? drivers.get(trip.driverId) : undefined;

    const tripPassengers = passengersByTrip.get(trip.id) ?? [];
    // Only states that actually occupy a seat count toward the load.
    const seatLegs: SegmentLeg[] = tripPassengers
      .filter((p) => passengerHoldsSeat(p.status))
      .map((p) => ({
        boardingSeq: stopBySeq.get(p.boardingStopId) ?? 0,
        destinationSeq: stopBySeq.get(p.destinationStopId) ?? 0,
      }))
      .filter((leg) => leg.destinationSeq > leg.boardingSeq);

    const capacity = vehicle?.seatingCapacity ?? 0;
    const loads = stops.length > 1 ? legLoads(seatLegs, stops.length) : [];
    const incident = incidentsByTrip.get(trip.id);

    return {
      id: trip.id,
      routeId: trip.routeId,
      routeCode: route?.code ?? "—",
      routeName: route?.name ?? "—",
      departureAt: trip.departureAt,
      estimatedArrivalAt: trip.estimatedArrivalAt,
      actualDepartureAt: trip.actualDepartureAt,
      actualArrivalAt: trip.actualArrivalAt,
      status: trip.status,
      statusReason: trip.statusReason,
      vehicleId: trip.vehicleId,
      vehicleRegistration: vehicle?.registrationNumber ?? null,
      vehicleOwnership: vehicle?.ownership ?? null,
      providerName: vehicle?.providerName ?? null,
      seatingCapacity: vehicle?.seatingCapacity ?? null,
      driverId: trip.driverId,
      driverName: driver?.fullName ?? null,
      stops,
      legs: loads.map((load) => ({
        ...load,
        fromName: stops[load.fromSeq]?.name ?? "—",
        toName: stops[load.toSeq]?.name ?? "—",
        free: Math.max(0, capacity - load.occupancy),
      })),
      booked: seatLegs.length,
      boarded: boardingByTrip.get(trip.id) ?? 0,
      noShows: tripPassengers.filter((p) => p.status === "no_show").length,
      peakOccupancy: loads.reduce((max, l) => Math.max(max, l.occupancy), 0),
      delayMinutes: incident?.delay ?? null,
      incidentCount: incident?.count ?? 0,
    };
  });

  if (params.search?.trim()) {
    const needle = params.search.trim().toLowerCase();
    tripViews = tripViews.filter(
      (t) =>
        t.routeName.toLowerCase().includes(needle) ||
        t.routeCode.toLowerCase().includes(needle) ||
        (t.vehicleRegistration?.toLowerCase().includes(needle) ?? false) ||
        (t.driverName?.toLowerCase().includes(needle) ?? false),
    );
  }
  if (params.fullOnly) {
    tripViews = tripViews.filter(
      (t) => t.seatingCapacity !== null && t.peakOccupancy >= t.seatingCapacity,
    );
  }

  const fleetVehicles = query(ctx, "Vehicle", data.vehicles).all();

  return {
    from: format(from, "yyyy-MM-dd"),
    days,
    trips: tripViews,
    routes: routes.map((r) => ({ id: r.id, code: r.code, name: r.name })),
    mobilisation: getMobilisationDemand(ctx, format(from, "yyyy-MM-dd"), days),
    fleet: {
      total: fleetVehicles.length,
      active: fleetVehicles.filter((v) => v.status === "active").length,
      contracted: fleetVehicles.filter((v) => v.ownership === "contracted").length,
    },
    canManage: canType(ctx.ability, "update", "TransportTrip"),
    canBoard: canType(ctx.ability, "create", "BoardingRecord"),
  };
}

/* --------------------------------------------- roster-driven mobilisation -- */

/**
 * What the roster says must move, against what transport has actually booked.
 *
 * This is the join the brief asks for: a published roster implies mobilisation,
 * and a mobilisation with no seat is a problem that only shows up if someone
 * compares the two. `null` when the actor cannot read rosters — which is not
 * the same as "nobody needs to travel".
 */
export function getMobilisationDemand(
  ctx: DataContext,
  from: ISODate,
  days: number,
): MobilisationDemand[] | null {
  if (!canType(ctx.ability, "read", "RosterAssignment")) return null;

  const data = db();
  const start = startOfDay(new Date(from));
  const dates = Array.from({ length: days }, (_, i) => format(addDays(start, i), "yyyy-MM-dd"));
  const dateSet = new Set(dates);

  const travelDays = query(
    ctx,
    "RosterAssignment",
    data.rosterAssignments,
    (a) => dateSet.has(a.date) && (a.dayType === "travel_in" || a.dayType === "travel_out"),
  ).all();

  const trips = new Map(
    query(ctx, "TransportTrip", data.transportTrips).all().map((t) => [t.id, t]),
  );
  // A seat only counts if the trip is still going to run.
  const seated = new Map<string, Set<string>>();
  for (const passenger of query(ctx, "TransportPassenger", data.transportPassengers).all()) {
    if (!passengerHoldsSeat(passenger.status) || !passenger.employeeId) continue;
    const trip = trips.get(passenger.tripId);
    if (!trip || trip.status === "cancelled") continue;
    const date = format(new Date(trip.departureAt), "yyyy-MM-dd");
    const set = seated.get(date) ?? new Set<string>();
    set.add(passenger.employeeId);
    seated.set(date, set);
  }

  const employees = new Map(query(ctx, "Employee", data.employees).all().map((e) => [e.id, e]));

  return dates.map((date) => {
    const day = travelDays.filter((a) => a.date === date);
    const seatedToday = seated.get(date) ?? new Set<string>();

    const inbound = day.filter((a) => a.dayType === "travel_in");
    const outbound = day.filter((a) => a.dayType === "travel_out");

    const unbooked = day
      .filter((a) => !seatedToday.has(a.employeeId))
      .map((a) => {
        const employee = employees.get(a.employeeId);
        return {
          employeeId: a.employeeId,
          displayName: employee?.displayName ?? "—",
          employeeCode: employee?.employeeCode ?? "",
          avatarColor: employee?.avatarColor ?? "neutral",
          direction: (a.dayType === "travel_in" ? "in" : "out") as "in" | "out",
        };
      })
      .filter((u) => u.displayName !== "—");

    return {
      date,
      inboundPlanned: inbound.length,
      inboundBooked: inbound.filter((a) => seatedToday.has(a.employeeId)).length,
      outboundPlanned: outbound.length,
      outboundBooked: outbound.filter((a) => seatedToday.has(a.employeeId)).length,
      unbooked,
    };
  });
}

/* ----------------------------------------------------------- manifest ----- */

export interface ManifestPassenger {
  id: string;
  bookingId: string;
  bookingReference: string;
  employeeId: string | null;
  displayName: string;
  employeeCode: string;
  avatarColor: string;
  jobTitle: string;
  boardingStopId: string;
  boardingStopName: string;
  destinationStopId: string;
  destinationStopName: string;
  status: TransportPassenger["status"];
  /** The actual event, which the booking does not imply. */
  boardedAt: string | null;
  scannedCode: string | null;
}

export interface TripManifest {
  trip: TripView;
  passengers: ManifestPassenger[];
  canBoard: boolean;
}

export function getTripManifest(ctx: DataContext, tripId: string): TripManifest {
  const data = db();
  const trip = requireOne(ctx, "TransportTrip", data.transportTrips, tripId);

  const board = getTransportBoard(ctx, {
    from: format(new Date(trip.departureAt), "yyyy-MM-dd"),
    days: 1,
    routeId: trip.routeId,
  });
  const view = board.trips.find((t) => t.id === tripId);
  if (!view) throw new NotFoundError();

  const stopNames = new Map(view.stops.map((s) => [s.id, s.name]));
  const employees = new Map(query(ctx, "Employee", data.employees).all().map((e) => [e.id, e]));
  const bookings = new Map(
    query(ctx, "TransportBooking", data.transportBookings).all().map((b) => [b.id, b]),
  );

  const boardingByPassenger = new Map<string, BoardingRecord>();
  for (const record of query(
    ctx,
    "BoardingRecord",
    data.boardingRecords,
    (b) => b.tripId === tripId,
  ).all()) {
    boardingByPassenger.set(record.passengerId, record);
  }

  const passengers = query(
    ctx,
    "TransportPassenger",
    data.transportPassengers,
    (p) => p.tripId === tripId,
  )
    .all()
    .map((passenger) => {
      const employee = passenger.employeeId ? employees.get(passenger.employeeId) : undefined;
      const record = boardingByPassenger.get(passenger.id);
      return {
        id: passenger.id,
        bookingId: passenger.bookingId,
        bookingReference: bookings.get(passenger.bookingId)?.bookingReference ?? "—",
        employeeId: passenger.employeeId,
        displayName: employee?.displayName ?? "—",
        employeeCode: employee?.employeeCode ?? "",
        avatarColor: employee?.avatarColor ?? "neutral",
        jobTitle: employee?.jobTitle ?? "",
        boardingStopId: passenger.boardingStopId,
        boardingStopName: stopNames.get(passenger.boardingStopId) ?? "—",
        destinationStopId: passenger.destinationStopId,
        destinationStopName: stopNames.get(passenger.destinationStopId) ?? "—",
        status: passenger.status,
        boardedAt: record?.eventType === "boarded" ? record.occurredAt : null,
        scannedCode: record?.scannedCode ?? null,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "mn"));

  return { trip: view, passengers, canBoard: board.canBoard };
}

/* ------------------------------------------------------------ mutations --- */

export interface BookSeatInput {
  tripId: string;
  employeeId: string;
  boardingStopId: string;
  destinationStopId: string;
  purpose?: string;
  idempotencyKey?: string;
}

export interface BookSeatResult {
  booking: TransportBooking;
  passenger: TransportPassenger;
  seatsLeftOnLeg: number;
}

export function bookSeat(ctx: DataContext, input: BookSeatInput): BookSeatResult {
  const data = db();
  const trip = requireOne(ctx, "TransportTrip", data.transportTrips, input.tripId);
  const employee = requireOne(ctx, "Employee", data.employees, input.employeeId);

  if (input.idempotencyKey) {
    const existing = data.transportBookings.find(
      (b) => b.idempotencyKey === input.idempotencyKey && b.organizationId === trip.organizationId,
    );
    if (existing) {
      const passenger = data.transportPassengers.find((p) => p.bookingId === existing.id);
      if (passenger) {
        return { booking: existing, passenger, seatsLeftOnLeg: 0 };
      }
    }
  }

  if (trip.status === "cancelled") {
    throw new ConflictError("Цуцлагдсан рейсэд захиалга хийх боломжгүй.");
  }
  if (trip.status === "arrived") {
    throw new ConflictError("Дууссан рейсэд захиалга хийх боломжгүй.");
  }
  if (!trip.vehicleId) {
    throw new ConflictError("Рейсэд тээврийн хэрэгсэл хуваарилагдаагүй байна.");
  }

  const vehicle = data.vehicles.find((v) => v.id === trip.vehicleId);
  if (!vehicle) throw new ConflictError("Тээврийн хэрэгсэл олдсонгүй.");
  if (vehicle.status !== "active") {
    throw new ConflictError("Тээврийн хэрэгсэл ашиглалтад байхгүй байна.");
  }

  const stops = data.transportStops
    .filter((s) => s.routeId === trip.routeId)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const boarding = stops.find((s) => s.id === input.boardingStopId);
  const destination = stops.find((s) => s.id === input.destinationStopId);
  if (!boarding || !destination) {
    throw new ValidationError("Зогсоол энэ маршрутад хамаарахгүй байна.");
  }
  if (destination.sequenceNumber <= boarding.sequenceNumber) {
    throw new ValidationError("Буух зогсоол нь суух зогсоолоос хойш байх ёстой.");
  }

  const alreadyOnTrip = data.transportPassengers.some(
    (p) =>
      p.tripId === trip.id && p.employeeId === employee.id && passengerHoldsSeat(p.status),
  );
  if (alreadyOnTrip) {
    throw new ConflictError("Энэ ажилтан тухайн рейсэд аль хэдийн бүртгэгдсэн байна.");
  }

  const existingLegs: SegmentLeg[] = data.transportPassengers
    .filter((p) => p.tripId === trip.id && passengerHoldsSeat(p.status))
    .map((p) => ({
      boardingSeq: stops.find((s) => s.id === p.boardingStopId)?.sequenceNumber ?? 0,
      destinationSeq: stops.find((s) => s.id === p.destinationStopId)?.sequenceNumber ?? 0,
    }))
    .filter((leg) => leg.destinationSeq > leg.boardingSeq);

  const candidate: SegmentLeg = {
    boardingSeq: boarding.sequenceNumber,
    destinationSeq: destination.sequenceNumber,
  };

  // Capacity is checked on the legs this journey actually crosses. A trip with
  // free seats overall can still be full for this particular journey.
  const seatsLeft = seatsAvailableForLeg(existingLegs, candidate, vehicle.seatingCapacity);
  if (seatsLeft <= 0) {
    throw new ConflictError(
      `Сонгосон хэсэгт сул суудал алга (${boarding.name} → ${destination.name}).`,
      { boardingStop: boarding.name, destinationStop: destination.name },
    );
  }

  const booking: TransportBooking = {
    id: `tb_${trip.organizationId}_${Date.now().toString(36)}_${data.transportBookings.length}`,
    organizationId: trip.organizationId,
    bookingReference: `TB-${String(100000 + data.transportBookings.length + 1)}`,
    requestedBy: ctx.auth.userId,
    requestedAt: new Date().toISOString(),
    status: "confirmed",
    purpose: input.purpose ?? null,
    note: null,
    idempotencyKey: input.idempotencyKey ?? null,
  };

  const passenger: TransportPassenger = {
    id: `tp_${trip.organizationId}_${Date.now().toString(36)}_${data.transportPassengers.length}`,
    organizationId: trip.organizationId,
    bookingId: booking.id,
    tripId: trip.id,
    employeeId: employee.id,
    visitorId: null,
    boardingStopId: boarding.id,
    destinationStopId: destination.id,
    // Booked, not boarded. Nothing here asserts the person travelled.
    status: "booked",
    seatNumber: null,
  };

  authorizeOn(ctx, "create", "TransportBooking", booking);
  authorizeOn(ctx, "create", "TransportPassenger", passenger);

  data.transportBookings.push(booking);
  data.transportPassengers.push(passenger);

  return { booking, passenger, seatsLeftOnLeg: seatsLeft - 1 };
}

export interface BoardingInput {
  passengerId: string;
  eventType: "boarded" | "no_show";
  scannedCode?: string;
}

/**
 * Record that someone physically got on — or did not.
 *
 * This is the only thing that turns a booking into travel. Nothing else in the
 * module may set a passenger to `boarded`.
 */
export function recordBoarding(ctx: DataContext, input: BoardingInput): BoardingRecord {
  const data = db();
  const passenger = requireOne(
    ctx,
    "TransportPassenger",
    data.transportPassengers,
    input.passengerId,
  );
  const trip = requireOne(ctx, "TransportTrip", data.transportTrips, passenger.tripId);

  if (trip.status === "cancelled") {
    throw new ConflictError("Цуцлагдсан рейсэд суулт бүртгэх боломжгүй.");
  }
  if (passenger.status === "cancelled") {
    throw new ConflictError("Цуцлагдсан зорчигч.");
  }
  if (passenger.status === "boarded" || passenger.status === "arrived") {
    throw new ConflictError("Энэ зорчигч аль хэдийн суусан бүртгэлтэй байна.");
  }

  const record: BoardingRecord = {
    id: `br_${trip.organizationId}_${Date.now().toString(36)}_${data.boardingRecords.length}`,
    organizationId: trip.organizationId,
    passengerId: passenger.id,
    tripId: trip.id,
    eventType: input.eventType,
    occurredAt: new Date().toISOString(),
    stopId: passenger.boardingStopId,
    recordedBy: ctx.auth.userId,
    scannedCode: input.scannedCode ?? null,
  };

  authorizeOn(ctx, "create", "BoardingRecord", record);

  data.boardingRecords.push(record);
  passenger.status = input.eventType === "boarded" ? "boarded" : "no_show";

  return record;
}

export interface TripUpdateInput {
  tripId: string;
  vehicleId?: string | null;
  driverId?: string | null;
  status?: TripStatus;
  statusReason?: string;
}

export function updateTrip(ctx: DataContext, input: TripUpdateInput): TransportTrip {
  const data = db();
  const trip = requireOne(ctx, "TransportTrip", data.transportTrips, input.tripId);
  authorizeOn(ctx, "update", "TransportTrip", trip);

  const next: TransportTrip = {
    ...trip,
    vehicleId: input.vehicleId !== undefined ? input.vehicleId : trip.vehicleId,
    driverId: input.driverId !== undefined ? input.driverId : trip.driverId,
    status: input.status ?? trip.status,
    statusReason: input.statusReason ?? trip.statusReason,
  };

  if ((next.status === "cancelled" || next.status === "delayed") && !next.statusReason?.trim()) {
    throw new ValidationError("Цуцлах, хойшлуулах шалтгаан заавал бичнэ.");
  }

  if (next.vehicleId) {
    const vehicle = data.vehicles.find((v) => v.id === next.vehicleId);
    if (!vehicle) throw new ValidationError("Тээврийн хэрэгсэл олдсонгүй.");
    if (vehicle.status !== "active") {
      throw new ConflictError("Засварт байгаа тээврийн хэрэгслийг хуваарилах боломжгүй.");
    }
    const seated = data.transportPassengers.filter(
      (p) => p.tripId === trip.id && passengerHoldsSeat(p.status),
    ).length;
    // Swapping to a smaller bus must not silently strand people.
    if (seated > vehicle.seatingCapacity) {
      throw new ConflictError(
        `Багтаамж хүрэлцэхгүй: ${seated} зорчигч, ${vehicle.seatingCapacity} суудал.`,
      );
    }
  }

  const conflicts = findTripResourceConflicts(
    {
      id: next.id,
      vehicleId: next.vehicleId,
      driverId: next.driverId,
      departureAt: next.departureAt,
      estimatedArrivalAt: next.estimatedArrivalAt,
      status: next.status,
    },
    data.transportTrips.filter((t) => t.organizationId === trip.organizationId),
  );
  if (conflicts.length > 0) {
    throw new ConflictError(conflicts[0].message, { conflicts });
  }

  Object.assign(trip, next);

  // Cancelling a trip releases its seats; the bookings themselves survive as
  // history of what was requested.
  if (next.status === "cancelled") {
    for (const passenger of data.transportPassengers) {
      if (passenger.tripId === trip.id && passenger.status === "booked") {
        passenger.status = "cancelled";
      }
    }
  }

  return trip;
}
