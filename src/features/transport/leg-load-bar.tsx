"use client";

import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TripLegLoad } from "@/server/services/transport";

/**
 * Occupancy along the route, one segment per leg.
 *
 * A single "42/45" figure cannot express the thing that actually matters:
 * *where* the bus is full. This renders each leg at its own fill, so a
 * coordinator can see at a glance that the first stretch is packed and the
 * last is empty — which is the difference between needing a second vehicle
 * for one leg and needing one for the whole run.
 */
export function LegLoadBar({
  legs,
  capacity,
  compact,
}: {
  legs: TripLegLoad[];
  capacity: number | null;
  compact?: boolean;
}) {
  const t = useTranslations("transport");

  if (legs.length === 0 || !capacity) {
    return <span className="text-2xs text-text-3">{t("noVehicle")}</span>;
  }

  return (
    <span className={cn("flex items-stretch gap-px", compact ? "h-3" : "h-5")}>
      {legs.map((leg) => {
        const ratio = Math.min(1, leg.occupancy / capacity);
        const full = leg.occupancy >= capacity;
        const nearlyFull = !full && ratio >= 0.9;

        return (
          <Tooltip
            key={`${leg.fromSeq}-${leg.toSeq}`}
            content={
              <span className="whitespace-nowrap">
                {leg.fromName} → {leg.toName}
                {" · "}
                <span className="tnum">
                  {leg.occupancy}/{capacity}
                </span>
              </span>
            }
          >
            <span
              className={cn(
                "relative flex-1 overflow-hidden rounded-[2px] bg-surface-inset",
                full && "ring-1 ring-inset ring-danger",
              )}
            >
              <span
                className={cn(
                  "absolute bottom-0 left-0 w-full",
                  // Colour is state: full is a problem, nearly full is a
                  // warning, everything else is just information.
                  full ? "bg-danger" : nearlyFull ? "bg-warn" : "bg-accent/70",
                )}
                style={{ height: `${Math.max(ratio * 100, leg.occupancy > 0 ? 8 : 0)}%` }}
              />
              {!compact && (
                <span className="tnum relative flex h-full items-center justify-center text-[9px] font-medium text-text">
                  {leg.occupancy}
                </span>
              )}
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}
