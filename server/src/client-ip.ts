// IP thật của client. Sau reverse proxy, địa chỉ socket là của proxy → chỉ tin `X-Real-IP` khi peer nằm trong
// TRUSTED_PROXY (proxy của mình ghi đè header này; client tự gửi thì bị bỏ qua). Khoá giới hạn: IPv4 theo từng địa chỉ
// (CGNAT phổ biến ở VN — không gom /24), IPv6 gom theo /64 (một máy thường có cả dải /64).

import { isIP } from 'node:net';

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

/** Mở rộng IPv6 thành 8 nhóm hex 4 ký tự (hỗ trợ "::" và đuôi IPv4). */
function expandIpv6(ip: string): string[] | null {
  let address = ip.toLowerCase();
  const zone = address.indexOf('%');
  if (zone !== -1) address = address.slice(0, zone);
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (tail?.[1] !== undefined) {
    const value = ipv4ToInt(tail[1]);
    address = `${address.slice(0, -tail[1].length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : (halves[0] ?? '').split(':');
  const rest = halves.length === 2 ? (halves[1] === '' ? [] : (halves[1] ?? '').split(':')) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  return [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest].map((group) =>
    group.padStart(4, '0'),
  );
}

/** "::ffff:1.2.3.4" → "1.2.3.4"; IP khác giữ nguyên. */
export function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapped?.[1] ?? ip;
}

function inRange(ip: string, range: string): boolean {
  const [base, bitsText] = range.split('/');
  if (base === undefined) return false;
  const kind = isIP(ip);
  if (kind !== isIP(base)) return false;
  if (bitsText === undefined) {
    return kind === 6 ? expandIpv6(ip)?.join(':') === expandIpv6(base)?.join(':') : ip === base;
  }
  const bits = Number(bitsText);
  if (kind === 4) {
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
  }
  const a = expandIpv6(ip)?.join('');
  const b = expandIpv6(base)?.join('');
  if (a === undefined || b === undefined || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  const bin = (hex: string) =>
    [...hex].map((char) => parseInt(char, 16).toString(2).padStart(4, '0')).join('');
  return bin(a).slice(0, bits) === bin(b).slice(0, bits);
}

export function isTrustedProxy(peer: string, trusted: readonly string[]): boolean {
  const ip = normalizeIp(peer);
  return trusted.some((range) => inRange(ip, range));
}

/** IP của client: header của proxy tin cậy, nếu không thì địa chỉ socket. */
export function clientIp(peer: string, realIpHeader: string | undefined, trusted: readonly string[]): string {
  const ip = normalizeIp(peer);
  if (realIpHeader !== undefined && isTrustedProxy(ip, trusted)) {
    const candidate = normalizeIp(realIpHeader.trim());
    if (isIP(candidate) !== 0) return candidate;
  }
  return ip;
}

/** Khoá dùng cho giới hạn theo IP: IPv4 nguyên địa chỉ, IPv6 theo /64. */
export function rateKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const groups = expandIpv6(ip);
  return groups === null ? ip : `${groups.slice(0, 4).join(':')}::/64`;
}
