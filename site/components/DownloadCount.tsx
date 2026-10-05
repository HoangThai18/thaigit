'use client';

import { useEffect, useState } from 'react';
import { UI } from '@/lib/ui';
import { useLang } from './LangProvider';

let pending: Promise<number | null> | null = null;

async function fetchTotal(): Promise<number | null> {
  try {
    const response = await fetch('/v1/stats/downloads');
    if (!response.ok) return null;
    const body = (await response.json()) as { total?: unknown };
    return typeof body.total === 'number' && Number.isFinite(body.total) ? body.total : null;
  } catch {
    return null;
  }
}

export function DownloadCount() {
  const lang = useLang();
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    pending ??= fetchTotal();
    void pending.then((value) => {
      if (alive) setTotal(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (total === null) return null;
  const formatted = total.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US');
  return <span className="dl-count">{UI[lang].download.count(formatted)}</span>;
}
