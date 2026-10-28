"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar } from "@/components/ui/misc";
import { bookSeatAction, searchTripCandidatesAction } from "@/server/actions/transport";
import { useDebouncedSearch } from "@/lib/use-debounced-search";
import type { TripView } from "@/server/services/transport";
import { cn } from "@/lib/utils";

interface Candidate {
  id: string;
  displayName: string;
  employeeCode: string;
  jobTitle: string;
}

export function BookSeatDialog({
  trip,
  orgSlug,
  onOpenChange,
}: {
  trip: TripView | null;
  orgSlug: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("transport");
  const tc = useTranslations("common");
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [search, setSearch] = useDebouncedSearch(query, setQuery);
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [selected, setSelected] = React.useState<Candidate | null>(null);
  // The dialog is keyed on the trip below, so it remounts per trip and these
  // initialisers run fresh — no reset effect, and no cascading render.
  const [fromStop, setFromStop] = React.useState(() => trip?.stops[0]?.id ?? "");
  const [toStop, setToStop] = React.useState(
    () => trip?.stops[trip.stops.length - 1]?.id ?? "",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!trip) return;
    const id = setTimeout(() => {
      void searchTripCandidatesAction(trip.id, query).then(setCandidates);
    }, 150);
    return () => clearTimeout(id);
  }, [query, trip]);

  const fromSeq = trip?.stops.find((s) => s.id === fromStop)?.sequenceNumber ?? 0;
  const toSeq = trip?.stops.find((s) => s.id === toStop)?.sequenceNumber ?? 0;
  const validLeg = toSeq > fromSeq;

  // Seats left is the worst leg the journey crosses, not the trip total.
  const seatsLeft = React.useMemo(() => {
    if (!trip || !trip.seatingCapacity || !validLeg) return null;
    const crossed = trip.legs.filter((l) => l.fromSeq >= fromSeq && l.toSeq <= toSeq);
    if (crossed.length === 0) return null;
    return Math.min(...crossed.map((l) => l.free));
  }, [trip, fromSeq, toSeq, validLeg]);

  const submit = () => {
    if (!trip || !selected) return;
    setError(null);
    startTransition(async () => {
      const result = await bookSeatAction(
        {
          tripId: trip.id,
          employeeId: selected.id,
          boardingStopId: fromStop,
          destinationStopId: toStop,
          idempotencyKey: `${trip.id}|${selected.id}|${fromStop}|${toStop}`,
        },
        orgSlug,
      );
      if (!result.ok) {
        setError(result.error ?? null);
        return;
      }
      toast.success(t("bookedToast", { reference: result.data!.reference }), {
        description: t("seatsLeftAfter", { count: result.data!.seatsLeft }),
      });
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={trip !== null} onOpenChange={onOpenChange}>
      <DialogContent width="md" key={trip?.id ?? "none"}>
        <DialogHeader
          title={t("bookSeat")}
          description={trip ? `${trip.routeName} · ${trip.vehicleRegistration ?? ""}` : undefined}
        />

        <DialogBody className="space-y-3">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1.5">
              <Label>{t("from")}</Label>
              <Select value={fromStop} onValueChange={setFromStop}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {trip?.stops.slice(0, -1).map((stop) => (
                    <SelectItem key={stop.id} value={stop.id}>
                      {stop.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ArrowRight className="mb-2 size-4 shrink-0 text-text-3" aria-hidden />
            <div className="space-y-1.5">
              <Label>{t("to")}</Label>
              <Select value={toStop} onValueChange={setToStop}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {trip?.stops.slice(1).map((stop) => (
                    <SelectItem key={stop.id} value={stop.id}>
                      {stop.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Availability is for the chosen leg, so changing the stops changes
              the number — which is the whole point of the segment model. */}
          {seatsLeft !== null && (
            <p
              className={cn(
                "tnum rounded-[var(--radius-control)] px-2.5 py-2 text-sm",
                seatsLeft === 0 ? "bg-danger-soft text-danger" : "bg-surface-inset text-text-2",
              )}
            >
              {t("seatsLeftAfter", { count: seatsLeft })}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="trip-candidate-search">{tc("search")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-3" aria-hidden />
              <Input
                id="trip-candidate-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tc("searchPlaceholder")}
                className="pl-7"
              />
            </div>
            <ul className="max-h-48 overflow-y-auto rounded-[var(--radius-control)] border border-line">
              {candidates.length === 0 && (
                <li className="px-2.5 py-3 text-center text-xs text-text-3">{tc("noResults")}</li>
              )}
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(candidate)}
                    className={cn(
                      "ui-transition flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-3",
                      selected?.id === candidate.id && "bg-accent-soft",
                    )}
                  >
                    <Avatar name={candidate.displayName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text">
                        {candidate.displayName}
                      </span>
                      <span className="block truncate text-2xs text-text-3">
                        {candidate.employeeCode} · {candidate.jobTitle}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {error && (
            <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-2.5 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!selected || !validLeg || seatsLeft === 0 || pending}
            onClick={submit}
          >
            {pending && <Loader2 className="animate-spin" />}
            {t("bookSeat")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
