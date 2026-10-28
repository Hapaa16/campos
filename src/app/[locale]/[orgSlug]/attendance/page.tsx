import { setRequestLocale } from "next-intl/server";
import { requireAbility } from "@/lib/authz/guard";
import { getAttendanceBoard } from "@/server/services/attendance";
import { AttendanceView } from "@/features/attendance/attendance-view";
import type { AttendanceStatus } from "@/server/db/schema";

export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, orgSlug } = await params;
  setRequestLocale(locale);

  const ctx = await requireAbility("read", "Attendance");
  const sp = await searchParams;

  const data = getAttendanceBoard(ctx, {
    date: typeof sp.date === "string" && sp.date ? sp.date : undefined,
    siteId: typeof sp.site === "string" && sp.site ? sp.site : undefined,
    search: typeof sp.q === "string" ? sp.q : undefined,
    status:
      typeof sp.status === "string" && sp.status ? [sp.status as AttendanceStatus] : undefined,
    exceptionsOnly: sp.exceptions === "true",
  });

  return <AttendanceView data={data} orgSlug={orgSlug} />;
}
