import { setRequestLocale } from "next-intl/server";
import { requireAbility } from "@/lib/authz/guard";
import { getCampBoard } from "@/server/services/camps";
import { AccommodationView } from "@/features/camps/accommodation-view";

export default async function AccommodationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, orgSlug } = await params;
  setRequestLocale(locale);

  const ctx = await requireAbility("read", "AccommodationBooking");
  const sp = await searchParams;

  const data = getCampBoard(ctx, {
    campId: typeof sp.camp === "string" && sp.camp ? sp.camp : undefined,
    buildingId: typeof sp.building === "string" && sp.building ? sp.building : undefined,
    from: typeof sp.from === "string" && sp.from ? sp.from : undefined,
    days: Number(sp.days ?? 14) || 14,
    freeOnly: sp.free === "true",
    search: typeof sp.q === "string" ? sp.q : undefined,
  });

  return <AccommodationView data={data} orgSlug={orgSlug} />;
}
