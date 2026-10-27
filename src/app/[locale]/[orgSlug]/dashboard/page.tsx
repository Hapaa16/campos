import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  BedDouble,
  CalendarCheck,
  ClipboardCheck,
  LogIn,
  LogOut,
  ShieldAlert,
  TriangleAlert,
  Users,
} from "lucide-react";
import { requireContext } from "@/lib/authz/guard";
import { getDashboard } from "@/server/services/dashboard";
import { StatTile, CapacityBar } from "@/components/data/stat-tile";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireContext();
  const data = getDashboard(ctx);
  const t = await getTranslations("dashboard");
  const tc = await getTranslations("camp");

  const nf = new Intl.NumberFormat(locale === "en" ? "en-US" : "mn-MN");

  /* The widget set is assembled from what the actor may know. A camp manager
     and an HR manager therefore open genuinely different screens, rather than
     the same screen with half the numbers blanked out. */
  const tiles = [
    data.inCamp !== null && {
      key: "inCamp",
      label: t("inCamp"),
      value: nf.format(data.inCamp),
      icon: BedDouble,
      hint: tc("plannedNote"),
    },
    data.freeBeds !== null && {
      key: "freeBeds",
      label: t("freeBeds"),
      value: nf.format(data.freeBeds),
      icon: BedDouble,
      tone: data.freeBeds < 20 ? ("danger" as const) : undefined,
      hint: data.totalBeds ? `${nf.format(data.totalBeds)} ${tc("bed").toLowerCase()}` : undefined,
    },
    data.arrivalsToday !== null && {
      key: "arrivals",
      label: t("arrivalsToday"),
      value: nf.format(data.arrivalsToday),
      icon: LogIn,
    },
    data.departuresToday !== null && {
      key: "departures",
      label: t("departuresToday"),
      value: nf.format(data.departuresToday),
      icon: LogOut,
    },
    data.headcount !== null && {
      key: "headcount",
      label: t("activeHeadcount"),
      value: nf.format(data.headcount),
      icon: Users,
    },
    data.rosterCoverage && {
      key: "coverage",
      label: t("rosterCoverage"),
      value: nf.format(data.rosterCoverage.assigned),
      unit: `/ ${nf.format(data.rosterCoverage.required)}`,
      icon: CalendarCheck,
      tone:
        data.rosterCoverage.assigned < data.rosterCoverage.required
          ? ("warn" as const)
          : ("ok" as const),
      hint: data.rosterCoverage.periodName,
    },
    data.pendingApprovals !== null && {
      key: "approvals",
      label: t("pendingApprovals"),
      value: nf.format(data.pendingApprovals),
      icon: ClipboardCheck,
      tone: data.pendingApprovals > 0 ? ("warn" as const) : undefined,
    },
    data.expiringQualifications !== null && {
      key: "quals",
      label: t("expiringQualifications"),
      value: nf.format(data.expiringQualifications),
      icon: ShieldAlert,
      tone: data.expiringQualifications > 0 ? ("warn" as const) : undefined,
    },
    data.noShows !== null && {
      key: "noShows",
      label: t("openExceptions"),
      value: nf.format(data.noShows),
      icon: TriangleAlert,
      tone: data.noShows > 0 ? ("danger" as const) : undefined,
      hint: tc("noShow"),
    },
  ].filter(Boolean) as {
    key: string;
    label: string;
    value: string;
    unit?: string;
    icon: typeof Users;
    tone?: "warn" | "danger" | "ok";
    hint?: string;
  }[];

  return (
    <>
      <PageHeader title={t("title")} />

      <div className="p-3">
        {tiles.length === 0 ? (
          <EmptyState icon={ShieldAlert} title={t("noWidgets")} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {tiles.map((tile) => (
              <StatTile
                key={tile.key}
                label={tile.label}
                value={tile.value}
                unit={tile.unit}
                icon={tile.icon}
                tone={tile.tone}
                hint={tile.hint}
              />
            ))}
          </div>
        )}

        {data.occupancyByCamp.length > 0 && (
          <Panel className="mt-3">
            <PanelHeader title={t("occupancyByCamp")} />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-2xs uppercase tracking-wider text-text-3">
                  <th className="px-4 py-2 font-semibold">{tc("title")}</th>
                  <th className="w-56 px-4 py-2 font-semibold">{tc("occupancy")}</th>
                  <th className="w-24 px-4 py-2 text-right font-semibold">{tc("checkedIn")}</th>
                  <th className="w-24 px-4 py-2 text-right font-semibold">{tc("reserved")}</th>
                  <th className="w-24 px-4 py-2 text-right font-semibold">{tc("available")}</th>
                  <th className="w-24 px-4 py-2 text-right font-semibold">{tc("maintenance")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.occupancyByCamp.map((camp) => {
                  const free =
                    camp.totalBeds - camp.occupied - camp.reserved - camp.unavailable;
                  return (
                    <tr key={camp.campId} className="ui-transition hover:bg-surface-3">
                      <td className="truncate px-4 py-2 font-medium text-text">{camp.campName}</td>
                      <td className="px-4 py-2">
                        <CapacityBar
                          total={camp.totalBeds}
                          segments={[
                            { value: camp.occupied, tone: "ok", label: tc("checkedIn") },
                            { value: camp.reserved, tone: "plan", label: tc("reserved") },
                            { value: camp.unavailable, tone: "danger", label: tc("maintenance") },
                          ]}
                        />
                      </td>
                      <td className="tnum px-4 py-2 text-right text-text">{nf.format(camp.occupied)}</td>
                      <td className="tnum px-4 py-2 text-right text-text-2">{nf.format(camp.reserved)}</td>
                      <td className="tnum px-4 py-2 text-right text-text-2">{nf.format(Math.max(0, free))}</td>
                      <td className="tnum px-4 py-2 text-right text-text-3">{nf.format(camp.unavailable)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </>
  );
}
