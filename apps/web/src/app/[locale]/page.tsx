import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/messages";
import Dashboard from "@/components/dashboard";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <Dashboard locale={locale} />;
}
