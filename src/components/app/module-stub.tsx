import type { LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/app/page-header";

/**
 * A module that is navigable and permission-gated but not yet built.
 *
 * Deliberately not a fake screen: showing an empty table or placeholder
 * figures would be indistinguishable from a real module with no data, and
 * someone would eventually make a decision on it.
 */
export async function ModuleStub({
  titleKey,
  icon: Icon,
  phase,
  capabilities,
}: {
  titleKey: string;
  icon: LucideIcon;
  phase: number;
  capabilities: string[];
}) {
  const t = await getTranslations();

  return (
    <>
      <PageHeader pageKey="stub" title={t(titleKey)} meta={t("stub.comingSoon")} />

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <Panel className="mx-auto max-w-2xl">
          <div className="flex items-start gap-4 p-6">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface-inset">
              <Icon className="size-5 text-text-3" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-text">{t(titleKey)}</h2>
              <p className="mt-1 text-sm text-text-2">{t("stub.body")}</p>
              <p className="mt-1 text-2xs text-text-3">{t("stub.phase", { phase })}</p>

              <h3 className="mt-5 text-xs font-semibold text-text-2">{t("stub.planned")}</h3>
              <ul className="mt-2 space-y-1">
                {capabilities.map((capability) => (
                  <li key={capability} className="flex items-start gap-2 text-sm text-text-3">
                    <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-text-3" />
                    {capability}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
