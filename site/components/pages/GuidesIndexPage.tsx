import { DownloadCta } from '@/components/DownloadCta';
import { GuideCard } from '@/components/GuideCard';
import { Breadcrumbs, JsonLd } from '@/components/Seo';
import { GUIDES, guideText } from '@/lib/guides';
import { guidePath, PATHS, type Lang } from '@/lib/i18n';
import { PAGE_TEXT } from '@/lib/page-text';
import { SITE } from '@/lib/site';

export function GuidesIndexPage({ lang }: { lang: Lang }) {
  const text = PAGE_TEXT[lang].guides;
  const [featured, ...rest] = GUIDES;
  return (
    <>
      <section className="guides-hero">
        <div className="hero-bg" aria-hidden="true">
          <div className="orb orb-orange" />
          <div className="orb orb-blue" />
          <div className="grid-lines" />
        </div>
        <div className="container guides-hero-inner">
          <Breadcrumbs lang={lang} items={[{ name: text.kicker, path: PATHS.guides[lang] }]} />
          <span className="kicker">{text.kicker}</span>
          <h1>{text.h1}</h1>
          <p className="lead">{text.lead}</p>
          <ul className="chip-row">
            {text.chips(GUIDES.length).map((chip) => (
              <li key={chip}>{chip}</li>
            ))}
          </ul>
        </div>
      </section>

      <div className="container guides-body">
        <GuideCard guide={featured} lang={lang} featured />
        <ul className="gcards">
          {rest.map((guide) => (
            <li key={guide.id}>
              <GuideCard guide={guide} lang={lang} />
            </li>
          ))}
        </ul>
        <DownloadCta lang={lang} />
      </div>

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: GUIDES.map((guide, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: `${SITE.url}${guidePath(lang, guide.id)}`,
            name: guideText(lang, guide.id).title,
          })),
        }}
      />
    </>
  );
}
