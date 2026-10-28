import { beforeEach, describe, expect, it } from "vitest";
import { buildAbility } from "@/lib/authz/ability";
import type { AuthContext } from "@/lib/authz/types";
import type { DataContext } from "@/server/db/query";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { db, resetDb } from "@/server/db/store";
import { SEED_ORG_A, SEED_ORG_B } from "@/server/db/seed";
import {
  cancelBooking,
  checkInBooking,
  checkOutBooking,
  createBooking,
  getCampBoard,
} from "../camps";

function ctxFor(roleIds: string[], extra: Partial<AuthContext> = {}): DataContext {
  const auth: AuthContext = {
    userId: "u",
    organizationId: SEED_ORG_A,
    employeeId: null,
    roleIds,
    siteIds: [],
    campIds: [],
    orgUnitPath: null,
    isPlatformAdmin: false,
    permVersion: 1,
    ...extra,
  };
  return { auth, ability: buildAbility(auth) };
}

const manager = (camps = ["camp_ot_main", "camp_ot_west"]) =>
  ctxFor(["camp.manager"], { campIds: camps });
const admin = () => ctxFor(["org.admin"]);

const freeBed = () => {
  const taken = new Set(
    db()
      .accommodationBookings.filter((b) => b.status === "reserved" || b.status === "checked_in")
      .map((b) => b.bedId),
  );
  return db().beds.find(
    (b) => b.campId === "camp_ot_main" && b.status === "available" && !taken.has(b.id),
  )!;
};
const anEmployee = () => db().employees.find((e) => e.organizationId === SEED_ORG_A)!;

const WINDOW = { startAt: "2026-12-01T00:00:00.000Z", endAt: "2026-12-10T00:00:00.000Z" };

beforeEach(() => resetDb());

describe("camp board", () => {
  it("separates actual occupancy from reservations", () => {
    const board = getCampBoard(admin(), {});
    const camp = board.camps.find((c) => c.occupied > 0)!;
    expect(camp.occupied).toBeGreaterThan(0);
    expect(camp.reserved).toBeGreaterThanOrEqual(0);
    // They are different quantities and must never be summed into "in camp".
    expect(camp.occupied + camp.reserved).toBeLessThanOrEqual(camp.serviceable);
  });

  it("never counts an out-of-service bed as free", () => {
    const board = getCampBoard(admin(), {});
    for (const camp of board.camps) {
      expect(camp.serviceable + camp.unavailable).toBe(camp.totalBeds);
      expect(camp.free).toBeLessThanOrEqual(camp.serviceable);
    }
  });

  it("shows a camp manager only their assigned camps", () => {
    const board = getCampBoard(manager(["camp_ot_main"]), {});
    expect(board.camps.map((c) => c.camp.id)).toEqual(["camp_ot_main"]);
    for (const slot of board.slots) {
      expect(db().beds.find((b) => b.id === slot.bedId)!.campId).toBe("camp_ot_main");
    }
  });

  it("reports booking and check-in rights separately", () => {
    const board = getCampBoard(manager(), {});
    expect(board.canBook).toBe(true);
    expect(board.canCheckIn).toBe(true);

    const planner = getCampBoard(ctxFor(["roster.planner"]), {});
    expect(planner.canBook).toBe(false);
    expect(planner.canCheckIn).toBe(false);
  });

  it("filters to beds with no occupying booking across the window", () => {
    const board = getCampBoard(admin(), { campId: "camp_ot_main", freeOnly: true, days: 14 });
    for (const slot of board.slots) {
      expect(slot.bedStatus).toBe("available");
      expect(slot.bookings.some((b) => b.status === "reserved" || b.status === "checked_in")).toBe(
        false,
      );
    }
  });

  it("only returns bookings that intersect the requested window", () => {
    const board = getCampBoard(admin(), { campId: "camp_ot_main", days: 7 });
    for (const slot of board.slots) {
      for (const booking of slot.bookings) {
        expect(booking.startAt < board.rangeEnd).toBe(true);
        expect(booking.endAt > board.rangeStart).toBe(true);
      }
    }
  });
});

describe("creating a booking", () => {
  it("creates a reservation, not an arrival", () => {
    const ctx = manager();
    const booking = createBooking(ctx, {
      bedId: freeBed().id,
      employeeId: anEmployee().id,
      ...WINDOW,
    });

    expect(booking.status).toBe("reserved");
    // The distinction this module exists to protect.
    expect(booking.checkedInAt).toBeNull();
    expect(booking.checkedInBy).toBeNull();
  });

  it("refuses an overlapping reservation on the same bed", () => {
    const ctx = manager();
    const bed = freeBed();
    createBooking(ctx, { bedId: bed.id, employeeId: anEmployee().id, ...WINDOW });

    expect(() =>
      createBooking(ctx, {
        bedId: bed.id,
        employeeId: anEmployee().id,
        startAt: "2026-12-05T00:00:00.000Z",
        endAt: "2026-12-15T00:00:00.000Z",
      }),
    ).toThrow(ConflictError);
  });

  it("allows a back-to-back booking — the range is half-open", () => {
    const ctx = manager();
    const bed = freeBed();
    createBooking(ctx, { bedId: bed.id, employeeId: anEmployee().id, ...WINDOW });

    expect(() =>
      createBooking(ctx, {
        bedId: bed.id,
        employeeId: anEmployee().id,
        startAt: WINDOW.endAt,
        endAt: "2026-12-20T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("refuses an inverted or empty window", () => {
    const ctx = manager();
    const bed = freeBed();
    expect(() =>
      createBooking(ctx, {
        bedId: bed.id,
        employeeId: anEmployee().id,
        startAt: WINDOW.endAt,
        endAt: WINDOW.startAt,
      }),
    ).toThrow(ValidationError);
  });

  it("refuses a bed that is out of service", () => {
    const ctx = admin();
    const bed = db().beds.find((b) => b.status !== "available")!;
    expect(() =>
      createBooking(ctx, { bedId: bed.id, employeeId: anEmployee().id, ...WINDOW }),
    ).toThrow(ConflictError);
  });

  it("is idempotent for a repeated request key", () => {
    const ctx = manager();
    const bed = freeBed();
    const input = {
      bedId: bed.id,
      employeeId: anEmployee().id,
      ...WINDOW,
      idempotencyKey: "req-123",
    };
    const before = db().accommodationBookings.length;

    const first = createBooking(ctx, input);
    const second = createBooking(ctx, input);

    expect(second.id).toBe(first.id);
    expect(db().accommodationBookings.length).toBe(before + 1);
  });

  it("refuses a camp the manager is not assigned to", () => {
    const ctx = manager(["camp_ot_west"]);
    const bed = freeBed(); // camp_ot_main
    expect(() =>
      createBooking(ctx, { bedId: bed.id, employeeId: anEmployee().id, ...WINDOW }),
    ).toThrow(NotFoundError);
  });

  it("refuses another tenant's bed as non-existent", () => {
    const ctx = ctxFor(["org.admin"], { organizationId: SEED_ORG_B });
    const bed = freeBed();
    expect(() =>
      createBooking(ctx, { bedId: bed.id, employeeId: anEmployee().id, ...WINDOW }),
    ).toThrow(NotFoundError);
  });
});

describe("check-in and check-out are events, not states of the booking window", () => {
  it("records who checked the guest in and when", () => {
    const ctx = manager();
    const booking = createBooking(ctx, {
      bedId: freeBed().id,
      employeeId: anEmployee().id,
      ...WINDOW,
    });

    const checkedIn = checkInBooking(ctx, booking.id);
    expect(checkedIn.status).toBe("checked_in");
    expect(checkedIn.checkedInAt).toBeTruthy();
    expect(checkedIn.checkedInBy).toBe("u");
    // The planned window is untouched by the actual event.
    expect(checkedIn.startAt).toBe(WINDOW.startAt);
  });

  it("refuses a second check-in", () => {
    const ctx = manager();
    const booking = createBooking(ctx, {
      bedId: freeBed().id,
      employeeId: anEmployee().id,
      ...WINDOW,
    });
    checkInBooking(ctx, booking.id);
    expect(() => checkInBooking(ctx, booking.id)).toThrow(ConflictError);
  });

  it("refuses check-out for someone who never checked in", () => {
    const ctx = manager();
    const booking = createBooking(ctx, {
      bedId: freeBed().id,
      employeeId: anEmployee().id,
      ...WINDOW,
    });
    expect(() => checkOutBooking(ctx, booking.id)).toThrow(ConflictError);
  });

  it("frees the bed after check-out", () => {
    const ctx = manager();
    const bed = freeBed();
    const booking = createBooking(ctx, { bedId: bed.id, employeeId: anEmployee().id, ...WINDOW });
    checkInBooking(ctx, booking.id);
    checkOutBooking(ctx, booking.id);

    expect(() =>
      createBooking(ctx, {
        bedId: bed.id,
        employeeId: anEmployee().id,
        startAt: "2026-12-03T00:00:00.000Z",
        endAt: "2026-12-08T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("refuses check-in at a camp outside the manager's scope", () => {
    const booking = createBooking(manager(), {
      bedId: freeBed().id,
      employeeId: anEmployee().id,
      ...WINDOW,
    });
    const otherCamp = manager(["camp_gs"]);
    expect(() => checkInBooking(otherCamp, booking.id)).toThrow(NotFoundError);
  });

  it("refuses check-in to a role without the permission", () => {
    const booking = createBooking(manager(), {
      bedId: freeBed().id,
      employeeId: anEmployee().id,
      ...WINDOW,
    });
    const hr = ctxFor(["hr.manager"]);
    expect(() => checkInBooking(hr, booking.id)).toThrow();
  });
});

describe("cancellation preserves history", () => {
  it("marks cancelled rather than deleting", () => {
    const ctx = manager();
    const before = db().accommodationBookings.length;
    const booking = createBooking(ctx, {
      bedId: freeBed().id,
      employeeId: anEmployee().id,
      ...WINDOW,
    });

    cancelBooking(ctx, booking.id);

    expect(db().accommodationBookings.length).toBe(before + 1);
    expect(db().accommodationBookings.find((b) => b.id === booking.id)!.status).toBe("cancelled");
  });

  it("refuses to cancel someone who is physically checked in", () => {
    const ctx = manager();
    const booking = createBooking(ctx, {
      bedId: freeBed().id,
      employeeId: anEmployee().id,
      ...WINDOW,
    });
    checkInBooking(ctx, booking.id);
    expect(() => cancelBooking(ctx, booking.id)).toThrow(ConflictError);
  });

  it("releases the bed once cancelled", () => {
    const ctx = manager();
    const bed = freeBed();
    const booking = createBooking(ctx, { bedId: bed.id, employeeId: anEmployee().id, ...WINDOW });
    cancelBooking(ctx, booking.id);

    expect(() =>
      createBooking(ctx, { bedId: bed.id, employeeId: anEmployee().id, ...WINDOW }),
    ).not.toThrow();
  });
});

describe("window dates", () => {
  it("reports the window start as a local calendar date, not a sliced UTC instant", () => {
    const board = getCampBoard(admin(), { from: "2026-12-01", days: 7 });
    // East of UTC, slicing the instant yields the previous day — which made
    // the date picker and the grid header disagree.
    expect(board.fromDate).toBe("2026-12-01");
    expect(board.dates[0]).toBe("2026-12-01");
    expect(board.dates).toHaveLength(7);
    expect(board.dates.at(-1)).toBe("2026-12-07");
  });

  it("clamps the window length to a sane range", () => {
    expect(getCampBoard(admin(), { days: 200 }).dates.length).toBe(45);
    expect(getCampBoard(admin(), { days: 0 }).dates.length).toBe(1);
  });
});
