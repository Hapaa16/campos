import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAbility } from "@/lib/authz/guard";
import { db } from "@/server/db/store";
import { query } from "@/server/db/query";
import { listEmployees, getWorkforceFilterOptions, type EmployeeSort } from "@/server/services/employees";
import { WorkforceView } from "@/features/workforce/workforce-view";
import { PageHeader } from "@/components/app/page-header";
import type { EmploymentStatus, EmploymentType } from "@/server/db/schema";

const PAGE_SIZE = 100;

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.split(",").filter(Boolean);
}

export default async function WorkforcePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, orgSlug } = await params;
  setRequestLocale(locale);

  // Layer 2: entering the page at all requires read Employee. The row-level
  // scoping that follows is layer 3, inside listEmployees().
  const ctx = await requireAbility("read", "Employee");
  const sp = await searchParams;

  const result = listEmployees(ctx, {
    search: typeof sp.q === "string" ? sp.q : undefined,
    status: toArray(sp.status) as EmploymentStatus[],
    employmentType: toArray(sp.type) as EmploymentType[],
    siteIds: toArray(sp.site),
    sort: (typeof sp.sort === "string" ? sp.sort : "name") as EmployeeSort,
    offset: Number(sp.offset ?? 0) || 0,
    limit: PAGE_SIZE,
  });

  const data = db();
  const unitNames = Object.fromEntries(
    query(ctx, "OrgUnit", data.orgUnits).all().map((u) => [u.id, u.name]),
  );
  const siteNames = Object.fromEntries(
    query(ctx, "Site", data.sites).all().map((s) => [s.id, s.name]),
  );
  const options = getWorkforceFilterOptions(ctx);

  const t = await getTranslations("workforce");
  const nf = new Intl.NumberFormat(locale === "en" ? "en-US" : "mn-MN");

  return (
    <>
      <PageHeader pageKey="workforce" title={t("title")} meta={`${nf.format(result.total)}`} />
      <WorkforceView
        rows={result.items as { id: string }[] as never}
        total={result.total}
        offset={result.offset}
        limit={result.limit}
        withheld={result.withheld}
        facets={result.facets}
        unitNames={unitNames}
        siteNames={siteNames}
        sites={options.sites}
        orgSlug={orgSlug}
      />
    </>
  );
}
