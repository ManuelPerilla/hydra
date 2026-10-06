import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, messages } from "@/i18n/messages";
import "../globals.css";

export const metadata: Metadata = {
  title: "Hydra · Chaos Engineering", description: "Controlled Kubernetes failures. Real recovery evidence. Your infrastructure.",
  icons: { icon: "/hydra-mark.svg" }, robots: { index: false, follow: false },
};
export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} data-scroll-behavior="smooth"><body><a className="skip-link" href="#main">{messages[locale].skip}</a>{children}</body></html>;
}
