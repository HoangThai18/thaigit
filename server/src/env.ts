// Server configuration — read only from environment variables (one source of truth, no web settings form). Secrets may be
// supplied via a file (`<NAME>_FILE`, which fits chmod 600 Docker secrets) so they stay out of compose files and images.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AiFeature } from '@thaigit/contracts';

export interface Config {
  host: string;
  port: number;
  adminHost: string;
  adminPort: number;
  dataDir: string;
  /** IP / CIDR ranges of reverse proxies (nginx, Caddy) trusted to set `X-Real-IP`. */
  trustedProxies: string[];
  corsOrigins: string[];
  hermes: {
    baseUrl: string;
    model: string;
    apiKey: string | null;
    timeoutMs: number;
  };
  secrets: {
    aiId: string;
    aiToken: string;
    telemetryId: string;
  };
  ai: {
    maxConcurrency: number;
    queueMax: number;
    queueTimeoutMs: number;
    globalRpm: number;
    ipRpm: number;
    maxInputTokens: number;
    quota: Record<AiFeature, number>;
    maxTokens: Record<AiFeature, number>;
    killSwitchFile: string;
  };
  telemetry: {
    /** Maximum new telemetryIds per IP per day (stops fake metric inflation). */
    newIdsPerIpPerDay: number;
  };
  download: {
    /** GitHub repo holding the release (redirects only ever target this repo). */
    repo: string;
  };
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

function text(env: Env, name: string, fallback?: string): string {
  const value = env[name]?.trim();
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new ConfigError(`Thiếu biến môi trường ${name}`);
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} phải là số nguyên trong [${min}, ${max}]`);
  }
  return value;
}

function list(env: Env, name: string, fallback: string[]): string[] {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** Secret: `<NAME>_FILE` (read the file) or `<NAME>`; at least 32 characters. */
function secret(env: Env, name: string): string {
  const file = env[`${name}_FILE`]?.trim();
  const value = file ? readFileSync(file, 'utf8').trim() : env[name]?.trim();
  if (value === undefined || value === '') throw new ConfigError(`Thiếu secret ${name} (hoặc ${name}_FILE)`);
  if (value.length < 32) throw new ConfigError(`${name} quá ngắn (cần ≥ 32 ký tự ngẫu nhiên)`);
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  const dataDir = resolve(text(env, 'DATA_DIR', './data'));
  const secrets = {
    aiId: secret(env, 'AI_ID_SECRET'),
    aiToken: secret(env, 'AI_TOKEN_SECRET'),
    telemetryId: secret(env, 'TELEMETRY_ID_SECRET'),
  };
  if (new Set(Object.values(secrets)).size !== 3) {
    throw new ConfigError('AI_ID_SECRET, AI_TOKEN_SECRET và TELEMETRY_ID_SECRET phải khác nhau');
  }
  const apiKeyFile = env.HERMES_API_KEY_FILE?.trim();
  const apiKey = apiKeyFile ? readFileSync(apiKeyFile, 'utf8').trim() : (env.HERMES_API_KEY?.trim() ?? '');
  const baseUrl = text(env, 'HERMES_BASE_URL', 'http://127.0.0.1:11434/v1').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl))
    throw new ConfigError('HERMES_BASE_URL phải bắt đầu bằng http:// hoặc https://');
  return {
    host: text(env, 'HOST', '127.0.0.1'),
    port: integer(env, 'PORT', 8787, 1, 65535),
    adminHost: text(env, 'ADMIN_HOST', '127.0.0.1'),
    adminPort: integer(env, 'ADMIN_PORT', 8788, 1, 65535),
    dataDir,
    trustedProxies: list(env, 'TRUSTED_PROXY', ['127.0.0.1', '::1']),
    corsOrigins: list(env, 'CORS_ORIGINS', [
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ]),
    hermes: {
      baseUrl,
      model: text(env, 'HERMES_MODEL', 'hermes3'),
      apiKey: apiKey === '' ? null : apiKey,
      timeoutMs: integer(env, 'HERMES_TIMEOUT_S', 120, 5, 900) * 1000,
    },
    secrets,
    ai: {
      maxConcurrency: integer(env, 'AI_MAX_CONCURRENCY', 2, 1, 64),
      queueMax: integer(env, 'AI_QUEUE_MAX', 20, 0, 1000),
      queueTimeoutMs: integer(env, 'AI_QUEUE_TIMEOUT_S', 60, 1, 600) * 1000,
      globalRpm: integer(env, 'AI_GLOBAL_RPM', 60, 1, 100_000),
      ipRpm: integer(env, 'AI_IP_RPM', 10, 1, 10_000),
      maxInputTokens: integer(env, 'AI_MAX_INPUT_TOKENS', 6000, 500, 200_000),
      quota: {
        commit: integer(env, 'AI_QUOTA_COMMIT', 30, 0, 100_000),
        explain: integer(env, 'AI_QUOTA_EXPLAIN', 20, 0, 100_000),
        pr: integer(env, 'AI_QUOTA_PR', 10, 0, 100_000),
      },
      maxTokens: {
        commit: integer(env, 'AI_MAX_TOKENS_COMMIT', 400, 16, 8192),
        explain: integer(env, 'AI_MAX_TOKENS_EXPLAIN', 900, 16, 8192),
        pr: integer(env, 'AI_MAX_TOKENS_PR', 1200, 16, 8192),
      },
      killSwitchFile: text(env, 'AI_KILL_SWITCH_FILE', resolve(dataDir, 'ai-disabled')),
    },
    telemetry: {
      newIdsPerIpPerDay: integer(env, 'TELEMETRY_NEW_IDS_PER_IP', 20, 1, 10_000),
    },
    download: {
      repo: text(env, 'DOWNLOAD_REPO', 'HoangThai18/thaigit'),
    },
  };
}
