import { CopyCode } from '@/components/CopyCode';
import { DownloadCta } from '@/components/DownloadCta';
import { accentStyle, GuideCard } from '@/components/GuideCard';
import { Breadcrumbs, JsonLd } from '@/components/Seo';
import { Shot } from '@/components/Shot';
import { formatDate } from '@/lib/changelog';
import { guideText, relatedGuides, type Guide } from '@/lib/guides';
import { guidePath, PATHS, type Lang } from '@/lib/i18n';
import { SHOTS } from '@/lib/shots';
import { SITE } from '@/lib/site';
import { UI } from '@/lib/ui';

export function GuidePage({ lang, guide }: { lang: Lang; guide: Guide }) {
  const text = guideText(lang, guide.id);
  const ui = UI[lang];
  const url = `${SITE.url}${guidePath(lang, guide.id)}`;
  const firstShot = text.sections.find((section) => section.shot)?.shot ?? guide.cover;

  return (
    <article className="guide-page" style={accentStyle(guide)}>
      <header className="guide-hero">
        <div className="hero-bg" aria-hidden="true">
          <div className="orb orb-orange" />
          <div className="orb orb-blue" />
          <div className="grid-lines" />
        </div>
        <div className="container guide-hero-inner">
          <div className="guide-hero-text">
            <Breadcrumbs
              lang={lang}
              items={[
                { name: UI[lang].nav.guides, path: PATHS.guides[lang] },
                { name: text.short, path: guidePath(lang, guide.id) },
              ]}
            />
            <span className="gtag">{guide.tag[lang]}</span>
            <h1>{text.title}</h1>
            <p className="guide-meta">
              {ui.updated} <time dateTime={guide.updated}>{formatDate(guide.updated, lang)}</time> ·{' '}
              {ui.minutes(guide.minutes)}
            </p>
          </div>
          <figure className="guide-cover">
            <Shot name={guide.cover} lang={lang} priority sizes="(max-width: 900px) 100vw, 540px" />
          </figure>
        </div>
      </header>

      <div className="container guide-layout">
        <aside className="guide-toc" aria-label={ui.onThisPage}>
          <strong>{ui.onThisPage}</strong>
          <ol>
            {text.sections.map((section, index) => (
              <li key={section.heading}>
                <a href={`#muc-${index + 1}`}>{section.heading}</a>
              </li>
            ))}
            {text.faq.length > 0 && (
              <li>
                <a href="#faq">{ui.faqTitle}</a>
              </li>
            )}
          </ol>
        </aside>

        <div className="guide-content">
          {text.intro.map((paragraph) => (
            <p key={paragraph} className="guide-intro">
              {paragraph}
            </p>
          ))}

          {text.sections.map((section, index) => (
            <section key={section.heading} id={`muc-${index + 1}`} className="guide-section">
              <h2>
                <span className="num">{String(index + 1).padStart(2, '0')}</span>
                {section.heading}
              </h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.steps && (
                <ol className="guide-steps">
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {section.sample && <pre className="code-sample">{section.sample.join('\n')}</pre>}
              {section.code && <CopyCode code={section.code.join('\n')} />}
              {section.note && (
                <aside className={`callout ${section.note.kind}`}>
                  <strong>{ui.noteLabel[section.note.kind]}</strong>
                  <p>{section.note.text}</p>
                </aside>
              )}
              {section.shot && (
                <figure className="guide-shot">
                  <Shot name={section.shot} lang={lang} sizes="(max-width: 800px) 100vw, 760px" />
                  <figcaption>{SHOTS[section.shot].alt[lang]}</figcaption>
                </figure>
              )}
            </section>
          ))}

          {text.faq.length > 0 && (
            <section id="faq" className="guide-section">
              <h2>
                <span className="num">?</span>
                {ui.faqTitle}
              </h2>
              {text.faq.map((item, index) => (
                <details key={item.q} className="qa" open={index === 0}>
                  <summary>{item.q}</summary>
                  <div>
                    {item.a.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </details>
              ))}
            </section>
          )}

          <DownloadCta lang={lang} />

          <nav className="related" aria-label={ui.relatedGuides}>
            <h2>{ui.relatedGuides}</h2>
            <ul className="gcards">
              {relatedGuides(guide).map((item) => (
                <li key={item.id}>
                  <GuideCard guide={item} lang={lang} compact />
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>

      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            headline: text.title,
            description: text.description,
            inLanguage: lang,
            url,
            mainEntityOfPage: url,
            dateModified: guide.updated,
            datePublished: guide.updated,
            image: `${SITE.url}/screenshots/${firstShot}-1600.webp`,
            author: { '@type': 'Person', name: SITE.author },
            publisher: { '@type': 'Organization', name: SITE.name, logo: `${SITE.url}/logo-256.png` },
          },
          ...(text.faq.length > 0
            ? [
                {
                  '@context': 'https://schema.org',
                  '@type': 'FAQPage',
                  mainEntity: text.faq.map((item) => ({
                    '@type': 'Question',
                    name: item.q,
                    acceptedAnswer: { '@type': 'Answer', text: item.a.join(' ') },
                  })),
                },
              ]
            : []),
        ]}
      />
    </article>
  );
}
