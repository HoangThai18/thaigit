'use client';

import { useEffect, useState } from 'react';
import { fetchMacRelease, formatDate, formatSize, type MacRelease } from '@/lib/release';
import { LINKS } from '@/lib/site';
import { UI } from '@/lib/ui';
import { AppleIcon } from './Icons';
import { useLang } from './LangProvider';

let pending: Promise<MacRelease | null> | null = null;

function useMacRelease(initial: MacRelease | null): MacRelease | null {
  const [release, setRelease] = useState(initial);
  useEffect(() => {
    let alive = true;
    pending ??= fetchMacRelease({ cache: 'no-store' });
    void pending.then((latest) => {
      if (alive && latest) setRelease(latest);
    });
    return () => {
      alive = false;
    };
  }, []);
  return release;
}

export function DownloadButton({
  initial,
  className = 'btn btn-primary',
}: {
  initial: MacRelease | null;
  className?: string;
}) {
  const lang = useLang();
  const text = UI[lang].download;
  const release = useMacRelease(initial);
  return (
    <a className={className} href={LINKS.downloadMac} data-download="mac">
      <AppleIcon />
      <span className="btn-stack">
        {text.mac}
        <span className="sub">
          {release ? text.version(release.version, formatSize(release.size, lang)) : text.macFallback}
        </span>
      </span>
    </a>
  );
}

export function ReleaseDetails({ initial }: { initial: MacRelease | null }) {
  const lang = useLang();
  const text = UI[lang].download;
  const release = useMacRelease(initial);
  if (!release) {
    return <p className="note">{text.noRelease}</p>;
  }
  return (
    <p className="note">
      {text.released} {formatDate(release.publishedAt, lang)}
      {release.sha256 && (
        <>
          <br />
          SHA-256: <code>{release.sha256}</code>
        </>
      )}
    </p>
  );
}
