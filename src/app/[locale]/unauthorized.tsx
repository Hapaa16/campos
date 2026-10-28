import { getTranslations } from "next-intl/server";
import { LogIn } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default async function Unauthorized() {
  const t = await getTranslations("auth");
  return (
    <div
      data-boundary="unauthorized"
      className="flex min-h-dvh items-center justify-center bg-canvas"
    >
      <EmptyState
        icon={LogIn}
        title={t("signInTitle")}
        action={
          <Button variant="primary" size="sm" asChild>
            <Link href="/login">{t("signIn")}</Link>
          </Button>
        }
      />
    </div>
  );
}
