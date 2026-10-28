"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * A 403 and a crash are different situations and must not look the same: one
 * means "ask an administrator", the other means "try again or report it".
 */
export default function OrgError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const tc = useTranslations("common");

  useEffect(() => {
    console.error("[boundary]", error);
  }, [error]);

  const forbidden = error.message.includes("эрх") || error.name === "ForbiddenError";

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState
        icon={forbidden ? ShieldAlert : TriangleAlert}
        title={forbidden ? t("forbiddenTitle") : t("genericTitle")}
        description={forbidden ? t("forbiddenBody") : t("genericBody")}
        action={
          forbidden ? undefined : (
            <Button variant="secondary" size="sm" onClick={reset}>
              {tc("retry")}
            </Button>
          )
        }
      />
    </div>
  );
}
