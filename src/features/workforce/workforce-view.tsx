"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { parseAsArrayOf, parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { EyeOff, Users } from "lucide-react";
import {
  DataTable,
  defaultColumnVisibility,
  type SortState,
} from "@/components/data/data-table";
import { ColumnMenu } from "@/components/data/column-menu";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { FilterBar } from "./filter-bar";
import { useEmployeeColumns, type EmployeeRow } from "./columns";

export interface WorkforceViewProps {
  rows: EmployeeRow[];
  total: number;
  offset: number;
  limit: number;
  withheld: string[];
  facets: {
    status: Record<string, number>;
    employmentType: Record<string, number>;
  };
  unitNames: Record<string, string>;
  siteNames: Record<string, string>;
  sites: { id: string; name: string }[];
  orgSlug: string;
}

const STATUS_VALUES = ["active", "on_leave", "suspended", "terminated"] as const;
const TYPE_VALUES = ["employee", "contractor", "subcontractor"] as const;

export function WorkforceView(props: WorkforceViewProps) {
  const t = useTranslations("workforce");
  const tc = useTranslations("common");
  const router = useRouter();

  const [params, setParams] = useQueryStates(
    {
      q: parseAsString.withDefault(""),
      status: parseAsArrayOf(parseAsString).withDefault([]),
      type: parseAsArrayOf(parseAsString).withDefault([]),
      site: parseAsArrayOf(parseAsString).withDefault([]),
      sort: parseAsString.withDefault("name"),
      offset: parseAsInteger.withDefault(0),
    },
    // shallow:false re-runs the server component, so filtering and sorting act
    // on the whole result set rather than on the page already in the browser.
    { shallow: false, history: "replace" },
  );

  const columns = useEmployeeColumns({
    unitNames: props.unitNames,
    siteNames: props.siteNames,
  });

  // Column choices are a workstation preference, not a shared view, so they
  // stay in local state rather than the URL — a shared filter link should not
  // also reshape the recipient's table.
  const [columnVisibility, setColumnVisibility] = React.useState(() =>
    defaultColumnVisibility(columns),
  );

  const sort: SortState = params.sort.startsWith("-")
    ? { key: params.sort.slice(1), dir: "desc" }
    : { key: params.sort, dir: "asc" };

  const onSortChange = (key: string) => {
    const next = sort.key === key && sort.dir === "asc" ? `-${key}` : key;
    void setParams({ sort: next, offset: 0 });
  };

  const hasFilters =
    params.q !== "" || params.status.length > 0 || params.type.length > 0 || params.site.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar
        search={params.q}
        onSearchChange={(q) => void setParams({ q, offset: 0 })}
        hasFilters={hasFilters}
        onClear={() => void setParams({ q: "", status: [], type: [], site: [], offset: 0 })}
        facets={[
          {
            key: "status",
            label: tc("status"),
            selected: params.status,
            onChange: (status) => void setParams({ status, offset: 0 }),
            options: STATUS_VALUES.map((value) => ({
              value,
              label: t(
                value === "active"
                  ? "statusActive"
                  : value === "on_leave"
                    ? "statusOnLeave"
                    : value === "suspended"
                      ? "statusSuspended"
                      : "statusTerminated",
              ),
              count: props.facets.status[value],
            })),
          },
          {
            key: "type",
            label: t("employmentType"),
            selected: params.type,
            onChange: (type) => void setParams({ type, offset: 0 }),
            options: TYPE_VALUES.map((value) => ({
              value,
              label: t(
                value === "employee"
                  ? "typeEmployee"
                  : value === "contractor"
                    ? "typeContractor"
                    : "typeSubcontractor",
              ),
              count: props.facets.employmentType[value],
            })),
          },
          {
            key: "site",
            label: t("site"),
            selected: params.site,
            onChange: (site) => void setParams({ site, offset: 0 }),
            options: props.sites.map((s) => ({ value: s.id, label: s.name })),
          },
        ]}
        trailing={
          <>
            {props.withheld.length > 0 && (
              // Say what is hidden. Silently omitting columns makes the data
              // look incomplete rather than restricted.
              <Tooltip content={t("personalDataHidden")}>
                <span className="flex items-center gap-1 text-2xs text-text-3">
                  <EyeOff className="size-3" aria-hidden />
                  {props.withheld.length} {tc("hidden").toLowerCase()}
                </span>
              </Tooltip>
            )}
            <ColumnMenu
              visibility={columnVisibility}
              onChange={setColumnVisibility}
              columns={[
                { id: "name", label: t("name"), locked: true },
                { id: "status", label: tc("status") },
                { id: "code", label: t("code") },
                { id: "jobTitle", label: t("position") },
                { id: "orgUnit", label: t("orgUnit") },
                { id: "site", label: t("site") },
                { id: "employmentType", label: t("employmentType") },
                { id: "compliance", label: t("qualifications") },
                { id: "hiredAt", label: t("hiredAt") },
              ]}
            />
          </>
        }
      />

      <DataTable
        className="min-h-0 flex-1"
        data={props.rows}
        columns={columns}
        sort={sort}
        onSortChange={onSortChange}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        onRowClick={(row) => router.push(`/${props.orgSlug}/workforce/${row.id}`)}
        empty={
          <EmptyState
            icon={Users}
            title={t("empty")}
            description={t("emptyHint")}
          />
        }
      />

      <Pagination
        total={props.total}
        offset={props.offset}
        limit={props.limit}
        onChange={(offset) => void setParams({ offset })}
      />
    </div>
  );
}
