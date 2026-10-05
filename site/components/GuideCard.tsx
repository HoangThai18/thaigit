import Link from 'next/link';
import { guidePath, type Lang } from '@/lib/i18n';
import { guideText, type Guide } from '@/lib/guides';
import { UI } from '@/lib/ui';
import { Shot } from './Shot';

export function accentStyle(guide: Guide): React.CSSProperties {
  return { '--a1': guide.accent[0], '--a2': guide.accent[1] } as React.CSSProperties;
}

export function GuideCard({
  guide,
  lang,
  featured = false,
  compact = false,
}: {
  guide: Guide;
  lang: Lang;
  featured?: boolean;
  compact?: boolean;
}) {
  const text = guideText(lang, guide.id);
  return (
    <Link
      className={`gcard${featured ? ' featured' : ''}`}
      href={guidePath(lang, guide.id)}
      style={accentStyle(guide)}
    >
      <span className="gcard-cover">
        <Shot
          name={guide.cover}
          lang={lang}
          alt=""
          sizes={featured ? '(max-width: 900px) 100vw, 600px' : '(max-width: 700px) 100vw, 380px'}
        />
      </span>
      <span className="gcard-body">
        <span className="gtag">{guide.tag[lang]}</span>
        <strong>{featured ? text.title : text.short}</strong>
        {!compact && <span className="gdesc">{text.description}</span>}
        <small>{UI[lang].minutes(guide.minutes)}</small>
      </span>
    </Link>
  );
}
