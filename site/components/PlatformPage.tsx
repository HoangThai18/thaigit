import Link from 'next/link';
import { CopyCode } from './CopyCode';
import { DownloadCta } from './DownloadCta';
import { GuideCard } from './GuideCard';
import { AppleIcon, WindowsIcon } from './Icons';
import { Breadcrumbs, JsonLd } from './Seo';
import { Shot } from './Shot';
import { FAQ, FEATURES } from '@/lib/content';
import { GUIDES } from '@/lib/guides';
import { PATHS, type Lang } from '@/lib/i18n';
import { PLATFORM_LABELS, PLATFORM_TEXT } from '@/lib/platform-text';
import { LINKS, SITE } from '@/lib/site';
import { UI } from '@/lib/ui';

const PLATFORM_GUIDES = 6;

export function PlatformPage({ lang, os }: { lang: Lang; os: 'mac' | 'win' }) {
  const content = PLATFORM_TEXT[os][lang];
  const labels = PLATFORM_LABELS[lang];
  const ui = UI[lang];
  const Icon = os === 'mac' ? AppleIcon : WindowsIcon;
  const pageKey = os === 'mac' ? 'mac' : 'windows';
  const path = PATHS[pageKey][lang];
  const downloadUrl = os === 'mac' ? LINKS.downloadMac : LINKS.downloadWindows;
  const crumb = os === 'mac' ? 'macOS' : 'Windows';
  const features =
    content.features === 'home'
      ? FEATURES[lang].map((feature) => ({ title: feature.title, text: feature.text, shot: feature.shot }))
      : content.features;
  const faq = FAQ[lang].filter((item) => content.faqIds.includes(item.id));

  return (
    <article className="prose wide container">
      <Breadcrumbs lang={lang} items={[{ name: crumb, path }]} />
      <p className="os-chip">
        <Icon size={18} /> {content.requirements}
      </p>
      <h1>{content.h1}</h1>
      <p className="lead">{content.lead}</p>
      <p>
        <a className="btn btn-primary" href={downloadUrl}>
          <Icon /> {ui.download.free}
        </a>
      </p>

      <h2>{labels.install}</h2>
      <ol className="guide-steps">
        {content.install.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {content.installCode && <CopyCode code={content.installCode} />}

      <h2>{labels.features}</h2>
      {features.map((feature) => (
        <section key={feature.title} className="platform-feature">
          <h3>{feature.title}</h3>
          <p>{feature.text}</p>
          {feature.shot && (
            <figure className="guide-shot">
              <Shot name={feature.shot} lang={lang} sizes="(max-width: 1000px) 100vw, 960px" />
            </figure>
          )}
        </section>
      ))}

      <h2>{labels.faq}</h2>
      {faq.map((item) => (
        <div key={item.id} className="guide-faq">
          <h3>{item.q}</h3>
          {item.a.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      ))}

      <h2>{labels.learn}</h2>
      <ul className="gcards">
        {GUIDES.slice(0, PLATFORM_GUIDES).map((guide) => (
          <li key={guide.id}>
            <GuideCard guide={guide} lang={lang} compact />
          </li>
        ))}
      </ul>
      <p className="section-more">
        <Link href={PATHS.guides[lang]}>{ui.allGuides(GUIDES.length)}</Link>
      </p>

      <DownloadCta lang={lang} />

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: SITE.name,
          description: content.lead,
          url: `${SITE.url}${path}`,
          applicationCategory: 'DeveloperApplication',
          operatingSystem: content.operatingSystem,
          downloadUrl,
          screenshot: `${SITE.url}/screenshots/overview-1600.webp`,
          inLanguage: lang,
          offers: { '@type': 'Offer', price: '0', priceCurrency: lang === 'vi' ? 'VND' : 'USD' },
          author: { '@type': 'Person', name: SITE.author },
        }}
      />
    </article>
  );
}
