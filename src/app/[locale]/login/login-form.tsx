"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { signInAction, type SignInResult } from "@/server/actions/session";
import { cn } from "@/lib/utils";

export interface DemoAccount {
  email: string;
  name: string;
  orgName: string;
  roleLabel: string;
}

export function LoginForm({
  next,
  demoAccounts,
}: {
  next?: string;
  demoAccounts: DemoAccount[];
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  const [state, formAction, pending] = useActionState<SignInResult | null, FormData>(
    signInAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok && state.redirectTo) {
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="w-full max-w-sm">
      <div className="mb-7 flex items-center gap-2.5 lg:hidden">
        <span
          aria-hidden
          className="flex size-6 items-center justify-center rounded-[6px] bg-accent text-xs font-bold text-on-accent"
        >
          C
        </span>
        <span className="text-md font-semibold tracking-tight text-text">CampOS</span>
      </div>

      <h1 className="text-xl font-semibold tracking-tight text-text">{t("signInTitle")}</h1>

      <form action={formAction} className="mt-6 space-y-3.5">
        <input type="hidden" name="next" value={next ?? ""} />

        <div className="space-y-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="hr@campos.mn"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {state?.ok === false && (
          <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-2.5 py-2 text-sm text-danger">
            {t("invalidCredentials")}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {t("signIn")}
        </Button>
      </form>

      {demoAccounts.length > 0 && (
        <section className="mt-8 border-t border-line pt-5">
          <h2 className="text-xs font-semibold text-text-2">{t("demoAccounts")}</h2>
          <p className="mt-0.5 text-2xs text-text-3">{t("demoHint")}</p>

          <ul className="mt-3 max-h-64 space-y-px overflow-y-auto pr-1">
            {demoAccounts.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword("demo");
                  }}
                  className={cn(
                    "ui-transition group flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left",
                    "hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent-soft",
                    email === account.email && "bg-accent-soft",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text">
                      {account.roleLabel}
                    </span>
                    <span className="block truncate text-2xs text-text-3">
                      {account.email} · {account.orgName}
                    </span>
                  </span>
                  <ArrowRight className="size-3 shrink-0 text-text-3 opacity-0 ui-transition group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
