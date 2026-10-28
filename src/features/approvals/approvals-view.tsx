"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarRange, Check, ClipboardCheck, Loader2, TriangleAlert, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Avatar } from "@/components/ui/misc";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { decideLeaveAction } from "@/server/actions/approvals";
import { formatDateRange } from "@/lib/format";
import type { ApprovalsData, LeaveApprovalItem } from "@/server/services/approvals";

export function ApprovalsView({ data, orgSlug }: { data: ApprovalsData; orgSlug: string }) {
  const t = useTranslations("approvals");
  const tr = useTranslations("roster");
  const [deciding, setDeciding] = React.useState<{
    item: LeaveApprovalItem;
    decision: "approved" | "rejected";
  } | null>(null);

  const total = data.leave.length + data.rosters.length;

  return (
    <>
      <PageHeader title={t("title")} meta={total > 0 ? String(total) : undefined} />

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {total === 0 ? (
          <EmptyState icon={ClipboardCheck} title={t("empty")} description={t("emptyHint")} />
        ) : (
          <div className="space-y-3">
            {data.rosters.length > 0 && (
              <Panel>
                <PanelHeader
                  title={t("rosterPublication")}
                  description={String(data.rosters.length)}
                />
                <ul className="divide-y divide-line-soft">
                  {data.rosters.map((period) => (
                    <li key={period.id} className="flex items-center gap-3 px-4 py-2.5">
                      <CalendarRange className="size-4 shrink-0 text-text-3" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text">
                          {period.name}
                        </span>
                        <span className="tnum block truncate text-2xs text-text-3">
                          {period.siteName} · {period.startDate} → {period.endDate} ·{" "}
                          {period.assignments}
                        </span>
                      </span>
                      <StatusChip tone={period.status === "review" ? "warn" : "neutral"}>
                        {tr(period.status)}
                      </StatusChip>
                      {/* Publication happens on the roster screen, where the
                          conflicts that block it are visible. */}
                      <Button variant="secondary" size="sm" asChild>
                        <Link href={`/${orgSlug}/rosters?period=${period.id}`}>{tr("publish")}</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {data.leave.length > 0 && (
              <Panel>
                <PanelHeader title={t("leaveRequest")} description={String(data.leave.length)} />
                <ul className="divide-y divide-line-soft">
                  {data.leave.map((item) => (
                    <LeaveRow
                      key={item.id}
                      item={item}
                      onDecide={(decision) => setDeciding({ item, decision })}
                    />
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )}
      </div>

      {deciding && (
        <DecisionDialog
          item={deciding.item}
          decision={deciding.decision}
          orgSlug={orgSlug}
          onClose={() => setDeciding(null)}
        />
      )}
    </>
  );
}

const LEAVE_TONE: Record<string, StatusTone> = {
  annual: "plan",
  sick: "danger",
  unpaid: "neutral",
  parental: "accent",
  training: "ok",
  compassionate: "warn",
};

function LeaveRow({
  item,
  onDecide,
}: {
  item: LeaveApprovalItem;
  onDecide: (decision: "approved" | "rejected") => void;
}) {
  const t = useTranslations("approvals");
  const tl = useTranslations("leave");

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Avatar name={item.employeeName} tone={item.avatarColor as StatusTone} size="md" />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text">{item.employeeName}</span>
        <span className="block truncate text-2xs text-text-3">
          {item.employeeCode}
          {item.orgUnitName ? ` · ${item.orgUnitName}` : ""}
        </span>
      </span>

      <span className="hidden min-w-0 shrink-0 text-right sm:block">
        <StatusChip tone={LEAVE_TONE[item.leaveType] ?? "neutral"} dot={false}>
          {tl(item.leaveType)}
        </StatusChip>
        <span className="tnum mt-0.5 block whitespace-nowrap text-2xs text-text-3">
          {formatDateRange(item.startAt, item.endAt)} · {item.days}
        </span>
      </span>

      {item.clashingShifts > 0 && (
        // The cost of approving, shown before the decision rather than
        // discovered on the roster afterwards.
        <StatusChip tone="warn" className="shrink-0">
          <TriangleAlert className="size-3" aria-hidden />
          {item.clashingShifts}
        </StatusChip>
      )}

      <span className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={t("reject")} onClick={() => onDecide("rejected")}>
          <X className="text-danger" />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onDecide("approved")}>
          <Check /> {t("approve")}
        </Button>
      </span>
    </li>
  );
}

function DecisionDialog({
  item,
  decision,
  orgSlug,
  onClose,
}: {
  item: LeaveApprovalItem;
  decision: "approved" | "rejected";
  orgSlug: string;
  onClose: () => void;
}) {
  const t = useTranslations("approvals");
  const tc = useTranslations("common");
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await decideLeaveAction(item.id, decision, reason.trim(), orgSlug);
      if (!result.ok) {
        setError(result.error ?? null);
        return;
      }
      toast.success(decision === "approved" ? t("approved") : t("rejected"));
      onClose();
      router.refresh();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={decision === "approved" ? t("approve") : t("reject")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-[var(--radius-panel)] border border-line bg-surface-2 shadow-[var(--shadow-overlay)]">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-md font-semibold tracking-tight text-text">
            {decision === "approved" ? t("approve") : t("reject")}
          </h2>
          <p className="mt-0.5 text-sm text-text-3">
            {item.employeeName} · {item.days}
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          {item.clashingShifts > 0 && decision === "approved" && (
            <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-sm text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("clashWarning", { count: item.clashingShifts })}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="decision-reason">
              {tc("reason")} <span className="text-danger">*</span>
            </Label>
            <Input
              id="decision-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
            <p className="text-2xs text-text-3">{t("decisionAudited")}</p>
          </div>

          {error && (
            <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-2.5 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            variant={decision === "approved" ? "primary" : "danger"}
            disabled={!reason.trim() || pending}
            onClick={submit}
          >
            {pending && <Loader2 className="animate-spin" />}
            {decision === "approved" ? t("approve") : t("reject")}
          </Button>
        </div>
      </div>
    </div>
  );
}
