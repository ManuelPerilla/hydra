import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/messages";
import LessonShell from "@/components/learning/lesson-shell";
import PodLesson from "@/components/learning/pod-lesson";

export default async function LearnPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <LessonShell locale={locale}><PodLesson locale={locale} /></LessonShell>;
}
