import { getTranslations, setRequestLocale } from "next-intl/server";
import { Bed, Building2, Sparkles, TriangleAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireAbility } from "@/lib/authz/guard";
import { getCampBoard } from "@/server/services/camps";
import { Panel } from "@/components/ui/panel";
import { CapacityBar } from "@/components/data/stat-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/app/page-header";

export default async function CampsPage({
  params,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
}) {
  const { locale, orgSlug } = await params;
  setRequestLocale(locale);

  const ctx = await requireAbility("read", "Camp");
  const board = getCampBoard(ctx, { days: 1 });
  const t = await getTranslations("camp");
  const nf = new Intl.NumberFormat(locale === "en" ? "en-US" : "mn-MN");

  if (board.camps.length === 0) {
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState className="flex-1" icon={Building2} title={t("noCampAccess")} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("title")} meta={`${board.camps.length}`} />

      <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 lg:grid-cols-2 xl:grid-cols-3">
        {board.camps.map((camp) => {
          const utilisation =
            camp.serviceable > 0 ? Math.round((camp.occupied / camp.serviceable) * 100) : 0;

          return (
            <Panel key={camp.camp.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2 border-b border-line p-4">
                <div className="min-w-0">
                  <h2 className="truncate text-md font-semibold tracking-tight text-text">
                    {camp.camp.name}
                  </h2>
                  <p className="truncate text-2xs text-text-3">
                    {camp.siteName} · {camp.camp.code}
                  </p>
                </div>
                <StatusChip
                  tone={utilisation > 92 ? "danger" : utilisation > 80 ? "warn" : "ok"}
                  dot={false}
                >
                  {utilisation}%
                </StatusChip>
              </div>

              <div className="p-4">
                <CapacityBar
                  total={camp.totalBeds || 1}
                  segments={[
                    { value: camp.occupied, tone: "ok", label: t("checkedIn") },
                    { value: camp.reserved, tone: "plan", label: t("reserved") },
                    { value: camp.unavailable, tone: "danger", label: t("maintenance") },
                  ]}
                />

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {[
                    // Actual presence and planned reservations are listed as
                    // separate lines, never as one "in camp" figure.
                    [t("checkedIn"), camp.occupied, "text-ok"],
                    [t("reserved"), camp.reserved, "text-plan"],
                    [t("available"), camp.free, camp.free < 10 ? "text-danger" : "text-text"],
                    [t("maintenance"), camp.unavailable, "text-text-3"],
                  ].map(([label, value, tone]) => (
                    <div key={String(label)} className="flex items-baseline justify-between gap-2">
                      <dt className="truncate text-xs text-text-3">{label}</dt>
                      <dd className={`tnum text-sm font-medium ${tone}`}>{nf.format(Number(value))}</dd>
                    </div>
                  ))}
                </dl>

                {(camp.noShows > 0 || camp.housekeepingDirty > 0) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {camp.noShows > 0 && (
                      <StatusChip tone="danger">
                        <TriangleAlert className="size-3" aria-hidden />
                        {camp.noShows} {t("noShow").toLowerCase()}
                      </StatusChip>
                    )}
                    {camp.housekeepingDirty > 0 && (
                      <StatusChip tone="warn">
                        <Sparkles className="size-3" aria-hidden />
                        {camp.housekeepingDirty} {t("dirty").toLowerCase()}
                      </StatusChip>
                    )}
                  </div>
                )}
              </div>

              <Link
                href={`/${orgSlug}/accommodation?camp=${camp.camp.id}`}
                className="ui-transition mt-auto flex items-center gap-1.5 border-t border-line px-4 py-2 text-xs text-accent hover:bg-surface-3"
              >
                <Bed className="size-3.5" aria-hidden />
                {t("accommodationTitle")}
              </Link>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
