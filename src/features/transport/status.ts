import type { TripStatus, PassengerStatus } from "@/server/db/schema";
import type { StatusTone } from "@/components/ui/status-chip";

export const TRIP_TONE: Record<TripStatus, StatusTone> = {
  scheduled: "plan",
  boarding: "accent",
  departed: "accent",
  arrived: "ok",
  cancelled: "neutral",
  delayed: "warn",
};

export const TRIP_KEY: Record<TripStatus, string> = {
  scheduled: "statusScheduled",
  boarding: "statusBoarding",
  departed: "statusDeparted",
  arrived: "statusArrived",
  cancelled: "statusCancelled",
  delayed: "statusDelayed",
};

/**
 * Passenger states.
 *
 * `booked` and `boarded` are deliberately different tones: one is a plan and
 * the other is an observed fact, and a manifest that renders them alike
 * invites someone to treat the list of bookings as a list of people on board.
 */
export const PASSENGER_TONE: Record<PassengerStatus, StatusTone> = {
  booked: "plan",
  boarded: "ok",
  arrived: "ok",
  no_show: "danger",
  cancelled: "neutral",
};

export const PASSENGER_KEY: Record<PassengerStatus, string> = {
  booked: "booked",
  boarded: "boarded",
  arrived: "boarded",
  no_show: "noShow",
  cancelled: "statusCancelled",
};
