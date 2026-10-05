/**
 * Anonymous analytics (only when enabled in Settings) and download counting. `telemetryId` is a separate UUID, kept
 * distinct from `aiInstallId` (the server hashes the two with different secrets, so they cannot be linked).
 */
import { UUID_V4_PATTERN, SEMVER_PATTERN } from './ai.ts';

export const TELEMETRY_PLATFORMS = ['macos', 'windows'] as const;
export type TelemetryPlatform = (typeof TELEMETRY_PLATFORMS)[number];
export const TELEMETRY_ARCHS = ['x86_64', 'aarch64'] as const;
export type TelemetryArch = (typeof TELEMETRY_ARCHS)[number];

export const TELEMETRY_PING_PATH = '/v1/telemetry/ping';

/** Everything one ping carries (≤ 1 per day per machine). No IP, machine name, repo path or any other content. */
export interface TelemetryPing {
  telemetryId: string;
  platform: TelemetryPlatform;
  arch: TelemetryArch;
  appVersion: string;
}

export function parseTelemetryPing(body: unknown): TelemetryPing | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { telemetryId, platform, arch, appVersion } = body as Record<string, unknown>;
  if (typeof telemetryId !== 'string' || !UUID_V4_PATTERN.test(telemetryId)) return null;
  if (typeof platform !== 'string' || !(TELEMETRY_PLATFORMS as readonly string[]).includes(platform))
    return null;
  if (typeof arch !== 'string' || !(TELEMETRY_ARCHS as readonly string[]).includes(arch)) return null;
  if (typeof appVersion !== 'string' || !SEMVER_PATTERN.test(appVersion)) return null;
  return {
    telemetryId,
    platform: platform as TelemetryPlatform,
    arch: arch as TelemetryArch,
    appVersion,
  };
}

/** `/download/:asset` — the server records a hit (no IP) then redirects to the file on GitHub Releases. */
export const DOWNLOAD_ASSETS = ['mac', 'win'] as const;
export type DownloadAsset = (typeof DOWNLOAD_ASSETS)[number];
