import { LINKS } from './site';

/** Bản phát hành macOS mới nhất trên GitHub (null khi chưa có bản nào hoặc không hỏi được). */
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

/** Gọi lúc build (HTML dựng sẵn có số phiên bản) và trong trình duyệt (luôn mới). */
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

export function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
