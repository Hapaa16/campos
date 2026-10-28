"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";

/** Confirmation that can demand a reason — used wherever an audit row needs one. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  toggleLabel,
  requireReason,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  toggleLabel?: string;
  requireReason?: boolean;
  onConfirm: (toggle: boolean, reason?: string) => void;
}) {
  const tc = useTranslations("common");
  const [toggle, setToggle] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const blocked = (requireReason && !reason.trim()) || pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Keyed on `open` so each opening gets a clean component rather than a
          hand-written reset — a stale reason carried into the next dialog is
          worse than a remount. */}
      <DialogContent width="md" key={String(open)}>
        <DialogHeader title={title} />
        <DialogBody className="space-y-3">
          <p className="text-sm text-text-2">{body}</p>

          {toggleLabel && (
            <label className="flex items-center gap-2 text-sm text-text-2">
              <Switch checked={toggle} onCheckedChange={setToggle} />
              {toggleLabel}
            </label>
          )}

          {requireReason && (
            <div className="space-y-1.5">
              <Label htmlFor="confirm-reason">
                {tc("reason")} <span className="text-danger">*</span>
              </Label>
              <Input
                id="confirm-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
              <p className="text-2xs text-text-3">{tc("reasonRequired")}</p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={blocked}
            onClick={() => {
              setPending(true);
              onConfirm(toggle, reason.trim() || undefined);
            }}
          >
            {pending && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
