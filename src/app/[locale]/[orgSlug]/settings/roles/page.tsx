import { setRequestLocale } from "next-intl/server";
import { requireAbility } from "@/lib/authz/guard";
import { getRoleMatrix, listRoles } from "@/server/services/roles";
import { RolesView } from "@/features/settings/roles-view";

export default async function RolesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { locale, orgSlug } = await params;
  setRequestLocale(locale);

  const ctx = await requireAbility("read", "Role");
  const { role } = await searchParams;

  const roles = listRoles(ctx);
  const selectedRoleId = role && roles.some((r) => r.id === role) ? role : (roles[0]?.id ?? null);
  const matrix = selectedRoleId ? getRoleMatrix(ctx, selectedRoleId) : null;

  return (
    <RolesView
      roles={roles}
      matrix={matrix}
      selectedRoleId={selectedRoleId}
      orgSlug={orgSlug}
    />
  );
}
