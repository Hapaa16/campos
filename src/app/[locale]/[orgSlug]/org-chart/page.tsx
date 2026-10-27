import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAbility } from "@/lib/authz/guard";
import { getOrgTree } from "@/server/services/org-units";
import { OrgChartView } from "@/features/org-chart/org-chart-view";
import { PageHeader } from "@/components/app/page-header";
import { loadUnitDetailAction } from "@/server/actions/org";

export default async function OrgChartPage({
  params,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
}) {
  const { locale, orgSlug } = await params;
  setRequestLocale(locale);

  const ctx = await requireAbility("read", "OrgUnit");
  const tree = getOrgTree(ctx);
  const t = await getTranslations("org");

  return (
    <>
      <PageHeader title={t("title")} meta={`${tree.nodes.length}`} />
      <OrgChartView tree={tree} orgSlug={orgSlug} loadDetail={loadUnitDetailAction} />
    </>
  );
}
