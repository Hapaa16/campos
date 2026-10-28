import { setRequestLocale } from "next-intl/server";
import { Soup } from "lucide-react";
import { requireAbility } from "@/lib/authz/guard";
import { ModuleStub } from "@/components/app/module-stub";

export default async function MealsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Gated exactly as the real module will be, so the permission wiring is
  // already correct when the screens arrive.
  await requireAbility("read", "MealForecast");

  return (
    <ModuleStub
      titleKey="nav.meals"
      icon={Soup}
      phase={6}
      capabilities={
        locale === "en"
          ? [
        "Meal forecasting from rosters, occupancy and visits",
        "Dietary requirements",
        "Actual consumption counts",
        "Housekeeping, laundry and maintenance requests",
            ]
          : [
        "Хоолны урьдчилсан тооцоо (ээлж, байрлалт, зочноос)",
        "Хоолны дэглэм, харшлын бүртгэл",
        "Бодит хэрэглээний тоо",
        "Аж ахуй, угаалга, засварын хүсэлт",
            ]
      }
    />
  );
}
