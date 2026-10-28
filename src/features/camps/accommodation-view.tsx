"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { parseAsBoolean, parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { toast } from "sonner";
import { Bed, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { useDebouncedSearch } from "@/lib/use-debounced-search";
import { StatTile, CapacityBar } from "@/components/data/stat-tile";
import { BedTimeline } from "./bed-timeline";
import { BookingDialog } from "./booking-dialog";
import { BookingPanel } from "./booking-panel";
import type { BedBookingView, BedSlot, CampBoardData } from "@/server/services/camps";

export function AccommodationView({
  data,
  orgSlug,
}: {
  data: CampBoardData;
  orgSlug: string;
}) {
  const t = useTranslations("camp");
  const tc = useTranslations("common");
  const router = useRouter();

  const [params, setParams] = useQueryStates(
    {
      camp: parseAsString.withDefault(data.selectedCampId ?? ""),
      building: parseAsString.withDefault(""),
      from: parseAsString.withDefault(""),
      days: parseAsInteger.withDefault(14),
      free: parseAsBoolean.withDefault(false),
      q: parseAsString.withDefault(""),
    },
    { shallow: false, history: "replace" },
  );

  const commitSearch = React.useCallback(
    (q: string) => void setParams({ q }),
    [setParams],
  );
  const [search, setSearch] = useDebouncedSearch(params.q, commitSearch);

  const [booking, setBooking] = React.useState<{ booking: BedBookingView; slot: BedSlot } | null>(null);
  const [bookingSlot, setBookingSlot] = React.useState<BedSlot | null>(null);

  const summary = data.camps.find((c) => c.camp.id === data.selectedCampId);

  const done = (message: string) => {
    toast.success(message);
    router.refresh();
  };

  if (data.camps.length === 0) {
    return (
      <>
        <PageHeader pageKey="accommodation" title={t("accommodationTitle")} />
        <EmptyState className="flex-1" icon={Bed} title={t("noCampAccess")} />
      </>
    );
  }

  return (
    <>
      <PageHeader pageKey="accommodation" title={t("accommodationTitle")}
        meta={summary ? `${summary.camp.name} · ${summary.siteName ?? ""}` : undefined}
      />

      {/* ---- camp summary strip ------------------------------------------ */}
      {summary && (
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-line p-3 sm:grid-cols-4 xl:grid-cols-5">
          <StatTile
            label={t("checkedIn")}
            value={summary.occupied}
            hint={t("legendCheckedIn")}
            footer={
              <CapacityBar
                total={summary.serviceable || 1}
                segments={[
                  { value: summary.occupied, tone: "ok", label: t("checkedIn") },
                  { value: summary.reserved, tone: "plan", label: t("reserved") },
                ]}
              />
            }
          />
          <StatTile label={t("reserved")} value={summary.reserved} hint={t("legendReserved")} />
          <StatTile
            label={t("available")}
            value={summary.free}
            tone={summary.free < 10 ? "danger" : undefined}
            hint={`${summary.serviceable} ${t("serviceable").toLowerCase()}`}
          />
          <StatTile
            label={t("maintenance")}
            value={summary.unavailable}
            tone={summary.unavailable > 0 ? "warn" : undefined}
            hint={`${summary.totalBeds} ${t("totalBeds").toLowerCase()}`}
          />
          <StatTile
            label={t("noShow")}
            value={summary.noShows}
            tone={summary.noShows > 0 ? "danger" : undefined}
            className="hidden xl:flex"
          />
        </div>
      )}

      {/* ---- filters ------------------------------------------------------ */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        <Select value={params.camp} onValueChange={(camp) => void setParams({ camp, building: "" })}>
          <SelectTrigger className="h-[var(--control-h-sm)] w-52" aria-label={t("selectCamp")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.camps.map((c) => (
              <SelectItem key={c.camp.id} value={c.camp.id}>
                {c.camp.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.building || "__all__"}
          onValueChange={(building) => void setParams({ building: building === "__all__" ? "" : building })}
        >
          <SelectTrigger className="h-[var(--control-h-sm)] w-44" aria-label={t("building")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("allBuildings")}</SelectItem>
            {data.buildings.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          value={params.from || data.fromDate}
          onChange={(e) => void setParams({ from: e.target.value })}
          aria-label={t("window")}
          className="h-[var(--control-h-sm)] w-36"
        />

        <Select value={String(params.days)} onValueChange={(days) => void setParams({ days: Number(days) })}>
          <SelectTrigger className="h-[var(--control-h-sm)] w-28" aria-label={t("window")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[7, 14, 30].map((d) => (
              <SelectItem key={d} value={String(d)}>
                {t("days", { count: d })}
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
          variant={params.free ? "subtle" : "ghost"}
          size="sm"
          onClick={() => void setParams({ free: !params.free })}
        >
          {t("freeOnly")}
        </Button>

        <span className="tnum ml-auto text-2xs text-text-3">
          {data.slots.length} {t("bed").toLowerCase()}
        </span>
      </div>

      {/* ---- timeline + detail -------------------------------------------- */}
      <div className="flex min-h-0 flex-1">
        {data.slots.length === 0 ? (
          <EmptyState className="flex-1" icon={Bed} title={t("empty")} description={t("emptyHint")} />
        ) : (
          <BedTimeline
            slots={data.slots}
            dates={data.dates}
            rangeStart={data.rangeStart}
            rangeEnd={data.rangeEnd}
            selectedBookingId={booking?.booking.id ?? null}
            onSelectBooking={(b, slot) => setBooking({ booking: b, slot })}
            onSelectEmptyBed={(slot) => data.canBook && setBookingSlot(slot)}
          />
        )}

        {booking && (
          <BookingPanel
            booking={booking.booking}
            slot={booking.slot}
            orgSlug={orgSlug}
            canCheckIn={data.canCheckIn}
            onClose={() => setBooking(null)}
            onDone={done}
          />
        )}
      </div>

      <BookingDialog
        slot={bookingSlot}
        campId={data.selectedCampId ?? ""}
        orgSlug={orgSlug}
        defaultStartDate={data.fromDate}
        onOpenChange={(open) => !open && setBookingSlot(null)}
        onDone={done}
      />
    </>
  );
}
