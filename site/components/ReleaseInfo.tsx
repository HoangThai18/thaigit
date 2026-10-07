'use client';

import { useEffect, useState } from 'react';
import { fetchRelease, formatDate, formatSize, type Release, type ReleaseOs } from '@/lib/release';
import { LINKS } from '@/lib/site';
import { UI } from '@/lib/ui';
import { AppleIcon, WindowsIcon } from './Icons';
import { useLang } from './LangProvider';

let pending: Promise<Release | null> | null = null;

function useRelease(initial: Release | null): Release | null {
  const [release, setRelease] = useState(initial);
  useEffect(() => {
    let alive = true;
    pending ??= fetchRelease({ cache: 'no-store' });
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
  os,
  initial,
  className = 'btn btn-primary',
  title,
}: {
  os: ReleaseOs;
  initial: Release | null;
  className?: string;
  title?: string;
}) {
  const lang = useLang();
  const text = UI[lang].download;
  const release = useRelease(initial);
  const asset = release?.[os];
  const Icon = os === 'mac' ? AppleIcon : WindowsIcon;
  const fallback = os === 'mac' ? text.macFallback : text.winSub;
  return (
    <a
      className={className}
      href={os === 'mac' ? LINKS.downloadMac : LINKS.downloadWindows}
      data-download={os}
      title={title}
    >
      <Icon />
      <span className="btn-stack">
        {os === 'mac' ? text.mac : text.win}
        <span className="sub">
          {release?.version && asset ? text.version(release.version, formatSize(asset.size, lang)) : fallback}
        </span>
      </span>
    </a>
  );
}

export function ReleaseDetails({ os, initial }: { os: ReleaseOs; initial: Release | null }) {
  const lang = useLang();
  const text = UI[lang].download;
  const release = useRelease(initial);
  const asset = release?.[os];
  if (!release || !asset) {
    return <p className="note">{text.noRelease}</p>;
  }
  return (
    <p className="note">
      {text.released} {formatDate(asset.updatedAt, lang)}
      {asset.sha256 && (
        <>
          <br />
          SHA-256: <code>{asset.sha256}</code>
        </>
      )}
    </p>
  );
}
