"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Check, EyeOff, Loader2, Lock, Minus, Shield, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { Tooltip } from "@/components/ui/tooltip";
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/app/page-header";
import { usePermission } from "@/components/app/ability-provider";
import { editRoleAction } from "@/server/actions/roles";
import type { CellState, RoleMatrix } from "@/server/services/roles";
import type { PermissionTuple, RoleDefinition } from "@/lib/authz/types";
import { cn } from "@/lib/utils";

export function RolesView({
  roles,
  matrix,
  selectedRoleId,
  orgSlug,
}: {
  roles: RoleDefinition[];
  matrix: RoleMatrix | null;
  selectedRoleId: string | null;
  orgSlug: string;
}) {
  const t = useTranslations("settings");
  const locale = useLocale() === "en" ? "en" : "mn";
  const router = useRouter();
  const mayEdit = usePermission("update", "Role");

  return (
    <>
      <PageHeader pageKey="settings-roles" title={t("roles")} meta={t("rolesSubtitle")} />

      <div className="flex min-h-0 flex-1">
        {/* ---- role list ------------------------------------------------- */}
        <nav aria-label={t("roles")} className="w-64 shrink-0 overflow-y-auto border-r border-line">
          <ul className="p-2">
            {roles.map((role) => (
              <li key={role.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/${orgSlug}/settings/roles?role=${role.id}`)}
                  className={cn(
                    "ui-transition w-full rounded-[var(--radius-control)] px-2 py-1.5 text-left",
                    selectedRoleId === role.id ? "bg-accent-soft" : "hover:bg-surface-3",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate text-sm",
                        selectedRoleId === role.id ? "font-medium text-text" : "text-text-2",
                      )}
                    >
                      {role.name[locale]}
                    </span>
                    {role.scope === "platform" && (
                      <Lock className="size-3 shrink-0 text-text-3" aria-label={t("systemRole")} />
                    )}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-2xs text-text-3">
                    {role.id}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* ---- matrix + rules -------------------------------------------- */}
        <div className="min-w-0 flex-1 overflow-auto p-3">
          {!matrix ? (
            <p className="p-6 text-center text-sm text-text-3">{t("noPermission")}</p>
          ) : (
            <div className="space-y-3">
              <Panel className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-md font-semibold tracking-tight text-text">
                      {matrix.role.name[locale]}
                    </h2>
                    <p className="mt-0.5 text-sm text-text-3">{matrix.role.description[locale]}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {matrix.role.system && <StatusChip tone="neutral">{t("systemRole")}</StatusChip>}
                    <StatusChip tone="accent" dot={false}>
                      {matrix.assignedUsers}
                    </StatusChip>
                  </div>
                </div>
                <p className="mt-3 rounded-[var(--radius-control)] bg-surface-inset px-2.5 py-2 text-2xs text-text-3">
                  {t("uiOnlyNote")}
                </p>
              </Panel>

              <MatrixTable matrix={matrix} />

              <RuleList
                matrix={matrix}
                orgSlug={orgSlug}
                mayEdit={mayEdit}
                onChanged={() => router.refresh()}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- matrix ---- */

function MatrixTable({ matrix }: { matrix: RoleMatrix }) {
  const t = useTranslations("settings");
  const ta = useTranslations("action");

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold text-text">{t("permissionMatrix")}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-2xs text-text-3">
          <Legend icon={<Check className="size-3 text-ok" />} label={t("legendAllow")} />
          <Legend icon={<Target className="size-3 text-warn" />} label={t("legendScoped")} />
          <Legend icon={<EyeOff className="size-3 text-plan" />} label={t("legendFields")} />
          <Legend icon={<Ban className="size-3 text-danger" />} label={t("legendDeny")} />
          <Legend icon={<Minus className="size-3 text-text-3" />} label={t("noPermission")} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-text-3">
                {t("subject")}
              </th>
              {matrix.actions.map((action) => (
                <th
                  key={action}
                  className="px-1.5 py-2 text-center text-2xs font-semibold uppercase tracking-wider text-text-3"
                >
                  {ta(action)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {matrix.subjects.map((subject) => (
              <tr key={subject} className="ui-transition hover:bg-surface-3">
                <td className="sticky left-0 z-10 truncate bg-surface px-4 py-1 font-mono text-xs text-text-2">
                  {subject}
                </td>
                {matrix.actions.map((action) => (
                  <td key={action} className="px-1.5 py-1 text-center">
                    <Cell state={matrix.cells[subject][action]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Legend({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1">
      {icon}
      {label}
    </span>
  );
}

function Cell({ state }: { state: CellState }) {
  const t = useTranslations("settings");

  if (state.kind === "none") {
    return <Minus className="mx-auto size-3 text-text-3/50" aria-label={t("noPermission")} />;
  }

  if (state.kind === "deny") {
    return (
      // An explicit denial is not the same as an absent grant: it overrides
      // everything else, including an admin's `manage all`.
      <Tooltip content={state.reason ?? t("inheritedDenied")}>
        <Ban className="mx-auto size-3.5 text-danger" aria-label={t("inheritedDenied")} />
      </Tooltip>
    );
  }

  const icon = state.fieldLimited ? (
    <EyeOff className="size-3.5 text-plan" />
  ) : state.scoped ? (
    <Target className="size-3.5 text-warn" />
  ) : (
    <Check className="size-3.5 text-ok" />
  );

  const label = state.fieldLimited
    ? t("fieldRestricted")
    : state.scoped
      ? t("scopedGrant")
      : t("legendAllow");

  return (
    <Tooltip content={label}>
      <span className="mx-auto flex justify-center" aria-label={label}>
        {icon}
      </span>
    </Tooltip>
  );
}

/* -------------------------------------------------------------- rules ---- */

function RuleList({
  matrix,
  orgSlug,
  mayEdit,
  onChanged,
}: {
  matrix: RoleMatrix;
  orgSlug: string;
  mayEdit: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [removing, setRemoving] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const remove = (index: number) => {
    startTransition(async () => {
      const result = await editRoleAction(
        { roleId: matrix.role.id, index, remove: true },
        reason.trim(),
        orgSlug,
      );
      setRemoving(null);
      setReason("");
      if (!result.ok) {
        toast.error(result.error ?? te("genericBody"));
        return;
      }
      toast.success(t("ruleRemoved"), { description: t("sessionsInvalidated") });
      onChanged();
    });
  };

  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-text">{t("rules")}</h3>
          <p className="mt-0.5 text-2xs text-text-3">{t("rulesNote")}</p>
        </div>
        <span className="tnum text-2xs text-text-3">{matrix.role.permissions.length}</span>
      </div>

      <ul className="divide-y divide-line-soft">
        {matrix.role.permissions.map((tuple, index) => (
          <li key={index} className="px-4 py-2.5">
            <div className="flex items-start gap-3">
              <Shield
                className={cn("mt-0.5 size-3.5 shrink-0", tuple.inverted ? "text-danger" : "text-ok")}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-text">
                  <span className={tuple.inverted ? "text-danger" : "text-ok"}>
                    {tuple.inverted ? "cannot" : "can"}
                  </span>{" "}
                  {asList(tuple.action)}{" "}
                  <span className="text-text-2">{asList(tuple.subject)}</span>
                </p>
                <RuleDetail tuple={tuple} />
              </div>

              {mayEdit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tc("delete")}
                  onClick={() => setRemoving(removing === index ? null : index)}
                >
                  <Trash2 className="text-danger" />
                </Button>
              )}
            </div>

            {removing === index && (
              <div className="mt-2 flex items-end gap-2 rounded-[var(--radius-control)] bg-surface-inset p-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`rule-reason-${index}`}>
                    {tc("reason")} <span className="text-danger">*</span>
                  </Label>
                  <Input
                    id={`rule-reason-${index}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="h-[var(--control-h-sm)]"
                    autoFocus
                  />
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
                  {tc("cancel")}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!reason.trim() || pending}
                  onClick={() => remove(index)}
                >
                  {pending && <Loader2 className="animate-spin" />}
                  {tc("delete")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RuleDetail({ tuple }: { tuple: PermissionTuple }) {
  const t = useTranslations("settings");

  return (
    <div className="mt-1 space-y-0.5">
      {tuple.conditions && (
        <p className="flex items-start gap-1 text-2xs text-warn">
          <Target className="mt-0.5 size-2.5 shrink-0" aria-hidden />
          <span className="font-mono">{JSON.stringify(tuple.conditions)}</span>
        </p>
      )}
      {tuple.fields && (
        <p className="flex items-start gap-1 text-2xs text-plan">
          <EyeOff className="mt-0.5 size-2.5 shrink-0" aria-hidden />
          <span>
            {t("fieldRestricted")} · {tuple.fields.length}
          </span>
        </p>
      )}
      {tuple.reason && <p className="text-2xs text-text-3">{tuple.reason}</p>}
    </div>
  );
}

function asList(value: string | string[]) {
  return Array.isArray(value) ? value.join(", ") : value;
}
