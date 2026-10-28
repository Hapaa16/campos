"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { parseAsBoolean, parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { BusFront, EyeOff, Search, TriangleAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Avatar } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/app/page-header";
import { StatTile } from "@/components/data/stat-tile";
import { useDebouncedSearch } from "@/lib/use-debounced-search";
import { formatDate, formatTime } from "@/lib/format";
import { LegLoadBar } from "./leg-load-bar";
import { ManifestPanel } from "./manifest-panel";
import { BookSeatDialog } from "./book-seat-dialog";
import { TRIP_KEY, TRIP_TONE } from "./status";
import { loadManifestAction } from "@/server/actions/transport";
import type { TransportBoard, TripManifest, TripView } from "@/server/services/transport";
import { cn } from "@/lib/utils";

export function TransportView({ data, orgSlug }: { data: TransportBoard; orgSlug: string }) {
  const t = useTranslations("transport");
  const tc = useTranslations("common");

  const [params, setParams] = useQueryStates(
    {
      from: parseAsString.withDefault(data.from),
      days: parseAsInteger.withDefault(data.days),
      route: parseAsString.withDefault(""),
      q: parseAsString.withDefault(""),
      full: parseAsBoolean.withDefault(false),
    },
    { shallow: false, history: "replace" },
  );

  const commitSearch = React.useCallback((q: string) => void setParams({ q }), [setParams]);
  const [search, setSearch] = useDebouncedSearch(params.q, commitSearch);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [manifest, setManifest] = React.useState<TripManifest | null>(null);
  const [loadingManifest, setLoadingManifest] = React.useState(false);
  const [booking, setBooking] = React.useState<TripView | null>(null);

  const select = (trip: TripView) => {
    setSelectedId(trip.id);
    setManifest(null);
    setLoadingManifest(true);
    void loadManifestAction(trip.id).then((result) => {
      setManifest(result);
      setLoadingManifest(false);
    });
  };

  const demandToday = data.mobilisation?.[0];
  const shortfall =
    data.mobilisation?.reduce((sum, day) => sum + day.unbooked.length, 0) ?? null;

  return (
    <>
      <PageHeader
        pageKey="transport"
        title={t("title")}
        meta={`${data.trips.length} ${t("trips").toLowerCase()}`}
        actions={
          shortfall !== null && shortfall > 0 ? (
            <StatusChip tone="warn">
              {shortfall} {t("unbooked").toLowerCase()}
            </StatusChip>
          ) : null
        }
      />

      <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-line p-3 sm:grid-cols-4">
        <StatTile
          label={t("fleet")}
          value={data.fleet.active}
          unit={`/ ${data.fleet.total}`}
          hint={`${data.fleet.contracted} ${t("contracted").toLowerCase()}`}
          icon={BusFront}
        />
        <StatTile
          label={t("inbound")}
          value={demandToday?.inboundBooked ?? "—"}
          unit={demandToday ? `/ ${demandToday.inboundPlanned}` : undefined}
          hint={t("mobilisation")}
          tone={
            demandToday && demandToday.inboundBooked < demandToday.inboundPlanned
              ? "warn"
              : undefined
          }
        />
        <StatTile
          label={t("outbound")}
          value={demandToday?.outboundBooked ?? "—"}
          unit={demandToday ? `/ ${demandToday.outboundPlanned}` : undefined}
          hint={t("mobilisation")}
          tone={
            demandToday && demandToday.outboundBooked < demandToday.outboundPlanned
              ? "warn"
              : undefined
          }
        />
        <StatTile
          label={t("incidents")}
          value={data.trips.reduce((sum, trip) => sum + trip.incidentCount, 0)}
          icon={TriangleAlert}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        <Input
          type="date"
          value={params.from}
          onChange={(e) => void setParams({ from: e.target.value })}
          aria-label={tc("from")}
          className="h-[var(--control-h-sm)] w-36"
        />
        <Select value={String(params.days)} onValueChange={(days) => void setParams({ days: Number(days) })}>
          <SelectTrigger className="h-[var(--control-h-sm)] w-24" aria-label={tc("filter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 3, 7, 14].map((d) => (
              <SelectItem key={d} value={String(d)}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.route || "__all__"}
          onValueChange={(route) => void setParams({ route: route === "__all__" ? "" : route })}
        >
          <SelectTrigger className="h-[var(--control-h-sm)] w-56" aria-label={t("route")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{tc("all")}</SelectItem>
            {data.routes.map((route) => (
              <SelectItem key={route.id} value={route.id}>
                {route.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-3" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tc("searchPlaceholder")}
            aria-label={tc("search")}
            className="h-[var(--control-h-sm)] w-44 pl-7"
          />
        </div>

        <Button
          variant={params.full ? "subtle" : "ghost"}
          size="sm"
          onClick={() => void setParams({ full: !params.full })}
        >
          <Users /> {t("fullOnly")}
        </Button>

        <span className="ml-auto max-w-sm text-2xs leading-tight text-text-3">{t("legNote")}</span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {data.trips.length === 0 ? (
            <EmptyState icon={BusFront} title={t("empty")} description={t("emptyHint")} />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-line bg-canvas text-left text-2xs uppercase tracking-wider text-text-3">
                  <th className="px-3 py-2 font-semibold">{t("route")}</th>
                  <th className="w-24 px-3 py-2 font-semibold">{t("departure")}</th>
                  <th className="w-32 px-3 py-2 font-semibold">{t("vehicle")}</th>
                  <th className="w-36 px-3 py-2 font-semibold">{t("legLoads")}</th>
                  <th className="w-20 px-3 py-2 text-right font-semibold">{t("seats")}</th>
                  <th className="w-28 px-3 py-2 font-semibold">{tc("status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {data.trips.map((trip) => {
                  const full =
                    trip.seatingCapacity !== null && trip.peakOccupancy >= trip.seatingCapacity;
                  return (
                    <tr
                      key={trip.id}
                      onClick={() => select(trip)}
                      className={cn(
                        "ui-transition cursor-pointer",
                        selectedId === trip.id ? "bg-accent-soft" : "hover:bg-surface-3",
                      )}
                    >
                      <td className="px-3 py-1.5">
                        <span className="block truncate text-text">{trip.routeName}</span>
                        <span className="block truncate font-mono text-2xs text-text-3">
                          {trip.routeCode}
                          {trip.driverName ? ` · ${trip.driverName}` : ""}
                        </span>
                      </td>
                      <td className="tnum px-3 py-1.5 text-text-2">
                        <span className="block">{formatTime(trip.departureAt)}</span>
                        <span className="block text-2xs text-text-3">
                          {formatDate(trip.departureAt)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        {trip.vehicleRegistration ? (
                          <>
                            <span className="block truncate font-mono text-xs text-text-2">
                              {trip.vehicleRegistration}
                            </span>
                            {trip.vehicleOwnership === "contracted" && (
                              // A contractor's bus is not our bus, and the
                              // distinction matters for cost and liability.
                              <span className="block truncate text-2xs text-warn">
                                {trip.providerName}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-2xs text-text-3">{t("noVehicle")}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <LegLoadBar legs={trip.legs} capacity={trip.seatingCapacity} compact />
                      </td>
                      <td className="tnum px-3 py-1.5 text-right">
                        <span className={full ? "text-danger" : "text-text-2"}>
                          {trip.peakOccupancy}
                        </span>
                        <span className="text-text-3">/{trip.seatingCapacity ?? "—"}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1">
                          <StatusChip tone={TRIP_TONE[trip.status]}>
                            {t(TRIP_KEY[trip.status])}
                          </StatusChip>
                          {trip.delayMinutes ? (
                            <Tooltip content={t("delayedBy", { minutes: trip.delayMinutes })}>
                              <TriangleAlert className="size-3 shrink-0 text-warn" />
                            </Tooltip>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <MobilisationPanel data={data} />
        </div>

        <ManifestPanel
          manifest={manifest}
          loading={loadingManifest}
          orgSlug={orgSlug}
          canManage={data.canManage}
          onBook={() => setBooking(manifest?.trip ?? null)}
        />
      </div>

      <BookSeatDialog
        trip={booking}
        orgSlug={orgSlug}
        onOpenChange={(open) => !open && setBooking(null)}
      />
    </>
  );
}

/** What the roster says must move, against what has actually been booked. */
function MobilisationPanel({ data }: { data: TransportBoard }) {
  const t = useTranslations("transport");

  if (data.mobilisation === null) {
    return (
      <div className="border-t border-line p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <EyeOff className="size-3.5 text-text-3" aria-hidden />
          {t("mobilisation")}
        </h3>
        {/* Not "0 to move" — a figure this role may not compute is unknown. */}
        <p className="mt-1 text-2xs text-text-3">{t("mobilisationUnknown")}</p>
      </div>
    );
  }

  const days = data.mobilisation.filter((d) => d.inboundPlanned + d.outboundPlanned > 0);
  if (days.length === 0) return null;

  return (
    <div className="border-t border-line p-4">
      <h3 className="text-sm font-semibold text-text">{t("mobilisation")}</h3>
      <p className="mt-0.5 text-2xs text-text-3">{t("mobilisationNote")}</p>

      <div className="mt-3 space-y-2">
        {days.map((day) => {
          const gap = day.unbooked.length;
          return (
            <div
              key={day.date}
              className="rounded-[var(--radius-card)] border border-line bg-surface-inset p-2.5"
            >
              <div className="flex items-center gap-3">
                <span className="tnum text-xs font-medium text-text">{formatDate(day.date)}</span>
                <span className="tnum text-2xs text-text-3">
                  ↓ {day.inboundBooked}/{day.inboundPlanned} · ↑ {day.outboundBooked}/
                  {day.outboundPlanned}
                </span>
                {gap > 0 ? (
                  <StatusChip tone="warn" className="ml-auto">
                    {gap} {t("unbooked").toLowerCase()}
                  </StatusChip>
                ) : (
                  <StatusChip tone="ok" className="ml-auto" dot={false}>
                    {t("noUnbooked")}
                  </StatusChip>
                )}
              </div>

              {gap > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {day.unbooked.slice(0, 12).map((person) => (
                    <li
                      key={person.employeeId}
                      className="flex items-center gap-1 rounded-[var(--radius-chip)] border border-line px-1.5 py-0.5"
                    >
                      <Avatar
                        name={person.displayName}
                        tone={person.avatarColor as StatusTone}
                        size="xs"
                      />
                      <span className="text-2xs text-text-2">{person.displayName}</span>
                      <span className="text-2xs text-text-3">
                        {person.direction === "in" ? "↓" : "↑"}
                      </span>
                    </li>
                  ))}
                  {gap > 12 && <li className="text-2xs text-text-3">+{gap - 12}</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
