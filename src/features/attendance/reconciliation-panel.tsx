"use client";

import { useTranslations } from "next-intl";
import { BedDouble, CalendarX, EyeOff, TriangleAlert, UserX } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Avatar } from "@/components/ui/misc";
import type { StatusTone } from "@/components/ui/status-chip";
import type { AttendanceRow, Reconciliation } from "@/server/services/attendance";

/**
 * The three-way disagreement view.
 *
 * This is the module's reason for existing: camp occupancy, work attendance
 * and the roster are separate records, and the interesting information is
 * where they contradict each other. A system that merges them has nothing to
 * show here, which is exactly the problem.
 */
export function ReconciliationPanel({ data }: { data: Reconciliation }) {
  const t = useTranslations("attendance");

  const buckets: {
    key: string;
    label: string;
    icon: typeof BedDouble;
    tone: StatusTone;
    rows: AttendanceRow[] | null;
  }[] = [
    {
      key: "inCampNotAtWork",
      label: t("inCampNotAtWork"),
      icon: BedDouble,
      tone: "danger",
      rows: data.inCampNotAtWork,
    },
    {
      key: "atWorkNotInCamp",
      label: t("atWorkNotInCamp"),
      icon: UserX,
      tone: "plan",
      rows: data.atWorkNotInCamp,
    },
    {
      key: "bookedNotCheckedIn",
      label: t("bookedNotCheckedIn"),
      icon: BedDouble,
      tone: "warn",
      rows: data.bookedNotCheckedIn,
    },
    {
      key: "unrostered",
      label: t("unrostered"),
      icon: CalendarX,
      tone: "accent",
      rows: data.unrostered,
    },
    {
      key: "unexplainedAbsence",
      label: t("unexplainedAbsence"),
      icon: TriangleAlert,
      tone: "danger",
      rows: data.unexplainedAbsence,
    },
  ];

  const TONE_TEXT: Record<StatusTone, string> = {
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    plan: "text-plan",
    accent: "text-accent",
    neutral: "text-text-3",
  };

  return (
    <Panel className="flex min-h-0 w-80 shrink-0 flex-col border-0 border-l border-line">
      <div className="border-b border-line p-4">
        <h2 className="text-sm font-semibold text-text">{t("reconciliation")}</h2>
        <p className="mt-1 text-2xs leading-relaxed text-text-3">{t("reconciliationNote")}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {buckets.map((bucket) => (
          <section key={bucket.key} className="border-b border-line-soft last:border-b-0">
            <div className="flex items-center gap-2 px-4 py-2">
              <bucket.icon className={`size-3.5 shrink-0 ${TONE_TEXT[bucket.tone]}`} aria-hidden />
              <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-text-2">
                {bucket.label}
              </h3>
              {bucket.rows === null ? (
                <EyeOff className="size-3 shrink-0 text-text-3" aria-hidden />
              ) : (
                <span className={`tnum shrink-0 text-sm font-semibold ${bucket.rows.length > 0 ? TONE_TEXT[bucket.tone] : "text-text-3"}`}>
                  {bucket.rows.length}
                </span>
              )}
            </div>

            {bucket.rows === null ? (
              // Not "0". A figure this actor may not compute is unknown, and
              // showing zero would read as "no discrepancies".
              <p className="px-4 pb-2 text-2xs text-text-3">{t("campUnknown")}</p>
            ) : bucket.rows.length === 0 ? (
              <p className="px-4 pb-2 text-2xs text-text-3">{t("noneToday")}</p>
            ) : (
              <ul className="pb-1.5">
                {bucket.rows.slice(0, 8).map((row) => (
                  <li key={row.employeeId} className="flex items-center gap-2 px-4 py-1">
                    <Avatar name={row.displayName} tone={row.avatarColor as StatusTone} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-2xs text-text-2">
                      {row.displayName}
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-text-3">
                      {row.employeeCode}
                    </span>
                  </li>
                ))}
                {bucket.rows.length > 8 && (
                  <li className="px-4 py-1 text-2xs text-text-3">+{bucket.rows.length - 8}</li>
                )}
              </ul>
            )}
          </section>
        ))}
      </div>
    </Panel>
  );
}
