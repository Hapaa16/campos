import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/server/db/store";
import { ROLE_BY_ID } from "@/lib/authz/roles";
import { LoginForm, type DemoAccount } from "./login-form";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next } = await searchParams;
  const t = await getTranslations("auth");
  const pillars = (await getTranslations("auth")).raw("pillars") as {
    term: string;
    desc: string;
  }[];

  // Dev convenience: one login per role, so the permission differences are
  // inspectable in seconds rather than by hand-editing memberships.
  const demoAccounts: DemoAccount[] =
    process.env.NODE_ENV === "production"
      ? []
      : db().users.map((u) => {
          const roleIds = u.memberships.flatMap((m) => m.roleIds);
          const org = db().organizations.find((o) => o.id === u.memberships[0]?.organizationId);
          return {
            email: u.email,
            name: u.name,
            orgName: org?.name ?? "",
            roleLabel: roleIds
              .map((id) => ROLE_BY_ID.get(id)?.name[locale === "en" ? "en" : "mn"] ?? id)
              .join(", "),
          };
        });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Framing panel. Quiet: one accent hairline, no stock photography. */}
      <aside className="relative hidden flex-col justify-between border-r border-line bg-surface p-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-[6px] bg-accent text-xs font-bold text-on-accent"
          >
            C
          </span>
          <span className="text-md font-semibold tracking-tight text-text">CampOS</span>
        </div>

        <div className="max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight text-text">{t("signInSubtitle")}</h2>
          <dl className="mt-8 space-y-4">
            {pillars.map((pillar) => (
              <div key={pillar.term} className="border-l-2 border-accent-line pl-3">
                <dt className="text-sm font-medium text-text">{pillar.term}</dt>
                <dd className="mt-0.5 text-sm text-text-3">{pillar.desc}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-2xs text-text-3">{t("phaseNote")}</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <LoginForm next={next} demoAccounts={demoAccounts} />
      </main>
    </div>
  );
}
