"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Loader2, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { applyMoveAction, previewMoveAction } from "@/server/actions/org";
import type { MovePreview } from "@/server/services/org-units";

/**
 * Preview before apply.
 *
 * A restructure silently rewrites hundreds of denormalised paths, so the
 * operator sees the blast radius — and is told what will NOT change — before
 * anything is written.
 */
export function MoveDialog({
  open,
  onOpenChange,
  unitId,
  newParentId,
  orgSlug,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitId: string | null;
  newParentId: string | null;
  orgSlug: string;
  onApplied: () => void;
}) {
  const t = useTranslations("org");
  const tc = useTranslations("common");
  const [preview, setPreview] = React.useState<MovePreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  // Fetching the dry run IS an external-system sync, so an effect is right
  // here. The component is keyed on the move below, so there is no stale
  // state to reset first.
  React.useEffect(() => {
    if (!open || !unitId) return;
    let cancelled = false;
    void previewMoveAction(unitId, newParentId).then((result) => {
      if (cancelled) return;
      if ("error" in result) setError(result.error ?? null);
      else setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, unitId, newParentId]);

  const apply = () => {
    if (!unitId || !reason.trim()) return;
    startTransition(async () => {
      const result = await applyMoveAction(unitId, newParentId, reason.trim(), orgSlug);
      if (result.ok) {
        onOpenChange(false);
        onApplied();
      } else {
        setError(result.error ?? null);
      }
    });
  };

  const stat = (label: string, value: React.ReactNode, hint?: string) => (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface-inset p-2.5">
      <p className="text-2xs text-text-3">{label}</p>
      <p className="tnum mt-0.5 text-lg font-semibold text-text">{value}</p>
      {hint && <p className="mt-0.5 text-2xs text-text-3">{hint}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg" key={`${unitId ?? ""}->${newParentId ?? ""}`}>
        <DialogHeader title={t("moveUnit")} description={t("previewChanges")} />

        <DialogBody className="space-y-3">
          {!preview && !error && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-3">
              <Loader2 className="size-4 animate-spin" /> {tc("loading")}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          {preview && !preview.valid && (
            <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {preview.error}
            </p>
          )}

          {preview?.valid && (
            <>
              <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface-inset px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="block text-2xs text-text-3">{preview.fromParentName ?? "—"}</span>
                  <span className="block truncate font-medium text-text">{preview.unitName}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-text-3" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-right">
                  <span className="block text-2xs text-text-3">{t("moveUnit")}</span>
                  <span className="block truncate font-medium text-accent">
                    {preview.toParentName ?? "— (root)"}
                  </span>
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {stat(t("affectedUnits"), preview.pathChanges.length)}
                {stat(t("affectedAssignments"), preview.affectedAssignments)}
                {stat("Ажилтан", preview.affectedEmployees)}
              </div>

              <div className="rounded-[var(--radius-card)] border border-line bg-surface-inset p-3">
                <p className="text-xs font-medium text-text">{t("historyTitle")}</p>
                <p className="mt-1 text-xs text-text-3">{t("historyNote")}</p>
                <p className="tnum mt-2 text-sm text-text-2">
                  {preview.historicalRosterRows === null ? (
                    // Not "0": a figure the actor may not compute is unknown,
                    // and showing zero would read as "no history is involved".
                    <StatusChip tone="neutral" dot={false}>{tc("restricted")}</StatusChip>
                  ) : (
                    <>
                      {preview.historicalRosterRows} <span className="text-text-3">{t("historyRows")}</span>
                    </>
                  )}
                </p>
              </div>

              {preview.pathChanges.length > 0 && (
                <details className="rounded-[var(--radius-card)] border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-text-2">
                    {t("pathChanges")} ({preview.pathChanges.length})
                  </summary>
                  <ul className="max-h-40 overflow-y-auto border-t border-line px-3 py-1.5">
                    {preview.pathChanges.map((change) => (
                      <li key={change.id} className="flex items-center gap-2 py-0.5 text-xs">
                        <span className="min-w-0 flex-1 truncate text-text-2">{change.name}</span>
                        <span className="tnum shrink-0 font-mono text-text-3">{change.from}</span>
                        <ArrowRight className="size-3 shrink-0 text-text-3" aria-hidden />
                        <span className="tnum shrink-0 font-mono text-accent">{change.to}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="move-reason">
                  {tc("reason")} <span className="text-danger">*</span>
                </Label>
                <Input
                  id="move-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("reasonPlaceholder")}
                />
                <p className="text-2xs text-text-3">{t("reasonNote")}</p>
              </div>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={apply}
            disabled={!preview?.valid || !reason.trim() || pending}
          >
            {pending && <Loader2 className="animate-spin" />}
            {t("applyChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
