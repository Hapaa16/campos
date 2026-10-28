import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, EyeOff, ShieldAlert, ShieldCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireContext } from "@/lib/authz/guard";
import { getEmployee } from "@/server/services/employees";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Avatar } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import type { EmploymentStatus } from "@/server/db/schema";

const STATUS_TONE: Record<EmploymentStatus, StatusTone> = {
  active: "ok",
  on_leave: "plan",
  suspended: "warn",
  terminated: "neutral",
};
const STATUS_KEY: Record<EmploymentStatus, string> = {
  active: "statusActive",
  on_leave: "statusOnLeave",
  suspended: "statusSuspended",
  terminated: "statusTerminated",
};

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; orgSlug: string; employeeId: string }>;
}) {
  const { locale, orgSlug, employeeId } = await params;
  setRequestLocale(locale);

  const ctx = await requireContext();
  // Throws NotFoundError for an id outside this actor's scope — a foreign id
  // must look like a typo, not like a locked door.
  const detail = getEmployee(ctx, employeeId);
  const e = detail.employee;

  const t = await getTranslations("workforce");
  const tc = await getTranslations("common");
  const format = await getFormatter();

  const field = (label: string, value: React.ReactNode) => (
    <div key={label} className="flex min-w-0 gap-3 py-1.5">
      <dt className="w-40 shrink-0 text-xs text-text-3">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-sm text-text">{value ?? "—"}</dd>
    </div>
  );

  const PERSONAL_FIELDS = [
    "nationalId",
    "passportNo",
    "dateOfBirth",
    "personalPhone",
    "personalEmail",
    "homeAddress",
  ] as const;
  const hasPersonalData = PERSONAL_FIELDS.some((f) => f in e);
  const hasEmergencyContact =
    "emergencyContactName" in e || "emergencyContactPhone" in e;

  return (
    <>
      <PageHeader
        title={e.displayName ?? "—"}
        meta={e.employeeCode}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/${orgSlug}/workforce`}>
              <ArrowLeft /> {t("title")}
            </Link>
          </Button>
        }
      />

      <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start">
        <div className="space-y-3">
          <Panel>
            <div className="flex items-start gap-3 p-4">
              <Avatar name={e.displayName ?? "?"} tone={(e.avatarColor as StatusTone) ?? "neutral"} size="md" className="size-10 text-sm" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold tracking-tight text-text">
                  {e.firstName} {e.lastName}
                </h2>
                <p className="truncate text-sm text-text-3">{e.jobTitle}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {e.status && (
                    <StatusChip tone={STATUS_TONE[e.status]}>{t(STATUS_KEY[e.status])}</StatusChip>
                  )}
                  {e.employmentType && e.employmentType !== "employee" && (
                    <StatusChip tone="warn">
                      {t(e.employmentType === "contractor" ? "typeContractor" : "typeSubcontractor")}
                      {e.contractorCompany ? ` · ${e.contractorCompany}` : ""}
                    </StatusChip>
                  )}
                </div>
              </div>
            </div>

            <dl className="divide-y divide-line-soft border-t border-line px-4 py-2">
              {field(t("position"), detail.positionTitle)}
              {field(t("orgUnit"), detail.orgUnitName)}
              {field(t("site"), detail.siteName)}
              {field(t("camp"), detail.campName)}
              {field(t("supervisor"), detail.supervisorName)}
              {field(
                t("hiredAt"),
                e.hiredAt ? format.dateTime(new Date(e.hiredAt), { dateStyle: "long" }) : null,
              )}
              {field(t("workEmail"), e.workEmail)}
              {field(t("workPhone"), e.workPhone)}
            </dl>
          </Panel>

          <Panel>
            <PanelHeader
              title={t("qualifications")}
              description={`${detail.qualifications.length}`}
            />
            {detail.qualifications.length > 0 ? (
              <ul className="divide-y divide-line-soft">
                {detail.qualifications.map((q) => {
                  const expired = q.state === "expired";
                  const soon = q.state === "expiring";
                  return (
                    <li key={q.code} className="flex items-center gap-3 px-4 py-2">
                      {expired ? (
                        <ShieldAlert className="size-4 shrink-0 text-danger" aria-hidden />
                      ) : (
                        <ShieldCheck className={`size-4 shrink-0 ${soon ? "text-warn" : "text-ok"}`} aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">{q.name}</span>
                        <span className="block truncate font-mono text-2xs text-text-3">{q.code}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <StatusChip
                          tone={expired ? "danger" : soon ? "warn" : "ok"}
                          dot={false}
                        >
                          {expired ? t("expired") : soon ? t("expiringSoon") : t("valid")}
                        </StatusChip>
                        {q.expiresAt && (
                          <span className="tnum mt-0.5 block text-2xs text-text-3">
                            {format.dateTime(new Date(q.expiresAt), { dateStyle: "short" })}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title={tc("none")} />
            )}
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel>
            <PanelHeader title={t("personalData")} />
            {hasPersonalData ? (
              <dl className="divide-y divide-line-soft px-4 py-2">
                {field(t("nationalId"), e.nationalId)}
                {field(t("passportNo"), e.passportNo)}
                {field(
                  t("dateOfBirth"),
                  e.dateOfBirth ? format.dateTime(new Date(e.dateOfBirth), { dateStyle: "medium" }) : null,
                )}
                {field(t("personalPhone"), e.personalPhone)}
                {field(t("personalEmail"), e.personalEmail)}
                {field(t("homeAddress"), e.homeAddress)}
              </dl>
            ) : (
              // Honest absence: the record exists and has these fields, the
              // actor simply may not read them. Rendering nothing at all would
              // imply the data was never collected.
              <EmptyState
                icon={EyeOff}
                title={tc("restricted")}
                description={t("personalDataHidden")}
              />
            )}
          </Panel>

          {hasEmergencyContact && (
            <Panel>
              <PanelHeader title={t("emergencyContact")} />
              <dl className="divide-y divide-line-soft px-4 py-2">
                {field(t("name"), e.emergencyContactName)}
                {field(t("personalPhone"), e.emergencyContactPhone)}
                {field(t("relation"), e.emergencyContactRelation)}
              </dl>
            </Panel>
          )}

          {detail.directReports.length > 0 && (
            <Panel>
              <PanelHeader
                title={t("directReports")}
                description={`${detail.directReports.length}`}
              />
              <ul className="divide-y divide-line-soft">
                {detail.directReports.map((report) => (
                  <li key={report.id}>
                    <Link
                      href={`/${orgSlug}/workforce/${report.id}`}
                      className="ui-transition flex items-center gap-2 px-4 py-1.5 hover:bg-surface-3"
                    >
                      <Avatar name={report.displayName} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">{report.displayName}</span>
                        <span className="block truncate text-2xs text-text-3">{report.jobTitle}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
