"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import type { Column, ColumnMeta } from "@/components/data/data-table";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Avatar } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import type { Employee, EmploymentStatus, EmploymentType } from "@/server/db/schema";

export type EmployeeRow = Partial<Employee> & { id: string };

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

const TYPE_KEY: Record<EmploymentType, string> = {
  employee: "typeEmployee",
  contractor: "typeContractor",
  subcontractor: "typeSubcontractor",
};

export function useEmployeeColumns({
  unitNames,
  siteNames,
}: {
  unitNames: Record<string, string>;
  siteNames: Record<string, string>;
}): Column<EmployeeRow>[] {
  const t = useTranslations("workforce");
  const tc = useTranslations("common");
  const format = useFormatter();
  const today = new Date().toISOString().slice(0, 10);

  const meta = (m: ColumnMeta) => m;

  return [
    {
      id: "name",
      header: t("name"),
      meta: meta({ sortKey: "name", width: 200 }),
      cell: ({ row }) => {
        const e = row.original as EmployeeRow;
        return (
          <span className="flex items-center gap-2">
            <Avatar name={e.displayName ?? "?"} tone={(e.avatarColor as StatusTone) ?? "neutral"} size="sm" />
            <span className="truncate font-medium text-text">{e.displayName}</span>
          </span>
        );
      },
    },
    {
      // Status leads, directly after the name: "is this person available?" is
      // the question the table exists to answer, and burying it behind a
      // horizontal scroll means it never gets answered at a glance.
      id: "status",
      header: tc("status"),
      meta: meta({ width: 110 }),
      cell: ({ row }) => {
        const status = (row.original as EmployeeRow).status;
        if (!status) return null;
        return <StatusChip tone={STATUS_TONE[status]}>{t(STATUS_KEY[status])}</StatusChip>;
      },
    },
    {
      id: "code",
      header: t("code"),
      meta: meta({ sortKey: "code", width: 88, numeric: true }),
      cell: ({ row }) => <span className="text-text-3">{(row.original as EmployeeRow).employeeCode}</span>,
    },
    {
      id: "jobTitle",
      header: t("position"),
      meta: meta({ width: 180 }),
      cell: ({ row }) => (row.original as EmployeeRow).jobTitle,
    },
    {
      id: "orgUnit",
      header: t("orgUnit"),
      meta: meta({ sortKey: "unit", width: 170 }),
      cell: ({ row }) => {
        const id = (row.original as EmployeeRow).orgUnitId;
        return <span className="truncate">{id ? (unitNames[id] ?? "—") : "—"}</span>;
      },
    },
    {
      id: "site",
      header: t("site"),
      meta: meta({ width: 150, defaultHidden: true }),
      cell: ({ row }) => {
        const id = (row.original as EmployeeRow).siteId;
        return <span className="truncate text-text-3">{id ? (siteNames[id] ?? "—") : "—"}</span>;
      },
    },
    {
      id: "employmentType",
      header: t("employmentType"),
      meta: meta({ width: 115 }),
      cell: ({ row }) => {
        const type = (row.original as EmployeeRow).employmentType;
        if (!type) return null;
        // Subcontracted workers are visually distinct: they are not our
        // employees, and treating them as such is a legal problem, not a
        // display preference.
        return (
          <span className={type === "employee" ? "text-text-2" : "text-warn"}>
            {t(TYPE_KEY[type])}
          </span>
        );
      },
    },
    {
      id: "compliance",
      header: t("qualifications"),
      meta: meta({ width: 90 }),
      cell: ({ row }) => {
        const quals = (row.original as EmployeeRow).qualifications ?? [];
        const expired = quals.filter((q) => q.expiresAt !== null && q.expiresAt < today);
        if (expired.length === 0) {
          return <span className="tnum text-text-3">{quals.length}</span>;
        }
        return (
          <Tooltip content={expired.map((q) => q.name).join(", ")}>
            <span className="inline-flex items-center gap-1 text-danger">
              <ShieldAlert className="size-3.5" aria-hidden />
              <span className="tnum">{expired.length}</span>
              <span className="sr-only">{t("expired")}</span>
            </span>
          </Tooltip>
        );
      },
    },
    {
      id: "hiredAt",
      header: t("hiredAt"),
      meta: meta({ sortKey: "hired", width: 96, numeric: true, align: "right", defaultHidden: true }),
      cell: ({ row }) => {
        const value = (row.original as EmployeeRow).hiredAt;
        return value ? (
          <span className="text-text-3">{format.dateTime(new Date(value), { dateStyle: "short" })}</span>
        ) : null;
      },
    },
  ];
}
