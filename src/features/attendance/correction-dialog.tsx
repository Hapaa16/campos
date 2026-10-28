"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { correctAttendanceAction } from "@/server/actions/attendance";
import { CORRECTABLE_STATUSES, STATUS_KEY, STATUS_TONE } from "./status";
import type { AttendanceRow } from "@/server/services/attendance";
import type { AttendanceStatus } from "@/server/db/schema";
import { cn } from "@/lib/utils";

export function CorrectionDialog({
  row,
  orgSlug,
  onOpenChange,
}: {
  row: AttendanceRow | null;
  orgSlug: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("attendance");
  const tc = useTranslations("common");
  const router = useRouter();

  const [status, setStatus] = React.useState<AttendanceStatus>("present");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    if (!row) return;
    setError(null);
    startTransition(async () => {
      const result = await correctAttendanceAction(
        { employeeId: row.employeeId, date: row.date, status, reason: reason.trim(), note },
        orgSlug,
      );
      if (!result.ok) {
        setError(result.error ?? null);
        return;
      }
      toast.success(t("correctedToast"));
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      {/* Keyed per row so each correction starts clean. */}
      <DialogContent width="md" key={row?.id ?? "none"}>
        <DialogHeader
          title={t("correctTitle")}
          description={row ? `${row.displayName} · ${row.date}` : undefined}
        />

        <DialogBody className="space-y-3">
          <p className="text-sm text-text-2">{t("correctBody")}</p>

          {row && (
            <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface-inset px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-2xs text-text-3">
                  {t("correctedFrom", { status: t(STATUS_KEY[row.derivedStatus]) })}
                </span>
                <StatusChip tone={STATUS_TONE[row.derivedStatus]} className="mt-1">
                  {t(STATUS_KEY[row.derivedStatus])}
                </StatusChip>
              </span>
              <ArrowRight className="size-4 shrink-0 text-text-3" aria-hidden />
              <StatusChip tone={STATUS_TONE[status]}>{t(STATUS_KEY[status])}</StatusChip>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t("newStatus")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {CORRECTABLE_STATUSES.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setStatus(candidate)}
                  className={cn(
                    "ui-transition rounded-[var(--radius-control)] border px-2 py-1 text-xs",
                    status === candidate
                      ? "border-accent bg-accent-soft text-text"
                      : "border-line text-text-2 hover:bg-surface-3",
                  )}
                >
                  {t(STATUS_KEY[candidate])}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="correction-reason">
              {tc("reason")} <span className="text-danger">*</span>
            </Label>
            <Input
              id="correction-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Уншигч эвдэрсэн, биечлэн баталгаажуулсан"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="correction-note">{tc("details")}</Label>
            <Textarea
              id="correction-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-16"
            />
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
          <Button variant="primary" disabled={!reason.trim() || pending} onClick={submit}>
            {pending && <Loader2 className="animate-spin" />}
            {t("correct")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
