"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { parseAsBoolean, parseAsString, useQueryStates } from "nuqs";
import { BedDouble, PencilLine, Search, TriangleAlert, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Avatar } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column, type ColumnMeta } from "@/components/data/data-table";
import { useDebouncedSearch } from "@/lib/use-debounced-search";
import { formatTime } from "@/lib/format";
import { CorrectionDialog } from "./correction-dialog";
import { ReconciliationPanel } from "./reconciliation-panel";
import { SOURCE_KEY, STATUS_KEY, STATUS_TONE, SUMMARY_ORDER } from "./status";
import type { AttendanceBoard, AttendanceRow } from "@/server/services/attendance";
import { cn } from "@/lib/utils";

export function AttendanceView({ data, orgSlug }: { data: AttendanceBoard; orgSlug: string }) {
  const t = useTranslations("attendance");
  const tc = useTranslations("common");

  const [params, setParams] = useQueryStates(
    {
      date: parseAsString.withDefault(data.date),
      site: parseAsString.withDefault(data.siteId ?? ""),
      q: parseAsString.withDefault(""),
      exceptions: parseAsBoolean.withDefault(false),
      status: parseAsString.withDefault(""),
    },
    { shallow: false, history: "replace" },
  );

  const commitSearch = React.useCallback((q: string) => void setParams({ q }), [setParams]);
  const [search, setSearch] = useDebouncedSearch(params.q, commitSearch);
  const [correcting, setCorrecting] = React.useState<AttendanceRow | null>(null);

  const columns = useAttendanceColumns({
    canCorrect: data.canCorrect,
    onCorrect: setCorrecting,
  });

  const totalExceptions =
    data.summary.late + data.summary.partial + data.summary.absent + data.summary.unplanned;

  return (
    <>
      <PageHeader
        pageKey="attendance"
        title={t("title")}
        meta={`${data.date} · ${data.summary.rostered} ${t("rostered").toLowerCase()}`}
        actions={
          totalExceptions > 0 ? (
            <StatusChip tone="warn">
              {totalExceptions} {tc("filter").toLowerCase()}
            </StatusChip>
          ) : null
        }
      />

      {/* ---- summary strip: one chip per status, with its real count ----- */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        {SUMMARY_ORDER.map((status) => {
          const count = data.summary[status as keyof typeof data.summary] as number;
          if (count === 0 && status === "expected") return null;
          const active = params.status === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => void setParams({ status: active ? "" : status })}
              className={cn(
                "ui-transition flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2 py-1",
                active ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-3",
              )}
            >
              <StatusChip tone={STATUS_TONE[status]} dot>
                {t(STATUS_KEY[status])}
              </StatusChip>
              <span className="tnum text-sm font-semibold text-text">{count}</span>
            </button>
          );
        })}
      </div>

      {/* ---- filters ----------------------------------------------------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        <Input
          type="date"
          value={params.date}
          onChange={(e) => void setParams({ date: e.target.value })}
          aria-label={tc("from")}
          className="h-[var(--control-h-sm)] w-36"
        />

        <Select value={params.site} onValueChange={(site) => void setParams({ site })}>
          <SelectTrigger className="h-[var(--control-h-sm)] w-52" aria-label={tc("filter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.sites.map((site) => (
              <SelectItem key={site.id} value={site.id}>
                {site.name}
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
            className="h-[var(--control-h-sm)] w-48 pl-7"
          />
        </div>

        <Button
          variant={params.exceptions ? "subtle" : "ghost"}
          size="sm"
          onClick={() => void setParams({ exceptions: !params.exceptions })}
        >
          <TriangleAlert /> {t("exceptionsOnly")}
        </Button>

        <span className="tnum ml-auto text-2xs text-text-3">
          {t("graceNote", { minutes: data.graceMinutes })}
        </span>
      </div>

      {/* ---- table + reconciliation -------------------------------------- */}
      <div className="flex min-h-0 flex-1">
        <DataTable
          className="min-h-0 flex-1"
          data={data.rows}
          columns={columns}
          empty={<EmptyState icon={UserCheck} title={t("empty")} description={t("emptyHint")} />}
        />
        <ReconciliationPanel data={data.reconciliation} />
      </div>

      <CorrectionDialog
        row={correcting}
        orgSlug={orgSlug}
        onOpenChange={(open) => !open && setCorrecting(null)}
      />
    </>
  );
}

function useAttendanceColumns({
  canCorrect,
  onCorrect,
}: {
  canCorrect: boolean;
  onCorrect: (row: AttendanceRow) => void;
}): Column<AttendanceRow>[] {
  const t = useTranslations("attendance");
  const tc = useTranslations("common");
  const meta = (m: ColumnMeta) => m;

  const columns: Column<AttendanceRow>[] = [
    {
      id: "name",
      header: tc("details"),
      meta: meta({ width: 220 }),
      cell: ({ row }) => {
        const r = row.original as AttendanceRow;
        return (
          <span className="flex items-center gap-2">
            <Avatar name={r.displayName} tone={r.avatarColor as StatusTone} size="sm" />
            <span className="min-w-0">
              <span className="block truncate font-medium text-text">{r.displayName}</span>
              <span className="block truncate text-2xs text-text-3">{r.orgUnitName}</span>
            </span>
          </span>
        );
      },
    },
    {
      id: "status",
      header: tc("status"),
      meta: meta({ width: 130 }),
      cell: ({ row }) => {
        const r = row.original as AttendanceRow;
        return (
          <span className="flex items-center gap-1">
            <StatusChip tone={STATUS_TONE[r.status]}>{t(STATUS_KEY[r.status])}</StatusChip>
            {r.corrected && (
              // A corrected row must never look like an observed one.
              <Tooltip
                content={`${t("correctedFrom", { status: t(STATUS_KEY[r.derivedStatus]) })} — ${r.correctionReason ?? ""}`}
              >
                <PencilLine className="size-3 shrink-0 text-accent" aria-label={t("corrected")} />
              </Tooltip>
            )}
          </span>
        );
      },
    },
    {
      id: "shift",
      header: t("shift"),
      meta: meta({ width: 70 }),
      cell: ({ row }) => {
        const r = row.original as AttendanceRow;
        return <span className="font-mono text-2xs text-text-3">{r.shiftCode ?? "—"}</span>;
      },
    },
    {
      id: "planned",
      header: t("planned"),
      meta: meta({ width: 110, numeric: true }),
      cell: ({ row }) => {
        const r = row.original as AttendanceRow;
        if (!r.plannedStartAt || !r.plannedEndAt) {
          return <span className="text-2xs text-text-3">—</span>;
        }
        return (
          <span className="tnum text-text-3">
            {formatTime(r.plannedStartAt)}–{formatTime(r.plannedEndAt)}
          </span>
        );
      },
    },
    {
      id: "actual",
      header: t("actual"),
      meta: meta({ width: 110, numeric: true }),
      cell: ({ row }) => {
        const r = row.original as AttendanceRow;
        if (!r.actualStartAt) return <span className="text-2xs text-text-3">—</span>;
        return (
          <span className="tnum text-text">
            {formatTime(r.actualStartAt)}–
            {r.actualEndAt ? (
              formatTime(r.actualEndAt)
            ) : (
              <span className="text-warn">··</span>
            )}
          </span>
        );
      },
    },
    {
      id: "variance",
      header: t("variance"),
      meta: meta({ width: 150 }),
      cell: ({ row }) => {
        const r = row.original as AttendanceRow;
        const parts: React.ReactNode[] = [];
        if (r.lateMinutes > 0) {
          parts.push(
            <span key="late" className="text-warn">
              {t("lateBy", { minutes: r.lateMinutes })}
            </span>,
          );
        }
        if (r.earlyLeaveMinutes > 0) {
          parts.push(
            <span key="early" className="text-warn">
              {t("leftEarly", { minutes: r.earlyLeaveMinutes })}
            </span>,
          );
        }
        if (r.actualStartAt && !r.actualEndAt && r.status === "partial") {
          parts.push(
            <span key="noout" className="text-danger">
              {t("noClockOut")}
            </span>,
          );
        }
        if (parts.length === 0) return null;
        return <span className="flex flex-col text-2xs leading-tight">{parts}</span>;
      },
    },
    {
      id: "worked",
      header: t("worked"),
      meta: meta({ width: 72, numeric: true, align: "right" }),
      cell: ({ row }) => {
        const r = row.original as AttendanceRow;
        if (r.workedMinutes === 0) return null;
        const hours = Math.floor(r.workedMinutes / 60);
        const minutes = r.workedMinutes % 60;
        return (
          <span className="tnum text-text-2">
            {hours}:{String(minutes).padStart(2, "0")}
          </span>
        );
      },
    },
    {
      id: "camp",
      header: t("inCamp"),
      meta: meta({ width: 64, defaultHidden: false }),
      cell: ({ row }) => {
        const r = row.original as AttendanceRow;
        // Three states, not two: in camp, not in camp, and not visible.
        if (r.inCamp === null) return <span className="text-2xs text-text-3">—</span>;
        return r.inCamp ? (
          <BedDouble className="size-3.5 text-plan" aria-label={t("inCamp")} />
        ) : (
          <span className="text-2xs text-text-3">—</span>
        );
      },
    },
    {
      id: "source",
      header: t("source"),
      meta: meta({ width: 90, defaultHidden: true }),
      cell: ({ row }) => {
        const r = row.original as AttendanceRow;
        return r.source ? (
          <span className="text-2xs text-text-3">{t(SOURCE_KEY[r.source] ?? "sourceManual")}</span>
        ) : null;
      },
    },
    {
      id: "actions",
      header: "",
      meta: meta({ width: 56, align: "right" }),
      cell: ({ row }) => {
        if (!canCorrect) return null;
        const r = row.original as AttendanceRow;
        return (
          <Tooltip content={t("correct")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("correct")}
              onClick={(event) => {
                event.stopPropagation();
                onCorrect(r);
              }}
            >
              <PencilLine />
            </Button>
          </Tooltip>
        );
      },
    },
  ];

  return columns;
}
