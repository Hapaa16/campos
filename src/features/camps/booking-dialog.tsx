"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { createBookingAction, searchBookableEmployeesAction } from "@/server/actions/camps";
import type { BedSlot } from "@/server/services/camps";
import { cn } from "@/lib/utils";

interface Candidate {
  id: string;
  displayName: string;
  employeeCode: string;
  jobTitle: string;
}

export function BookingDialog({
  slot,
  campId,
  orgSlug,
  defaultStartDate,
  onOpenChange,
  onDone,
}: {
  slot: BedSlot | null;
  campId: string;
  orgSlug: string;
  /** Local calendar date for the arrival picker. */
  defaultStartDate: string;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("camp");
  const tc = useTranslations("common");

  const [search, setSearch] = React.useState("");
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [selected, setSelected] = React.useState<Candidate | null>(null);
  const [start, setStart] = React.useState(defaultStartDate);
  const [end, setEnd] = React.useState(() => {
    const twoWeeks = new Date(`${defaultStartDate}T00:00:00Z`);
    twoWeeks.setUTCDate(twoWeeks.getUTCDate() + 14);
    return twoWeeks.toISOString().slice(0, 10);
  });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!slot) return;
    const id = setTimeout(() => {
      void searchBookableEmployeesAction(search, campId).then(setCandidates);
    }, 200);
    return () => clearTimeout(id);
  }, [search, slot, campId]);

  const submit = () => {
    if (!slot || !selected) return;
    setError(null);
    startTransition(async () => {
      const result = await createBookingAction(
        {
          bedId: slot.bedId,
          employeeId: selected.id,
          startAt: new Date(`${start}T00:00:00Z`).toISOString(),
          endAt: new Date(`${end}T00:00:00Z`).toISOString(),
          // Guards against a double-submit creating two reservations.
          idempotencyKey: `${slot.bedId}|${selected.id}|${start}|${end}`,
        },
        orgSlug,
      );
      if (!result.ok) {
        setError(result.error ?? null);
        return;
      }
      onOpenChange(false);
      onDone(t("bookingCreated"));
    });
  };

  return (
    <Dialog open={slot !== null} onOpenChange={onOpenChange}>
      {/* A fresh dialog per bed: carrying the previous guest over is how
          someone gets booked into the wrong room. */}
      <DialogContent width="md" key={slot?.bedId ?? "none"}>
        <DialogHeader
          title={t("bookBed")}
          description={
            slot
              ? t("bookingFor", {
                  room: slot.roomNumber,
                  bed: slot.bedCode,
                  building: slot.buildingName,
                })
              : undefined
          }
        />
        <DialogBody className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="booking-start">{t("arrival")}</Label>
              <Input
                id="booking-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-end">{t("departure")}</Label>
              <Input
                id="booking-end"
                type="date"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="booking-search">{t("selectEmployee")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-3" aria-hidden />
              <Input
                id="booking-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchEmployee")}
                className="pl-7"
              />
            </div>
            <ul className="max-h-52 overflow-y-auto rounded-[var(--radius-control)] border border-line">
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
                      <span className="block truncate text-sm text-text">{candidate.displayName}</span>
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

          <p className="text-2xs text-text-3">{t("plannedNote")}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!selected || !start || !end || end <= start || pending}
            onClick={submit}
          >
            {pending && <Loader2 className="animate-spin" />}
            {t("book")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
