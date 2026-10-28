"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { ROW_HEIGHT, useDensity } from "@/components/app/density";
import type { BedSlot, BedBookingView } from "@/server/services/camps";

const BED_COL = 190;

/**
 * Booking status drives colour, and planned is visually distinct from actual.
 *
 * `reserved` is outlined; `checked_in` is filled. The difference has to be
 * legible at a glance, because "we have 312 reservations" and "312 people are
 * here" are different operational facts.
 */
const STATUS_STYLE: Record<BedBookingView["status"], string> = {
  reserved: "border border-dashed border-plan bg-plan-soft text-plan",
  checked_in: "bg-ok-soft border border-ok/40 text-ok",
  checked_out: "bg-neutral-soft border border-line text-text-3",
  no_show: "bg-danger-soft border border-danger/40 text-danger",
  cancelled: "bg-transparent border border-dashed border-line text-text-3 line-through",
};

export function BedTimeline({
  slots,
  dates,
  rangeStart,
  rangeEnd,
  onSelectBooking,
  onSelectEmptyBed,
  selectedBookingId,
}: {
  slots: BedSlot[];
  dates: string[];
  rangeStart: string;
  rangeEnd: string;
  onSelectBooking: (booking: BedBookingView, slot: BedSlot) => void;
  onSelectEmptyBed: (slot: BedSlot) => void;
  selectedBookingId: string | null;
}) {
  const t = useTranslations("camp");
  const { density } = useDensity();
  const rowHeight = ROW_HEIGHT[density];
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: slots.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });
  React.useEffect(() => virtualizer.measure(), [rowHeight, virtualizer]);

  const startMs = Date.parse(rangeStart);
  const endMs = Date.parse(rangeEnd);
  const span = endMs - startMs;

  /** Clamp a booking to the visible window and express it as percentages. */
  const bar = (booking: BedBookingView) => {
    const from = Math.max(Date.parse(booking.startAt), startMs);
    const to = Math.min(Date.parse(booking.endAt), endMs);
    return {
      left: ((from - startMs) / span) * 100,
      width: Math.max(((to - from) / span) * 100, 1.5),
      clippedStart: Date.parse(booking.startAt) < startMs,
      clippedEnd: Date.parse(booking.endAt) > endMs,
    };
  };

  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
      <div className="min-w-[760px]">
        {/* ---- date header ------------------------------------------------ */}
        <div className="sticky top-0 z-20 flex border-b border-line bg-canvas">
          <div
            style={{ width: BED_COL }}
            className="sticky left-0 z-10 shrink-0 border-r border-line bg-canvas px-[var(--cell-px)] py-1.5 text-2xs font-semibold uppercase tracking-wider text-text-3"
          >
            {t("bed")}
          </div>
          <div className="relative flex flex-1">
            {dates.map((date) => {
              const day = parseISO(date);
              const weekday = day.getDay();
              return (
                <div
                  key={date}
                  className={cn(
                    "flex-1 border-r border-line-soft px-0.5 py-1 text-center",
                    (weekday === 0 || weekday === 6) && "bg-surface-inset",
                  )}
                >
                  <div className="text-2xs leading-none text-text-3">
                    {["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"][weekday]}
                  </div>
                  <div className="tnum text-xs font-medium leading-tight text-text-2">
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- bed rows --------------------------------------------------- */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const slot = slots[virtualRow.index];
            const unavailable = slot.bedStatus !== "available" || slot.roomStatus !== "available";
            const occupied = slot.bookings.some(
              (b) => b.status === "reserved" || b.status === "checked_in",
            );

            return (
              <div
                key={slot.bedId}
                className="absolute left-0 flex w-full border-b border-line-soft"
                style={{ top: virtualRow.start, height: rowHeight }}
              >
                <div
                  style={{ width: BED_COL }}
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-canvas px-[var(--cell-px)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-text">
                      {slot.roomNumber}
                      <span className="text-text-3">·{slot.bedCode.split("-").pop()}</span>
                    </span>
                    {density !== "dense" && (
                      <span className="block truncate text-2xs text-text-3">
                        {slot.buildingName} · {t(slot.roomType === "single" ? "bed" : "room")}{" "}
                        {slot.roomType}
                      </span>
                    )}
                  </span>
                  {slot.housekeeping === "dirty" && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-warn"
                      title={t("dirty")}
                      aria-label={t("dirty")}
                    />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => !unavailable && !occupied && onSelectEmptyBed(slot)}
                  disabled={unavailable}
                  aria-label={`${slot.roomNumber} ${slot.bedCode}`}
                  className={cn(
                    "relative flex-1 text-left",
                    // Maintenance is hatched, so it never reads as "free".
                    unavailable &&
                      "cursor-not-allowed bg-[repeating-linear-gradient(135deg,var(--line),var(--line)2px,transparent_2px,transparent_7px)]",
                    !unavailable && !occupied && "hover:bg-accent-soft/40",
                  )}
                >
                  {/* day gridlines */}
                  <span aria-hidden className="pointer-events-none absolute inset-0 flex">
                    {dates.map((date) => (
                      <span key={date} className="flex-1 border-r border-line-soft/60" />
                    ))}
                  </span>

                  {slot.bookings.map((booking) => {
                    const geometry = bar(booking);
                    return (
                      <span
                        key={booking.id}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectBooking(booking, slot);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectBooking(booking, slot);
                          }
                        }}
                        className={cn(
                          "absolute inset-y-[3px] flex cursor-pointer items-center overflow-hidden rounded-[3px] px-1 text-2xs font-medium",
                          STATUS_STYLE[booking.status],
                          selectedBookingId === booking.id && "ring-2 ring-accent",
                          // A stay running past the window edge is squared off,
                          // so a clipped bar never reads as a short stay.
                          geometry.clippedStart && "rounded-l-none",
                          geometry.clippedEnd && "rounded-r-none",
                        )}
                        style={{ left: `${geometry.left}%`, width: `${geometry.width}%` }}
                        title={`${booking.personName ?? ""} · ${t(statusKey(booking.status))}`}
                      >
                        <span className="truncate">{booking.personName ?? "—"}</span>
                      </span>
                    );
                  })}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function statusKey(status: BedBookingView["status"]) {
  switch (status) {
    case "reserved": return "reserved";
    case "checked_in": return "checkedIn";
    case "checked_out": return "checkedOut";
    case "no_show": return "noShow";
    case "cancelled": return "cancelled";
  }
}

export { BED_COL };
