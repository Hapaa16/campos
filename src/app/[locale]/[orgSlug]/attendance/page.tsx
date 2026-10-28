import { setRequestLocale } from "next-intl/server";
import { UserCheck } from "lucide-react";
import { requireAbility } from "@/lib/authz/guard";
import { ModuleStub } from "@/components/app/module-stub";

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Gated exactly as the real module will be, so the permission wiring is
  // already correct when the screens arrive.
  await requireAbility("read", "Attendance");

  return (
    <ModuleStub
      titleKey="nav.attendance"
      icon={UserCheck}
      phase={6}
      capabilities={
        locale === "en"
          ? [
        "Planned vs actual attendance",
        "Late arrivals and absences",
        "Supervisor corrections and reconciliation",
        "Biometric / access-control integration",
            ]
          : [
        "Төлөвлөсөн ба бодит ирцийн харьцуулалт",
        "Хоцролт, тасалсан бүртгэл",
        "Ахлахын засвар, тулгалт",
        "Биометр / нэвтрэлтийн системтэй холболт",
            ]
      }
    />
  );
}
