import type { Lang } from './i18n';
import { LINKS } from './site';

export interface MacRelease {
  version: string;
  publishedAt: string;
  size: number;
  url: string;
  sha256: string | null;
}

interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  assets: GitHubAsset[];
}

export function parseRelease(json: unknown): MacRelease | null {
  const release = json as Partial<GitHubRelease> | null;
  if (!release?.tag_name || !Array.isArray(release.assets)) return null;
  const asset = release.assets.find((item) => item.name === 'Thaigit-macOS.zip');
  if (!asset) return null;
  return {
    version: release.tag_name.replace(/^v/, ''),
    publishedAt: release.published_at ?? '',
    size: asset.size,
    url: asset.browser_download_url,
    sha256: asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null,
  };
}

export async function fetchMacRelease(init?: RequestInit): Promise<MacRelease | null> {
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    const token = typeof process !== 'undefined' ? process.env.GITHUB_TOKEN : undefined;
    if (token && typeof window === 'undefined') headers.Authorization = `Bearer ${token}`;
    const response = await fetch(LINKS.latestReleaseApi, { ...init, headers });
    if (!response.ok) return null;
    return parseRelease(await response.json());
  } catch {
    return null;
  }
}

const LOCALE: Record<Lang, string> = { vi: 'vi-VN', en: 'en-US' };

export function formatSize(bytes: number, lang: Lang = 'vi'): string {
  return `${(bytes / 1024 / 1024).toLocaleString(LOCALE[lang], { maximumFractionDigits: 1 })} MB`;
}

export function formatDate(iso: string, lang: Lang = 'vi'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return lang === 'vi'
    ? date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' })
    : date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}
