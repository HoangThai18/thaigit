import { describe, expect, it } from 'vitest';
import { ThinkFilter } from '../src/ai/think-filter.ts';
import { clientIp, isTrustedProxy, rateKey } from '../src/client-ip.ts';
import { openDatabase, SchemaTooNewError } from '../src/db.ts';
import { ConfigError, loadConfig } from '../src/env.ts';
import { Admission, AdmissionRejected } from '../src/limits/admission.ts';
import { RateLimiter } from '../src/limits/rate.ts';
import { runRetention } from '../src/retention.ts';
import { nextVnMidnight, vnDay } from '../src/time.ts';
import { SECRETS } from './helpers.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ThinkFilter', () => {
  it('bỏ khối suy nghĩ dù thẻ bị cắt ở mọi vị trí', () => {
    const text = 'Mở đầu <think>bí mật\n</think> rồi <THINK>x</THINK>kết thúc <t';
    for (let size = 1; size <= 7; size += 1) {
      const filter = new ThinkFilter();
      let out = '';
      for (let index = 0; index < text.length; index += size)
        out += filter.push(text.slice(index, index + size));
      out += filter.end();
      expect(out, `cắt ${size}`).toBe('Mở đầu  rồi kết thúc <t');
    }
  });

  it('bỏ khoảng trắng đầu sau khối suy nghĩ', () => {
    const filter = new ThinkFilter();
    expect(filter.push('<think>a</think>\n\n')).toBe('');
    expect(filter.push('  Sửa lỗi')).toBe('Sửa lỗi');
  });
});

describe('client-ip', () => {
  it('chỉ tin header khi peer trong danh sách (kể cả CIDR, IPv6, IPv4-mapped)', () => {
    const trusted = ['127.0.0.1', '172.16.0.0/12', '::1'];
    expect(clientIp('::ffff:127.0.0.1', '1.2.3.4', trusted)).toBe('1.2.3.4');
    expect(clientIp('172.18.0.5', '2001:db8::1', trusted)).toBe('2001:db8::1');
    expect(clientIp('::1', 'không-phải-ip', trusted)).toBe('::1');
    expect(clientIp('8.8.8.8', '1.2.3.4', trusted)).toBe('8.8.8.8');
    expect(isTrustedProxy('172.32.0.1', trusted)).toBe(false);
  });

  it('IPv6 gom theo /64, IPv4 giữ nguyên', () => {
    expect(rateKey('2001:db8:1:2:aaaa::1')).toBe(rateKey('2001:db8:1:2:ffff:1:2:3'));
    expect(rateKey('2001:db8:1:3::1')).not.toBe(rateKey('2001:db8:1:2::1'));
    expect(rateKey('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('Admission (hàng đợi ưu tiên)', () => {
  it('300 cài đặt mới không chặn được người dùng cũ', async () => {
    const admission = new Admission({ concurrency: 2, queueMax: 10, timeoutMs: 5000 });
    const newcomers = [];
    let rejected = 0;
    for (let index = 0; index < 300; index += 1) {
      const ticket = admission.enter(false);
      if (ticket === null) {
        rejected += 1;
        continue;
      }
      newcomers.push(ticket);
      ticket.wait(() => {}).catch(() => {});
    }
    expect(admission.running).toBe(1); // a newcomer gets only half the slots
    expect(rejected).toBe(300 - 11);
    const veteran = admission.enter(true);
    expect(veteran).not.toBeNull();
    await veteran?.wait(() => {}); // a slot is still reserved for a familiar install → admitted right away
    expect(admission.running).toBe(2);
    // Queue full of newcomers: the next familiar install pushes the last newcomer out and takes the head of the queue.
    const next = admission.enter(true);
    const positions: number[] = [];
    const waiting = next?.wait((position) => positions.push(position));
    expect(positions).toEqual([1]);
    veteran?.release();
    await waiting;
    expect(admission.running).toBe(2);
  });

  it('hết giờ chờ → AdmissionRejected("timeout"); rời hàng nhả chỗ', async () => {
    const admission = new Admission({ concurrency: 1, queueMax: 5, timeoutMs: 20 });
    const first = admission.enter(true);
    await first?.wait(() => {});
    const second = admission.enter(true);
    await expect(second?.wait(() => {})).rejects.toEqual(new AdmissionRejected('timeout'));
    expect(admission.queued).toBe(0);
    first?.release();
    expect(admission.running).toBe(0);
  });
});

describe('RateLimiter', () => {
  it('nạp lại theo thời gian và báo số giây cần chờ', () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.take('k', 0).ok).toBe(true);
    expect(limiter.take('k', 0).ok).toBe(true);
    expect(limiter.take('k', 0)).toEqual({ ok: false, retryAfter: 30 });
    expect(limiter.take('k', 30_000).ok).toBe(true);
  });
});

describe('cấu hình, thời gian, DB', () => {
  it('secret thiếu / ngắn / trùng nhau → lỗi cấu hình', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ ...SECRETS, AI_ID_SECRET: 'ngắn' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...SECRETS, AI_TOKEN_SECRET: SECRETS.AI_ID_SECRET })).toThrow(ConfigError);
    expect(() => loadConfig({ ...SECRETS, AI_MAX_CONCURRENCY: '0' })).toThrow(ConfigError);
    expect(loadConfig(SECRETS).hermes.baseUrl).toBe('http://127.0.0.1:11434/v1');
  });

  it('ngày theo giờ Việt Nam', () => {
    const at = Date.parse('2026-10-03T17:30:00Z'); // 00:30 on 4 Oct, Vietnam time
    expect(vnDay(at)).toBe('2026-10-04');
    expect(nextVnMidnight(at)).toBe('2026-10-04T17:00:00.000Z');
  });

  it('code cũ gặp schema mới hơn → từ chối mở DB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thaigit-db-'));
    try {
      const path = join(dir, 'test.db');
      const db = openDatabase(path);
      db.prepare(`UPDATE schema_meta SET value = '99' WHERE key = 'schema_version'`).run();
      db.close();
      expect(() => openDatabase(path)).toThrow(SchemaTooNewError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('retention gộp daily_active vào daily_counts rồi xoá dữ liệu quá hạn', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare(
      'INSERT INTO daily_active (day, tel_hash, platform, arch, app_version) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run('2026-06-01', 'h1', 'windows', 'x86_64', '2.0.0');
    insert.run('2026-06-01', 'h2', 'windows', 'x86_64', '2.0.0');
    insert.run('2026-10-03', 'h1', 'macos', 'aarch64', '2.0.0');
    db.prepare(`INSERT INTO ai_quota VALUES ('2026-09-01', 'x', 'commit', 3)`).run();
    runRetention(db, Date.parse('2026-10-03T05:00:00Z'));
    expect(db.prepare('SELECT day, platform, dau FROM daily_counts').all()).toEqual([
      { day: '2026-06-01', platform: 'windows', dau: 2 },
    ]);
    expect(db.prepare('SELECT day FROM daily_active').all()).toEqual([{ day: '2026-10-03' }]);
    expect(db.prepare('SELECT * FROM ai_quota').all()).toEqual([]);
  });
});
