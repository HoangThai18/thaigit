import { SHOTS, type ShotName } from '@/lib/shots';

/** Ảnh giao diện: WebP 800/1600 px theo bề rộng màn hình, có sẵn kích thước để trang không nhảy khi tải. */
export function Shot({
  name,
  priority = false,
  sizes = '(max-width: 980px) 100vw, 680px',
}: {
  name: ShotName;
  priority?: boolean;
  sizes?: string;
}) {
  const shot = SHOTS[name];
  return (
    <img
      src={`/screenshots/${name}-1600.webp`}
      srcSet={`/screenshots/${name}-800.webp 800w, /screenshots/${name}-1600.webp 1600w`}
      sizes={sizes}
      width={shot.width}
      height={shot.height}
      alt={shot.alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
    />
  );
}
