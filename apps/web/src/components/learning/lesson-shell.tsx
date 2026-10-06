import { languageNames, locales, type Locale } from "@/i18n/messages";
import { learningMessages } from "@/i18n/learning";

export default function LessonShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = learningMessages[locale];
  return <>
    <header className="site-header learning-header"><div className="header-inner">
      <a className="brand" href={`/${locale}/learn`} aria-label="Hydra"><img className="brand-mark" src="/hydra-mark.svg" alt="" /><span>hydra<span className="brand-period">.</span></span></a>
      <nav className="learning-nav" aria-label="Hydra"><a href={`/${locale}/learn`} aria-current="page">{t.learnLabel}</a><a href={`/${locale}`}>{t.consoleLabel}</a></nav>
      <nav className="learning-languages" aria-label={t.languageLabel}>{locales.map((value) => <a key={value} href={`/${value}/learn`} lang={value} aria-current={value === locale ? "page" : undefined}>{languageNames[value]}</a>)}</nav>
    </div></header>
    <main id="main" className="learning-shell">{children}</main>
  </>;
}
