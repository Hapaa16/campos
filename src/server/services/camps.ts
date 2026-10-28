import "server-only";
import { addDays, format, startOfDay } from "date-fns";
import { db } from "@/server/db/store";
import { authorizeOn, query, requireOne, type DataContext } from "@/server/db/query";
import { findBedBookingConflicts, isOccupying } from "@/server/db/invariants";
import { ConflictError, ValidationError } from "@/lib/errors";
import { canType } from "@/lib/authz/ability";
import type {
  AccommodationBooking,
  Bed,
  Building,
  Camp,
  ISODate,
  Room,
} from "@/server/db/schema";

/* ===========================================================================
   Camp accommodation.

   The separation this module exists to protect: a booking is a plan, a
   check-in is an event, and occupancy is the count of events. Merging them is
   how a camp reports 1,284 people who are not there.
   ========================================================================= */

export interface BedSlot {
  bedId: string;
  bedCode: string;
  bedStatus: Bed["status"];
  roomId: string;
  roomNumber: string;
  roomType: Room["roomType"];
  roomStatus: Room["status"];
  housekeeping: Room["housekeeping"];
  buildingId: string;
  buildingName: string;
  floor: number;
  /** Bookings overlapping the requested window, in start order. */
  bookings: BedBookingView[];
}

export interface BedBookingView {
  id: string;
  startAt: string;
  endAt: string;
  status: AccommodationBooking["status"];
  personType: AccommodationBooking["personType"];
  personName: string | null;
  employeeId: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

export interface CampSummary {
  camp: Camp;
  siteName: string | null;
  totalBeds: number;
  serviceable: number;
  /** Actual presence: people who have checked in and not out. */
  occupied: number;
  /** Planned only: a reservation for the window that has not been checked in. */
  reserved: number;
  free: number;
  unavailable: number;
  noShows: number;
  housekeepingDirty: number;
}

export interface CampBoardData {
  camps: CampSummary[];
  selectedCampId: string | null;
  buildings: Building[];
  slots: BedSlot[];
  dates: ISODate[];
  /**
   * The window start as a local calendar date.
   *
   * Separate from `rangeStart` on purpose: slicing the UTC instant gives the
   * previous day for any zone east of UTC, so the date picker and the grid
   * header disagreed by one day in Ulaanbaatar.
   */
  fromDate: ISODate;
  rangeStart: string;
  rangeEnd: string;
  canBook: boolean;
  canCheckIn: boolean;
}

export interface CampBoardParams {
  campId?: string;
  buildingId?: string;
  /** Inclusive start of the window being inspected. */
  from?: ISODate;
  days?: number;
  /** Only beds with no occupying booking across the whole window. */
  freeOnly?: boolean;
  search?: string;
}

export function getCampBoard(ctx: DataContext, params: CampBoardParams): CampBoardData {
  const data = db();

  const from = params.from ? startOfDay(new Date(params.from)) : startOfDay(new Date());
  const days = Math.min(Math.max(params.days ?? 14, 1), 45);
  const rangeStart = from.toISOString();
  const rangeEnd = addDays(from, days).toISOString();
  const dates = Array.from({ length: days }, (_, i) => format(addDays(from, i), "yyyy-MM-dd"));

  const camps = query(ctx, "Camp", data.camps).where((c) => c.status === "active").all();
  const siteNames = new Map(query(ctx, "Site", data.sites).all().map((s) => [s.id, s.name]));

  const beds = query(ctx, "Bed", data.beds).all();
  const rooms = new Map(query(ctx, "Room", data.rooms).all().map((r) => [r.id, r]));
  const buildings = query(ctx, "Building", data.buildings).all();
  const buildingNames = new Map(buildings.map((b) => [b.id, b.name]));

  // Only bookings that intersect the window are relevant to this board.
  const windowBookings = query(
    ctx,
    "AccommodationBooking",
    data.accommodationBookings,
    (b) => b.startAt < rangeEnd && b.endAt > rangeStart,
  ).all();

  const employeeNames = new Map(
    query(ctx, "Employee", data.employees).all().map((e) => [e.id, e.displayName]),
  );

  const bookingsByBed = new Map<string, AccommodationBooking[]>();
  for (const booking of windowBookings) {
    const list = bookingsByBed.get(booking.bedId) ?? [];
    list.push(booking);
    bookingsByBed.set(booking.bedId, list);
  }

  /* -- per-camp summary -------------------------------------------------- */
  const summaries: CampSummary[] = camps.map((camp) => {
    const campBeds = beds.filter((b) => b.campId === camp.id);
    const campBookings = windowBookings.filter((b) => b.campId === camp.id);

    const serviceable = campBeds.filter((b) => b.status === "available").length;
    // Occupied counts ACTUAL check-ins, not reservations.
    const occupied = campBookings.filter((b) => b.status === "checked_in").length;
    const reserved = campBookings.filter((b) => b.status === "reserved").length;
    const unavailable = campBeds.length - serviceable;

    const campRooms = [...rooms.values()].filter((r) => r.campId === camp.id);

    return {
      camp,
      siteName: siteNames.get(camp.siteId) ?? null,
      totalBeds: campBeds.length,
      serviceable,
      occupied,
      reserved,
      free: Math.max(0, serviceable - occupied - reserved),
      unavailable,
      noShows: campBookings.filter((b) => b.status === "no_show").length,
      housekeepingDirty: campRooms.filter((r) => r.housekeeping === "dirty").length,
    };
  });

  const selectedCampId =
    params.campId && camps.some((c) => c.id === params.campId)
      ? params.campId
      : (camps[0]?.id ?? null);

  /* -- bed slots for the selected camp ----------------------------------- */
  let slots: BedSlot[] = [];
  if (selectedCampId) {
    slots = beds
      .filter((bed) => bed.campId === selectedCampId)
      .filter((bed) => !params.buildingId || bed.buildingId === params.buildingId)
      .map((bed) => {
        const room = rooms.get(bed.roomId);
        return {
          bedId: bed.id,
          bedCode: bed.bedCode,
          bedStatus: bed.status,
          roomId: bed.roomId,
          roomNumber: room?.roomNumber ?? "—",
          roomType: room?.roomType ?? "double",
          roomStatus: room?.status ?? "available",
          housekeeping: room?.housekeeping ?? "clean",
          buildingId: bed.buildingId,
          buildingName: buildingNames.get(bed.buildingId) ?? "—",
          floor: room?.floor ?? 0,
          bookings: (bookingsByBed.get(bed.id) ?? [])
            .sort((a, b) => a.startAt.localeCompare(b.startAt))
            .map((booking) => ({
              id: booking.id,
              startAt: booking.startAt,
              endAt: booking.endAt,
              status: booking.status,
              personType: booking.personType,
              personName: booking.employeeId
                ? (employeeNames.get(booking.employeeId) ?? null)
                : null,
              employeeId: booking.employeeId,
              checkedInAt: booking.checkedInAt,
              checkedOutAt: booking.checkedOutAt,
            })),
        };
      })
      .sort(
        (a, b) =>
          a.buildingName.localeCompare(b.buildingName) ||
          a.floor - b.floor ||
          a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }) ||
          a.bedCode.localeCompare(b.bedCode),
      );

    if (params.search?.trim()) {
      const needle = params.search.trim().toLowerCase();
      slots = slots.filter(
        (slot) =>
          slot.roomNumber.toLowerCase().includes(needle) ||
          slot.bedCode.toLowerCase().includes(needle) ||
          slot.bookings.some((b) => b.personName?.toLowerCase().includes(needle)),
      );
    }

    if (params.freeOnly) {
      slots = slots.filter(
        (slot) => slot.bedStatus === "available" && !slot.bookings.some((b) => isOccupying(b.status)),
      );
    }
  }

  return {
    camps: summaries,
    selectedCampId,
    buildings: buildings.filter((b) => b.campId === selectedCampId),
    slots,
    dates,
    fromDate: format(from, "yyyy-MM-dd"),
    rangeStart,
    rangeEnd,
    canBook: canType(ctx.ability, "create", "AccommodationBooking"),
    canCheckIn: canType(ctx.ability, "checkin", "AccommodationBooking"),
  };
}

/* ------------------------------------------------------------- mutations -- */

export interface CreateBookingInput {
  bedId: string;
  employeeId: string;
  startAt: string;
  endAt: string;
  note?: string;
  /** Repeating a request with the same key must not create a second booking. */
  idempotencyKey?: string;
}

export function createBooking(ctx: DataContext, input: CreateBookingInput): AccommodationBooking {
  const data = db();
  const bed = requireOne(ctx, "Bed", data.beds, input.bedId);
  const employee = requireOne(ctx, "Employee", data.employees, input.employeeId);

  if (input.idempotencyKey) {
    const existing = data.accommodationBookings.find(
      (b) => b.idempotencyKey === input.idempotencyKey && b.organizationId === bed.organizationId,
    );
    if (existing) return existing;
  }

  if (input.endAt <= input.startAt) {
    throw new ValidationError("Дуусах хугацаа эхлэхээс хойш байх ёстой.");
  }
  if (bed.status !== "available") {
    throw new ConflictError("Энэ ор ашиглалтад байхгүй байна.");
  }

  const room = data.rooms.find((r) => r.id === bed.roomId);
  if (room && room.status !== "available") {
    throw new ConflictError("Өрөө засварт эсвэл ашиглалтаас гарсан байна.");
  }

  // Mirrors the EXCLUDE constraint the database will carry. Checked here
  // rather than trusted from the client, which only pre-validates for UX.
  const conflicts = findBedBookingConflicts(
    { bedId: bed.id, startAt: input.startAt, endAt: input.endAt },
    data.accommodationBookings.filter((b) => b.organizationId === bed.organizationId),
  );
  if (conflicts.length > 0) {
    throw new ConflictError("Энэ ор тухайн хугацаанд аль хэдийн захиалагдсан байна.", {
      conflicts: conflicts.map((c) => ({ id: c.id, startAt: c.startAt, endAt: c.endAt })),
    });
  }

  const booking: AccommodationBooking = {
    id: `ab_${bed.organizationId}_${Date.now().toString(36)}_${data.accommodationBookings.length}`,
    organizationId: bed.organizationId,
    campId: bed.campId,
    buildingId: bed.buildingId,
    roomId: bed.roomId,
    bedId: bed.id,
    personType: "employee",
    employeeId: employee.id,
    visitorId: null,
    startAt: input.startAt,
    endAt: input.endAt,
    status: "reserved",
    // A new booking is a plan. It is NOT an arrival, so these stay null until
    // someone physically turns up and is recorded.
    checkedInAt: null,
    checkedInBy: null,
    checkedOutAt: null,
    checkedOutBy: null,
    createdAt: new Date().toISOString(),
    createdBy: ctx.auth.userId,
    idempotencyKey: input.idempotencyKey ?? null,
    note: input.note ?? null,
  };

  authorizeOn(ctx, "create", "AccommodationBooking", booking);
  data.accommodationBookings.push(booking);
  return booking;
}

export function checkInBooking(ctx: DataContext, bookingId: string): AccommodationBooking {
  const data = db();
  const booking = requireOne(ctx, "AccommodationBooking", data.accommodationBookings, bookingId);
  authorizeOn(ctx, "checkin", "AccommodationBooking", booking);

  if (booking.status === "checked_in") {
    throw new ConflictError("Аль хэдийн бүртгэгдсэн байна.");
  }
  if (booking.status === "cancelled" || booking.status === "checked_out") {
    throw new ConflictError("Энэ захиалга идэвхгүй байна.");
  }

  booking.status = "checked_in";
  booking.checkedInAt = new Date().toISOString();
  booking.checkedInBy = ctx.auth.userId;
  return booking;
}

export function checkOutBooking(ctx: DataContext, bookingId: string): AccommodationBooking {
  const data = db();
  const booking = requireOne(ctx, "AccommodationBooking", data.accommodationBookings, bookingId);
  authorizeOn(ctx, "checkout", "AccommodationBooking", booking);

  if (booking.status !== "checked_in") {
    throw new ConflictError("Зөвхөн бүртгэгдсэн зочныг гаргах боломжтой.");
  }

  booking.status = "checked_out";
  booking.checkedOutAt = new Date().toISOString();
  booking.checkedOutBy = ctx.auth.userId;
  return booking;
}

export function cancelBooking(ctx: DataContext, bookingId: string): AccommodationBooking {
  const data = db();
  const booking = requireOne(ctx, "AccommodationBooking", data.accommodationBookings, bookingId);
  authorizeOn(ctx, "update", "AccommodationBooking", booking);

  if (booking.status === "checked_in") {
    throw new ConflictError("Бүртгэгдсэн зочны захиалгыг цуцлах боломжгүй. Эхлээд гаргана уу.");
  }
  // Preserved, not deleted: the history of what was planned still matters.
  booking.status = "cancelled";
  return booking;
}
