import { setRequestLocale } from "next-intl/server";
import { Plug } from "lucide-react";
import { requireAbility } from "@/lib/authz/guard";
import { ModuleStub } from "@/components/app/module-stub";

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Gated exactly as the real module will be, so the permission wiring is
  // already correct when the screens arrive.
  await requireAbility("manage", "Setting");

  return (
    <ModuleStub
      titleKey="nav.integrations"
      icon={Plug}
      phase={6}
      capabilities={
        locale === "en"
          ? [
        "HR and ERP systems",
        "Access-control hardware",
        "External transport providers",
        "Import/export templates and failure handling",
            ]
          : [
        "ХН болон ERP системийн холболт",
        "Нэвтрэлтийн хяналтын тоног төхөөрөмж",
        "Гадаад тээврийн үйлчилгээ үзүүлэгч",
        "Импорт/экспорт загвар, алдааны хяналт",
            ]
      }
    />
  );
}
