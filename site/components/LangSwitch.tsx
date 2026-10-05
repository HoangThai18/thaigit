'use client';

import { usePathname } from 'next/navigation';
import { useLang } from './LangProvider';
import { counterpart } from '@/lib/i18n';
import { UI } from '@/lib/ui';

export function LangSwitch() {
  const lang = useLang();
  const pathname = usePathname() || '/';
  const other = lang === 'vi' ? 'en' : 'vi';
  const text = UI[lang].langSwitch;
  return (
    <a
      className="lang-switch"
      href={counterpart(pathname, other)}
      hrefLang={other}
      lang={other}
      aria-label={`${text.aria}: ${text.title}`}
      title={text.title}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9s1.3-6.4 3.9-9z" />
      </svg>
      {other.toUpperCase()}
    </a>
  );
}
