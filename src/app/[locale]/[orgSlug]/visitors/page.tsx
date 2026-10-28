import { setRequestLocale } from "next-intl/server";
import { Building2 } from "lucide-react";
import { requireAbility } from "@/lib/authz/guard";
import { ModuleStub } from "@/components/app/module-stub";

export default async function VisitorsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Gated exactly as the real module will be, so the permission wiring is
  // already correct when the screens arrive.
  await requireAbility("read", "Visit");

  return (
    <ModuleStub
      titleKey="nav.visitors"
      icon={Building2}
      phase={5}
      capabilities={
        locale === "en"
          ? [
        "Invitations and approval workflow",
        "QR registration and gate validation",
        "Check-in/out records and badges",
        "Access scopes and safety induction",
        "Overdue visitor alerts",
            ]
          : [
        "Зочны урилга, батламжийн урсгал",
        "QR-аар бүртгэл, хаалганы шалгалт",
        "Ирэлт/явалтын бүртгэл, энгэрийн тэмдэг",
        "Нэвтрэх эрхийн хүрээ, аюулгүй байдлын сургалт",
        "Хугацаа хэтэрсэн зочны сэрэмжлүүлэг",
            ]
      }
    />
  );
}
