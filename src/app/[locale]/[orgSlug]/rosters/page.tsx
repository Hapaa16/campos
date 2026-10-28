import { setRequestLocale, getTranslations } from "next-intl/server";
import { CalendarRange } from "lucide-react";
import { requireAbility } from "@/lib/authz/guard";
import { getRosterGrid } from "@/server/services/rosters";
import { RosterView } from "@/features/rosters/roster-view";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";

export default async function RostersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, orgSlug } = await params;
  setRequestLocale(locale);

  const ctx = await requireAbility("read", "RosterPeriod");
  const sp = await searchParams;

  const data = getRosterGrid(ctx, {
    periodId: typeof sp.period === "string" ? sp.period : undefined,
    search: typeof sp.q === "string" ? sp.q : undefined,
    conflictsOnly: sp.conflicts === "true",
    limit: 200,
  });

  if (!data) {
    const t = await getTranslations("roster");
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState className="flex-1" icon={CalendarRange} title={t("empty")} description={t("emptyHint")} />
      </>
    );
  }

  return <RosterView data={data} orgSlug={orgSlug} />;
}
