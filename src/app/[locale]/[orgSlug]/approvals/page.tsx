import { setRequestLocale } from "next-intl/server";
import { requireAbility } from "@/lib/authz/guard";
import { getApprovals } from "@/server/services/approvals";
import { ApprovalsView } from "@/features/approvals/approvals-view";

export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
}) {
  const { locale, orgSlug } = await params;
  setRequestLocale(locale);

  const ctx = await requireAbility("approve", "LeaveRequest");
  return <ApprovalsView data={getApprovals(ctx)} orgSlug={orgSlug} />;
}
