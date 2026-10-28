"use client";

import { useTranslations } from "next-intl";
import { Network, Users } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Avatar } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import type { OrgUnitDetail } from "@/server/services/org-units";

export function UnitPanel({
  detail,
  selectedId,
  orgSlug,
}: {
  detail: OrgUnitDetail | null;
  selectedId: string | null;
  orgSlug: string;
}) {
  const t = useTranslations("org");

  return (
    <aside className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface lg:flex">
      {!selectedId ? (
        <EmptyState icon={Network} title={t("noSelection")} description={t("noSelectionHint")} />
      ) : !detail ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
          <div className="pt-3" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="border-b border-line p-4">
            <p className="text-2xs font-semibold uppercase tracking-wider text-text-3">
              {detail.unit.unitTypeName}
            </p>
            <h2 className="mt-0.5 text-md font-semibold tracking-tight text-text">
              {detail.unit.name}
            </h2>
            <p className="mt-0.5 font-mono text-2xs text-text-3">
              {detail.unit.code} · {detail.unit.path}
            </p>

            <dl className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-[var(--radius-card)] border border-line bg-surface-inset p-2">
                <dt className="text-2xs text-text-3">{t("direct")}</dt>
                <dd className="tnum text-lg font-semibold text-text">{detail.unit.directHeadcount}</dd>
              </div>
              <div className="rounded-[var(--radius-card)] border border-line bg-surface-inset p-2">
                <dt className="text-2xs text-text-3">{t("subtree")}</dt>
                <dd className="tnum text-lg font-semibold text-text">{detail.unit.totalHeadcount}</dd>
              </div>
              <div className="rounded-[var(--radius-card)] border border-line bg-surface-inset p-2">
                <dt className="text-2xs text-text-3">{t("target")}</dt>
                <dd className="tnum text-lg font-semibold text-text-2">
                  {detail.unit.headcountTarget ?? "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex-1">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <h3 className="text-xs font-semibold text-text-2">{t("members")}</h3>
              <span className="tnum text-2xs text-text-3">{detail.members.length}</span>
            </div>

            {detail.members.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t("noDirectMembers")}
                description={
                  detail.unit.totalHeadcount > 0 ? t("noDirectMembersHint") : undefined
                }
              />
            ) : (
              <ul className="divide-y divide-line-soft">
                {detail.members.map((member) => (
                  <li key={member.id}>
                    <Link
                      href={`/${orgSlug}/workforce/${member.id}`}
                      className="ui-transition flex items-center gap-2 px-4 py-1.5 hover:bg-surface-3"
                    >
                      <Avatar name={member.displayName} tone={member.avatarColor as StatusTone} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">{member.displayName}</span>
                        <span className="block truncate text-2xs text-text-3">{member.jobTitle}</span>
                      </span>
                      {member.supervisorUnitName && (
                        // Flags a reporting line that crosses the structure —
                        // the case the chart alone cannot show.
                        <StatusChip tone="accent" dot={false} className="shrink-0">
                          ↗
                        </StatusChip>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {detail.externalReportingUnitIds.length > 0 && (
            <div className="border-t border-line p-4">
              <h3 className="text-xs font-semibold text-text-2">{t("externalReports")}</h3>
              <p className="mt-1 text-2xs text-text-3">{t("externalReportsNote")}</p>
              <ul className="mt-2 space-y-1">
                {detail.members
                  .filter((m) => m.supervisorUnitName)
                  .map((m) => (
                    <li key={m.id} className="truncate text-2xs text-text-3">
                      <span className="text-text-2">{m.displayName}</span> → {m.supervisorName} ·{" "}
                      {m.supervisorUnitName}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
