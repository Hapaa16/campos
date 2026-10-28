import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Rendered by Next when a page calls forbidden(). Server-rendered with a 403,
 * so the denial is visible to monitoring and to the user on first paint.
 */
export default async function Forbidden() {
  const t = await getTranslations("errors");
  return (
    <div
      data-boundary="forbidden"
      className="flex min-h-dvh items-center justify-center bg-canvas"
    >
      <EmptyState icon={ShieldAlert} title={t("forbiddenTitle")} description={t("forbiddenBody")} />
    </div>
  );
}
