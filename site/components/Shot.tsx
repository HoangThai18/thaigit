import { SHOTS, type ShotName } from '@/lib/shots';
import type { Lang } from '@/lib/i18n';

export function Shot({
  name,
  lang,
  priority = false,
  sizes = '(max-width: 980px) 100vw, 680px',
  alt,
  className,
  style,
}: {
  name: ShotName;
  lang: Lang;
  priority?: boolean;
  sizes?: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const shot = SHOTS[name];
  return (
    <img
      src={`/screenshots/${name}-1600.webp`}
      srcSet={`/screenshots/${name}-800.webp 800w, /screenshots/${name}-1600.webp 1600w`}
      sizes={sizes}
      width={shot.width}
      height={shot.height}
      alt={alt ?? shot.alt[lang]}
      className={className}
      style={style}
      draggable={false}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
    />
  );
}

export function ThemedShot({
  light,
  dark,
  lang,
  priority = false,
  sizes,
  alt,
}: {
  light: ShotName;
  dark: ShotName;
  lang: Lang;
  priority?: boolean;
  sizes?: string;
  alt?: string;
}) {
  return (
    <>
      <Shot name={light} lang={lang} className="only-light" priority={false} sizes={sizes} alt={alt} />
      <Shot name={dark} lang={lang} className="only-dark" priority={priority} sizes={sizes} alt={alt} />
    </>
  );
}
