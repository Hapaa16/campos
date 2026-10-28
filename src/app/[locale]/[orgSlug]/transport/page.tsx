import { setRequestLocale } from "next-intl/server";
import { requireAbility } from "@/lib/authz/guard";
import { getTransportBoard } from "@/server/services/transport";
import { TransportView } from "@/features/transport/transport-view";

export default async function TransportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, orgSlug } = await params;
  setRequestLocale(locale);

  const ctx = await requireAbility("read", "TransportTrip");
  const sp = await searchParams;

  const data = getTransportBoard(ctx, {
    from: typeof sp.from === "string" && sp.from ? sp.from : undefined,
    days: Number(sp.days ?? 7) || 7,
    routeId: typeof sp.route === "string" && sp.route ? sp.route : undefined,
    search: typeof sp.q === "string" ? sp.q : undefined,
    fullOnly: sp.full === "true",
  });

  return <TransportView data={data} orgSlug={orgSlug} />;
}
