import type { Lang } from './i18n';
import { LINKS } from './site';

export type ReleaseOs = 'mac' | 'win';

export interface ReleaseAsset {
  size: number;
  sha256: string | null;
  updatedAt: string;
}

export interface Release {
  version: string | null;
  mac: ReleaseAsset | null;
  win: ReleaseAsset | null;
}

interface GitHubAsset {
  name: string;
  size: number;
  updated_at?: string;
  digest?: string | null;
}

interface GitHubRelease {
  name?: string | null;
  tag_name: string;
  assets: GitHubAsset[];
}

const ASSET_NAMES: Record<ReleaseOs, string> = {
  mac: 'Thaigit-macOS.dmg',
  win: 'Thaigit-Windows-setup.exe',
};

const VERSION_PATTERN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/;

function findAsset(assets: GitHubAsset[], os: ReleaseOs): ReleaseAsset | null {
  const asset = assets.find((item) => item.name === ASSET_NAMES[os]);
  if (!asset) return null;
  return {
    size: asset.size,
    sha256: asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null,
    updatedAt: asset.updated_at ?? '',
  };
}

export function parseRelease(json: unknown): Release | null {
  const release = json as Partial<GitHubRelease> | null;
  if (!release?.tag_name || !Array.isArray(release.assets)) return null;
  const mac = findAsset(release.assets, 'mac');
  const win = findAsset(release.assets, 'win');
  if (!mac && !win) return null;
  return {
    version:
      VERSION_PATTERN.exec(release.name ?? '')?.[0] ?? VERSION_PATTERN.exec(release.tag_name)?.[0] ?? null,
    mac,
    win,
  };
}

export async function fetchRelease(init?: RequestInit): Promise<Release | null> {
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
