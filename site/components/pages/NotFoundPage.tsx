import Link from 'next/link';
import { PATHS, type Lang } from '@/lib/i18n';
import { UI } from '@/lib/ui';

export function NotFoundPage({ lang }: { lang: Lang }) {
  const text = UI[lang].notFound;
  return (
    <section className="prose container not-found">
      <h1>{text.title}</h1>
      <p>{text.text}</p>
      <p>
        <Link className="btn btn-primary" href={PATHS.home[lang]}>
          {text.home}
        </Link>
      </p>
    </section>
  );
}
