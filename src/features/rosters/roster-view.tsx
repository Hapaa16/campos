"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { parseAsBoolean, parseAsString, useQueryStates } from "nuqs";
import { toast } from "sonner";
import { CalendarRange, Eraser, Loader2, Search, Sparkles, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Kbd } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/app/page-header";
import { useDebouncedSearch } from "@/lib/use-debounced-search";
import { RosterGrid, selectionBounds, selectionSize, type Selection } from "./roster-grid";
import { ConfirmDialog } from "./confirm-dialog";
import {
  applyCellEditsAction,
  generateRosterAction,
  publishRosterAction,
} from "@/server/actions/rosters";
import type { CellEdit } from "@/server/services/rosters";
import type { RosterGridData } from "@/server/services/rosters";
import type { RosterPeriod } from "@/server/db/schema";
import { cn } from "@/lib/utils";

const PERIOD_TONE: Record<RosterPeriod["status"], StatusTone> = {
  draft: "neutral",
  review: "warn",
  published: "ok",
  archived: "neutral",
};

export function RosterView({ data, orgSlug }: { data: RosterGridData; orgSlug: string }) {
  const t = useTranslations("roster");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();

  const [params, setParams] = useQueryStates(
    {
      period: parseAsString.withDefault(data.period.id),
      q: parseAsString.withDefault(""),
      conflicts: parseAsBoolean.withDefault(false),
    },
    { shallow: false, history: "replace" },
  );

  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [confirm, setConfirm] = React.useState<"generate" | "publish" | null>(null);
  const commitSearch = React.useCallback(
    (q: string) => void setParams({ q }),
    [setParams],
  );
  const [search, setSearch] = useDebouncedSearch(params.q, commitSearch);

  const isPublished = data.period.status === "published" || data.period.status === "archived";
  const editable = data.canEdit && !isPublished;

  /* -- turn a selection into concrete edits ------------------------------ */
  const editsFromSelection = React.useCallback(
    (dayType: CellEdit["dayType"], shiftTemplateId?: string): CellEdit[] => {
      if (!selection) return [];
      const b = selectionBounds(selection);
      const edits: CellEdit[] = [];
      for (let r = b.minRow; r <= b.maxRow; r++) {
        const row = data.rows[r];
        if (!row) continue;
        for (let d = b.minDate; d <= b.maxDate; d++) {
          const date = data.dates[d];
          if (!date) continue;
          edits.push({ employeeId: row.employeeId, date, dayType, shiftTemplateId });
        }
      }
      return edits;
    },
    [selection, data.rows, data.dates],
  );

  const applyEdits = React.useCallback(
    (dayType: CellEdit["dayType"], shiftTemplateId?: string) => {
      if (!editable) {
        toast.error(isPublished ? t("readOnlyPublished") : t("noEditPermission"));
        return;
      }
      const edits = editsFromSelection(dayType, shiftTemplateId);
      if (edits.length === 0) return;

      startTransition(async () => {
        const result = await applyCellEditsAction(data.period.id, edits, orgSlug);
        if (!result.ok) {
          toast.error(result.error ?? te("genericBody"));
          return;
        }
        const { applied = 0, cleared = 0, conflicts = 0 } = result.data ?? {};
        toast.success(t("saved"), {
          description:
            conflicts > 0
              ? `${applied + cleared} · ${conflicts} ${t("conflicts").toLowerCase()}`
              : `${applied + cleared}`,
        });
        router.refresh();
      });
    },
    [editable, isPublished, editsFromSelection, data.period.id, orgSlug, router, t, te],
  );

  /* -- keyboard -------------------------------------------------------- */
  const dayShift = data.shiftTemplates.find((s) => s.shiftType === "day");
  const nightShift = data.shiftTemplates.find((s) => s.shiftType === "night");

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!selection) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const move = (dRow: number, dDate: number) => {
        event.preventDefault();
        const next = {
          rowIndex: clamp(selection.focus.rowIndex + dRow, 0, data.rows.length - 1),
          dateIndex: clamp(selection.focus.dateIndex + dDate, 0, data.dates.length - 1),
        };
        // Shift extends the range; a bare arrow collapses it to one cell.
        setSelection(event.shiftKey ? { anchor: selection.anchor, focus: next } : { anchor: next, focus: next });
      };

      switch (event.key) {
        case "ArrowUp": return move(-1, 0);
        case "ArrowDown": return move(1, 0);
        case "ArrowLeft": return move(0, -1);
        case "ArrowRight": return move(0, 1);
        case "Escape": return setSelection(null);
        case "d": case "D": case "ү": case "Ү":
          if (dayShift) applyEdits("shift", dayShift.id);
          return;
        case "n": case "N": case "ш": case "Ш":
          if (nightShift) applyEdits("shift", nightShift.id);
          return;
        case "r": case "R": case "а": case "А":
          applyEdits(null);
          return;
        case "Delete": case "Backspace":
          event.preventDefault();
          applyEdits(null);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, data.rows.length, data.dates.length, dayShift, nightShift, applyEdits]);

  const count = selectionSize(selection);

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={`${data.period.name} · ${data.period.startDate} → ${data.period.endDate}`}
        actions={
          <>
            <StatusChip tone={PERIOD_TONE[data.period.status]}>
              {t(data.period.status)} · v{data.period.version}
            </StatusChip>
            {data.totalConflicts > 0 && (
              <StatusChip tone="danger">
                {data.totalConflicts} {t("conflicts").toLowerCase()}
              </StatusChip>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        <Select value={params.period} onValueChange={(period) => void setParams({ period })}>
          <SelectTrigger className="h-[var(--control-h-sm)] w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.periods.map((period) => (
              <SelectItem key={period.id} value={period.id}>
                {period.name} · {t(period.status)}
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
          variant={params.conflicts ? "subtle" : "ghost"}
          size="sm"
          onClick={() => void setParams({ conflicts: !params.conflicts })}
        >
          <TriangleAlert /> {t("conflictsOnly")}
        </Button>

        <div className="ml-auto flex items-center gap-1.5">
          {data.canEdit && (
            <Button
              variant="secondary"
              size="sm"
              disabled={isPublished || pending}
              onClick={() => setConfirm("generate")}
            >
              <Sparkles /> {t("generate")}
            </Button>
          )}
          {data.canPublish && (
            <Tooltip content={data.totalConflicts > 0 ? t("publishBlocked") : ""}>
              <span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isPublished || pending || data.totalConflicts > 0}
                  onClick={() => setConfirm("publish")}
                >
                  <Upload /> {t("publish")}
                </Button>
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={CalendarRange}
          title={t("empty")}
          description={t("emptyHint")}
        />
      ) : (
        <RosterGrid data={data} selection={selection} onSelectionChange={setSelection} />
      )}

      {/* ---- bulk action bar, only while something is selected ---------- */}
      <div
        className={cn(
          "ui-transition flex items-center gap-2 border-t border-line bg-surface px-3 py-1.5",
          count === 0 && "text-text-3",
        )}
      >
        {count > 0 ? (
          <>
            <span className="tnum text-xs font-medium text-text">
              {t("cellsSelected", { count })}
            </span>
            {pending && <Loader2 className="size-3.5 animate-spin text-text-3" />}
            <div className="flex items-center gap-1">
              {dayShift && (
                <Button variant="subtle" size="sm" disabled={!editable || pending} onClick={() => applyEdits("shift", dayShift.id)}>
                  {t("shiftDay")} <Kbd>D</Kbd>
                </Button>
              )}
              {nightShift && (
                <Button variant="subtle" size="sm" disabled={!editable || pending} onClick={() => applyEdits("shift", nightShift.id)}>
                  {t("shiftNight")} <Kbd>N</Kbd>
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={!editable || pending} onClick={() => applyEdits(null)}>
                <Eraser /> {t("rest")} <Kbd>R</Kbd>
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelection(null)}>
              {t("clearSelection")} <Kbd>ESC</Kbd>
            </Button>
          </>
        ) : (
          <p className="text-2xs">{editable ? t("keyboardHint") : isPublished ? t("readOnlyPublished") : t("noEditPermission")}</p>
        )}
      </div>

      <ConfirmDialog
        open={confirm === "generate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("generateConfirm")}
        body={t("generateBody")}
        confirmLabel={t("generate")}
        toggleLabel={t("overwriteManual")}
        onConfirm={(overwrite) =>
          startTransition(async () => {
            const result = await generateRosterAction(data.period.id, overwrite, orgSlug);
            setConfirm(null);
            if (!result.ok) {
              toast.error(result.error ?? te("genericBody"));
              return;
            }
            const d = result.data!;
            toast.success(t("generatedToast", { created: d.created, skipped: d.skippedManual }), {
              description:
                d.employeesWithoutPattern > 0
                  ? t("noPattern", { count: d.employeesWithoutPattern })
                  : undefined,
            });
            router.refresh();
          })
        }
      />

      <ConfirmDialog
        open={confirm === "publish"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("publishConfirm")}
        body={`${t("publishBody")} ${t("publishWarning")}`}
        confirmLabel={t("publish")}
        requireReason
        onConfirm={(_, reason) =>
          startTransition(async () => {
            const result = await publishRosterAction(data.period.id, reason ?? "", orgSlug);
            setConfirm(null);
            if (!result.ok) {
              toast.error(result.error ?? te("genericBody"));
              return;
            }
            const d = result.data!;
            toast.success(t("publishedToast", { version: d.version, confirmed: d.confirmed }));
            router.refresh();
          })
        }
      />
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
