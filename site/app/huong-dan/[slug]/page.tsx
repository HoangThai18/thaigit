import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CopyCode } from '@/components/CopyCode';
import { DownloadCta } from '@/components/DownloadCta';
import { Breadcrumbs, JsonLd } from '@/components/Seo';
import { Shot } from '@/components/Shot';
import { formatDate } from '@/lib/changelog';
import { findGuide, GUIDES } from '@/lib/guides';
import { pageMetadata } from '@/lib/seo';
import { SITE } from '@/lib/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = findGuide((await params).slug);
  if (!guide) return {};
  return pageMetadata({
    title: guide.title,
    description: guide.description,
    path: `/huong-dan/${guide.slug}/`,
    type: 'article',
    modifiedTime: guide.updated,
  });
}

export default async function GuidePage({ params }: Props) {
  const guide = findGuide((await params).slug);
  if (!guide) notFound();
  const url = `${SITE.url}/huong-dan/${guide.slug}/`;
  const others = GUIDES.filter((item) => item.slug !== guide.slug);
  const firstShot = guide.sections.find((section) => section.shot)?.shot;

  return (
    <article className="prose container">
      <Breadcrumbs
        items={[
          { name: 'Hướng dẫn', path: '/huong-dan/' },
          { name: guide.short, path: `/huong-dan/${guide.slug}/` },
        ]}
      />
      <h1>{guide.title}</h1>
      <p className="updated">
        Cập nhật <time dateTime={guide.updated}>{formatDate(guide.updated)}</time> · {guide.minutes} phút đọc
      </p>
      {guide.intro.map((paragraph) => (
        <p key={paragraph} className="lead">
          {paragraph}
        </p>
      ))}

      {guide.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
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
          {section.shot && (
            <figure className="guide-shot">
              <Shot name={section.shot} sizes="(max-width: 800px) 100vw, 760px" />
            </figure>
          )}
        </section>
      ))}

      {guide.faq.length > 0 && (
        <section>
          <h2>Câu hỏi thường gặp</h2>
          {guide.faq.map((item) => (
            <div key={item.q} className="guide-faq">
              <h3>{item.q}</h3>
              {item.a.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          ))}
        </section>
      )}

      <DownloadCta />

      <nav className="related" aria-label="Bài hướng dẫn khác">
        <h2>Bài khác</h2>
        <ul className="guide-grid">
          {others.map((item) => (
            <li key={item.slug}>
              <Link className="guide-card" href={`/huong-dan/${item.slug}/`}>
                <strong>{item.short}</strong>
                <small>{item.minutes} phút đọc</small>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            headline: guide.title,
            description: guide.description,
            inLanguage: 'vi',
            url,
            mainEntityOfPage: url,
            dateModified: guide.updated,
            datePublished: guide.updated,
            ...(firstShot ? { image: `${SITE.url}/screenshots/${firstShot}-1600.webp` } : {}),
            author: { '@type': 'Person', name: SITE.author },
            publisher: { '@type': 'Organization', name: SITE.name, logo: `${SITE.url}/logo-256.png` },
          },
          ...(guide.faq.length > 0
            ? [
                {
                  '@context': 'https://schema.org',
                  '@type': 'FAQPage',
                  mainEntity: guide.faq.map((item) => ({
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
