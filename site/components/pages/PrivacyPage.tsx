import { Breadcrumbs } from '@/components/Seo';
import { PATHS, type Lang } from '@/lib/i18n';
import { PAGE_TEXT } from '@/lib/page-text';
import { SITE } from '@/lib/site';

export function PrivacyPage({ lang }: { lang: Lang }) {
  const text = PAGE_TEXT[lang].privacy;
  return (
    <article className="prose container">
      <Breadcrumbs lang={lang} items={[{ name: text.h1, path: PATHS.privacy[lang] }]} />
      <h1>{text.h1}</h1>
      <p className="updated">{text.updated}</p>
      {text.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          <p>{section.text}</p>
        </section>
      ))}
      <h2>{text.contactHeading}</h2>
      <p>{text.contact(SITE.author)}</p>
    </article>
  );
}
