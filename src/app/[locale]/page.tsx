import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getAuthContext } from "@/server/auth/session";
import { db } from "@/server/db/store";

/** Entry point: send the signed-in user to their active organization. */
export default async function RootPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const auth = await getAuthContext();
  if (!auth?.organizationId) redirect("/login");

  const org = db().organizations.find((o) => o.id === auth.organizationId);
  if (!org) redirect("/login");

  redirect(`/${org.slug}/dashboard`);
}
