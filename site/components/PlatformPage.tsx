import Link from 'next/link';
import { CopyCode } from './CopyCode';
import { DownloadCta } from './DownloadCta';
import { AppleIcon, WindowsIcon } from './Icons';
import { Breadcrumbs, JsonLd } from './Seo';
import { Shot } from './Shot';
import type { FaqItem } from '@/lib/content';
import { GUIDES } from '@/lib/guides';
import type { ShotName } from '@/lib/shots';
import { SITE } from '@/lib/site';

export interface PlatformFeature {
  title: string;
  text: string;
  /** Ảnh hiện có đều chụp bản macOS — trang Windows không gắn ảnh. */
  shot?: ShotName;
}

export interface PlatformContent {
  os: 'mac' | 'win';
  path: string;
  crumb: string;
  h1: string;
  lead: string;
  requirements: string;
  operatingSystem: string;
  downloadUrl: string;
  features: PlatformFeature[];
  install: string[];
  installCode?: string;
  faq: FaqItem[];
}

/** Trang riêng cho từng hệ điều hành: yêu cầu, cách cài, tính năng, hỏi đáp. */
export function PlatformPage({ content }: { content: PlatformContent }) {
  const Icon = content.os === 'mac' ? AppleIcon : WindowsIcon;
  return (
    <article className="prose wide container">
      <Breadcrumbs items={[{ name: content.crumb, path: content.path }]} />
      <p className="os-chip">
        <Icon size={18} /> {content.requirements}
      </p>
      <h1>{content.h1}</h1>
      <p className="lead">{content.lead}</p>
      <p>
        <a className="btn btn-primary" href={content.downloadUrl}>
          <Icon /> Tải miễn phí
        </a>
      </p>

      <h2>Cài đặt</h2>
      <ol className="guide-steps">
        {content.install.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {content.installCode && <CopyCode code={content.installCode} />}

      <h2>Tính năng chính</h2>
      {content.features.map((feature) => (
        <section key={feature.title} className="platform-feature">
          <h3>{feature.title}</h3>
          <p>{feature.text}</p>
          {feature.shot && (
            <figure className="guide-shot">
              <Shot name={feature.shot} sizes="(max-width: 1000px) 100vw, 960px" />
            </figure>
          )}
        </section>
      ))}

      <h2>Câu hỏi thường gặp</h2>
      {content.faq.map((item) => (
        <div key={item.q} className="guide-faq">
          <h3>{item.q}</h3>
          {item.a.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      ))}

      <h2>Học Git nhanh hơn</h2>
      <ul className="guide-grid">
        {GUIDES.map((guide) => (
          <li key={guide.slug}>
            <Link className="guide-card" href={`/huong-dan/${guide.slug}/`}>
              <strong>{guide.short}</strong>
              <small>{guide.minutes} phút đọc</small>
            </Link>
          </li>
        ))}
      </ul>

      <DownloadCta />

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: SITE.name,
          description: content.lead,
          url: `${SITE.url}${content.path}`,
          applicationCategory: 'DeveloperApplication',
          operatingSystem: content.operatingSystem,
          downloadUrl: content.downloadUrl,
          screenshot: `${SITE.url}/screenshots/overview-1600.webp`,
          inLanguage: 'vi',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'VND' },
          author: { '@type': 'Person', name: SITE.author },
        }}
      />
    </article>
  );
}
