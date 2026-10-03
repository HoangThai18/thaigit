import { SHOTS, type ShotName } from '@/lib/shots';

/** Ảnh giao diện: WebP 800/1600 px theo bề rộng màn hình, có sẵn kích thước để trang không nhảy khi tải. */
export function Shot({
  name,
  priority = false,
  sizes = '(max-width: 980px) 100vw, 680px',
  alt,
  className,
  style,
}: {
  name: ShotName;
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
      alt={alt ?? shot.alt}
      className={className}
      style={style}
      draggable={false}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
    />
  );
}
