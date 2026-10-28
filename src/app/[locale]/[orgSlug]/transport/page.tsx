import { setRequestLocale } from "next-intl/server";
import { BusFront } from "lucide-react";
import { requireAbility } from "@/lib/authz/guard";
import { ModuleStub } from "@/components/app/module-stub";

export default async function TransportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Gated exactly as the real module will be, so the permission wiring is
  // already correct when the screens arrive.
  await requireAbility("read", "TransportTrip");

  return (
    <ModuleStub
      titleKey="nav.transport"
      icon={BusFront}
      phase={4}
      capabilities={
        locale === "en"
          ? [
        "Vehicles and drivers",
        "Routes, stops and scheduled trips",
        "Passenger manifests and seat control",
        "Segment-aware seat capacity (algorithm built and tested)",
        "Boarding confirmation reconciled against camp arrivals",
            ]
          : [
        "Тээврийн хэрэгсэл, жолоочийн бүртгэл",
        "Маршрут, зогсоол, рейсийн хуваарь",
        "Зорчигчийн жагсаалт, суудлын хяналт",
        "Сегмент тус бүрийн суудлын багтаамж (алгоритм бэлэн, тестлэгдсэн)",
        "Суултын баталгаажуулалт, кэмпийн ирэлттэй тулгалт",
            ]
      }
    />
  );
}
