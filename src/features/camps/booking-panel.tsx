"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LogIn, LogOut, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Input, Label } from "@/components/ui/input";
import { checkInAction, checkOutAction, cancelBookingAction } from "@/server/actions/camps";
import type { BedBookingView, BedSlot } from "@/server/services/camps";
import { statusKey } from "./bed-timeline";

const TONE: Record<BedBookingView["status"], StatusTone> = {
  reserved: "plan",
  checked_in: "ok",
  checked_out: "neutral",
  no_show: "danger",
  cancelled: "neutral",
};

export function BookingPanel({
  booking,
  slot,
  orgSlug,
  canCheckIn,
  onClose,
  onDone,
}: {
  booking: BedBookingView;
  slot: BedSlot;
  orgSlug: string;
  canCheckIn: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("camp");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [pending, startTransition] = React.useTransition();
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, message: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? null);
        return;
      }
      onDone(message);
      onClose();
    });

  const field = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 py-1">
      <dt className="w-28 shrink-0 text-2xs text-text-3">{label}</dt>
      <dd className="min-w-0 flex-1 text-xs text-text">{value ?? "—"}</dd>
    </div>
  );

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-start justify-between gap-2 border-b border-line p-4">
        <div className="min-w-0">
          <h2 className="truncate text-md font-semibold tracking-tight text-text">
            {booking.personName ?? "—"}
          </h2>
          <p className="mt-0.5 truncate text-2xs text-text-3">
            {slot.buildingName} · {slot.roomNumber}-{slot.bedCode}
          </p>
          <div className="mt-2">
            <StatusChip tone={TONE[booking.status]}>{t(statusKey(booking.status))}</StatusChip>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={tc("close")}>
          <X />
        </Button>
      </div>

      <dl className="divide-y divide-line-soft px-4 py-2">
        {field(
          t("stay"),
          `${format.dateTime(new Date(booking.startAt), { dateStyle: "medium" })} → ${format.dateTime(
            new Date(booking.endAt),
            { dateStyle: "medium" },
          )}`,
        )}
        {field(
          t("checkedIn"),
          booking.checkedInAt ? (
            format.dateTime(new Date(booking.checkedInAt), { dateStyle: "medium", timeStyle: "short" })
          ) : (
            // Says so explicitly: a reservation whose window has started is
            // still not an arrival.
            <span className="text-text-3">{t("notArrivedYet")}</span>
          ),
        )}
        {field(
          t("checkedOut"),
          booking.checkedOutAt
            ? format.dateTime(new Date(booking.checkedOutAt), { dateStyle: "medium", timeStyle: "short" })
            : null,
        )}
      </dl>

      {error && (
        <p role="alert" className="mx-4 rounded-[var(--radius-control)] bg-danger-soft px-2.5 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {cancelling ? (
        <div className="mt-auto space-y-2 border-t border-line p-4">
          <Label htmlFor="cancel-reason">
            {tc("reason")} <span className="text-danger">*</span>
          </Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <p className="text-2xs text-text-3">{t("cancelBody")}</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => setCancelling(false)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="flex-1"
              disabled={!reason.trim() || pending}
              onClick={() =>
                run(() => cancelBookingAction(booking.id, reason.trim(), orgSlug), t("cancelledToast"))
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              {tc("confirm")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-auto space-y-2 border-t border-line p-4">
          {canCheckIn && booking.status === "reserved" && (
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              disabled={pending}
              onClick={() => run(() => checkInAction(booking.id, orgSlug), t("checkedInToast"))}
            >
              {pending ? <Loader2 className="animate-spin" /> : <LogIn />}
              {t("checkIn")}
            </Button>
          )}
          {canCheckIn && booking.status === "checked_in" && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={pending}
              onClick={() => run(() => checkOutAction(booking.id, orgSlug), t("checkedOutToast"))}
            >
              {pending ? <Loader2 className="animate-spin" /> : <LogOut />}
              {t("checkOut")}
            </Button>
          )}
          {canCheckIn && (booking.status === "reserved" || booking.status === "no_show") && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setCancelling(true)}>
              {t("cancelBooking")}
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
