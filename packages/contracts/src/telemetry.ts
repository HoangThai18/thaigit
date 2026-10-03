/**
 * Thống kê ẩn danh (chỉ khi người dùng bật trong Cài đặt) và đếm lượt tải. `telemetryId` là UUID riêng, tách hẳn khỏi
 * `aiInstallId` (máy chủ băm hai ID bằng hai secret khác nhau nên không nối được).
 */
import { UUID_V4_PATTERN, SEMVER_PATTERN } from './ai.ts';

export const TELEMETRY_PLATFORMS = ['macos', 'windows'] as const;
export type TelemetryPlatform = (typeof TELEMETRY_PLATFORMS)[number];
export const TELEMETRY_ARCHS = ['x86_64', 'aarch64'] as const;
export type TelemetryArch = (typeof TELEMETRY_ARCHS)[number];

export const TELEMETRY_PING_PATH = '/v1/telemetry/ping';

/** Toàn bộ dữ liệu một lần ping (≤ 1 lần/ngày/máy). Không có IP, tên máy, đường dẫn repo hay nội dung gì khác. */
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

/** `/download/:asset` — máy chủ ghi một lượt (không IP) rồi chuyển hướng tới file trên GitHub Releases. */
export const DOWNLOAD_ASSETS = ['mac', 'win'] as const;
export type DownloadAsset = (typeof DOWNLOAD_ASSETS)[number];
