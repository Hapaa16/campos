import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { packRules } from "@casl/ability/extra";
import { AppShell } from "@/components/app/app-shell";
import { getContext } from "@/lib/authz/guard";
import { ROLE_BY_ID } from "@/lib/authz/roles";
import { getAccessibleOrganizations, getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/store";
import type { StatusTone } from "@/components/ui/status-chip";

/* ===========================================================================
   Layer 2 entry point for the whole application.

   Middleware (layer 1) has already established that a validly-signed session
   exists. This is where the question that actually matters is answered: is
   this user a member of the organization named in the URL?
   ========================================================================= */

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; orgSlug: string }>;
}) {
  const { locale, orgSlug } = await params;
  setRequestLocale(locale);

  const ctx = await getContext();
  const user = await getCurrentUser();
  if (!ctx || !user) redirect("/login");

  const org = db().organizations.find((o) => o.slug === orgSlug);
  // An unknown slug and a slug belonging to a tenant you cannot reach must be
  // indistinguishable — otherwise the 403/404 difference enumerates tenants.
  if (!org) notFound();

  if (org.id !== ctx.auth.organizationId) {
    const isMember = user.memberships.some((m) => m.organizationId === org.id);
    if (!isMember) notFound();
    // A legitimate cross-tenant bookmark: re-issue the session, then return.
    redirect(`/api/v1/session/switch?org=${org.id}&to=/${org.slug}/dashboard`);
  }

  const t = await getTranslations("nav");
  const orgOptions = (await getAccessibleOrganizations()).map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
  }));

  const roleLabels = ctx.auth.roleIds.map(
    (id) => ROLE_BY_ID.get(id)?.name[locale === "en" ? "en" : "mn"] ?? id,
  );

  return (
    <AppShell
      // Packed for the client purely to drive layer 4 (showing/hiding chrome).
      // These rules are a copy of the server's decision, not the decision itself.
      rules={packRules(ctx.ability.rules)}
      org={{ id: org.id, name: org.name, slug: org.slug }}
      orgOptions={orgOptions}
      user={{
        name: user.name,
        email: user.email,
        roleLabels,
        tone: user.avatarColor as StatusTone,
      }}
      defaultTitle={t("dashboard")}
    >
      {children}
    </AppShell>
  );
}
