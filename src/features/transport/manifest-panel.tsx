"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BusFront, Check, Loader2, QrCode, UserPlus, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/misc";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { recordBoardingAction } from "@/server/actions/transport";
import { formatTime } from "@/lib/format";
import { PASSENGER_KEY, PASSENGER_TONE, TRIP_KEY, TRIP_TONE } from "./status";
import { LegLoadBar } from "./leg-load-bar";
import type { TripManifest } from "@/server/services/transport";

export function ManifestPanel({
  manifest,
  loading,
  orgSlug,
  onBook,
  canManage,
}: {
  manifest: TripManifest | null;
  loading: boolean;
  orgSlug: string;
  onBook: () => void;
  canManage: boolean;
}) {
  const t = useTranslations("transport");
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const record = (passengerId: string, eventType: "boarded" | "no_show") => {
    setPendingId(passengerId);
    void recordBoardingAction({ passengerId, eventType }, orgSlug).then((result) => {
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error ?? "");
        return;
      }
      toast.success(eventType === "boarded" ? t("boardedToast") : t("noShowToast"));
      router.refresh();
    });
  };

  if (loading) {
    return (
      <aside className="hidden w-96 shrink-0 flex-col border-l border-line bg-surface p-4 lg:flex">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-24" />
        <div className="mt-4 space-y-1.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </aside>
    );
  }

  if (!manifest) {
    return (
      <aside className="hidden w-96 shrink-0 flex-col border-l border-line bg-surface lg:flex">
        <EmptyState icon={BusFront} title={t("selectTrip")} description={t("selectTripHint")} />
      </aside>
    );
  }

  const { trip } = manifest;
  const active = trip.status !== "cancelled" && trip.status !== "arrived";

  return (
    <aside className="hidden w-96 shrink-0 flex-col overflow-hidden border-l border-line bg-surface lg:flex">
      <div className="border-b border-line p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-md font-semibold tracking-tight text-text">
              {trip.routeName}
            </h2>
            <p className="tnum mt-0.5 truncate text-2xs text-text-3">
              {formatTime(trip.departureAt)} → {formatTime(trip.estimatedArrivalAt)}
              {trip.vehicleRegistration ? ` · ${trip.vehicleRegistration}` : ""}
            </p>
          </div>
          <StatusChip tone={TRIP_TONE[trip.status]}>{t(TRIP_KEY[trip.status])}</StatusChip>
        </div>

        {/* Booked and boarded are shown as separate figures, never summed. */}
        <dl className="mt-3 grid grid-cols-3 gap-2">
          {[
            [t("booked"), trip.booked, "text-plan"],
            [t("boarded"), trip.boarded, "text-ok"],
            [t("noShow"), trip.noShows, trip.noShows > 0 ? "text-danger" : "text-text-3"],
          ].map(([label, value, tone]) => (
            <div
              key={String(label)}
              className="rounded-[var(--radius-card)] border border-line bg-surface-inset p-2"
            >
              <dt className="truncate text-2xs text-text-3">{label}</dt>
              <dd className={`tnum text-lg font-semibold ${tone}`}>{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-3">
          <p className="mb-1 text-2xs text-text-3">{t("legLoads")}</p>
          <LegLoadBar legs={trip.legs} capacity={trip.seatingCapacity} />
        </div>

        {canManage && active && (
          <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={onBook}>
            <UserPlus /> {t("bookSeat")}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {manifest.passengers.length === 0 ? (
          <EmptyState icon={UserX} title={t("manifestEmpty")} />
        ) : (
          <ul className="divide-y divide-line-soft">
            {manifest.passengers.map((passenger) => {
              const busy = pendingId === passenger.id;
              const canRecord =
                manifest.canBoard &&
                active &&
                passenger.status === "booked";

              return (
                <li key={passenger.id} className="flex items-center gap-2 px-3 py-1.5">
                  <Avatar
                    name={passenger.displayName}
                    tone={passenger.avatarColor as StatusTone}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-text">
                      {passenger.displayName}
                    </span>
                    <span className="block truncate text-2xs text-text-3">
                      {passenger.boardingStopName} → {passenger.destinationStopName}
                    </span>
                  </span>

                  {passenger.scannedCode && (
                    <Tooltip content={t("scanned")}>
                      <QrCode className="size-3 shrink-0 text-text-3" aria-label={t("scanned")} />
                    </Tooltip>
                  )}

                  {passenger.boardedAt ? (
                    <span className="tnum shrink-0 text-2xs text-ok">
                      {formatTime(passenger.boardedAt)}
                    </span>
                  ) : (
                    <StatusChip
                      tone={PASSENGER_TONE[passenger.status]}
                      dot={false}
                      className="shrink-0"
                    >
                      {t(PASSENGER_KEY[passenger.status])}
                    </StatusChip>
                  )}

                  {canRecord && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Tooltip content={t("markNoShow")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          aria-label={t("markNoShow")}
                          onClick={() => record(passenger.id, "no_show")}
                        >
                          <UserX className="text-danger" />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t("boardPassenger")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          aria-label={t("boardPassenger")}
                          onClick={() => record(passenger.id, "boarded")}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <Check className="text-ok" />}
                        </Button>
                      </Tooltip>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
