import { getTranslations } from "next-intl/server";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default async function OrgNotFound() {
  const t = await getTranslations("errors");
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState icon={FileQuestion} title={t("notFoundTitle")} description={t("notFoundBody")} />
    </div>
  );
}
