import { setRequestLocale } from "next-intl/server";
import { ChartNoAxesColumn } from "lucide-react";
import { requireAbility } from "@/lib/authz/guard";
import { ModuleStub } from "@/components/app/module-stub";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Gated exactly as the real module will be, so the permission wiring is
  // already correct when the screens arrive.
  await requireAbility("read", "Report");

  return (
    <ModuleStub
      titleKey="nav.reports"
      icon={ChartNoAxesColumn}
      phase={6}
      capabilities={
        locale === "en"
          ? [
        "Headcount by organization, unit and site",
        "Roster coverage and shortfalls",
        "Camp occupancy and free-bed history",
        "Transport utilisation and cost",
        "Audit and operational exception reports",
            ]
          : [
        "Орон тооны тайлан (байгууллага, нэгж, талбайгаар)",
        "Ээлжийн хангалт, дутагдлын тайлан",
        "Кэмпийн ачаалал, сул орны түүх",
        "Тээврийн ашиглалт, зардлын тайлан",
        "Аудит болон онцгой тохиолдлын тайлан",
            ]
      }
    />
  );
}
