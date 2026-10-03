// Băm ID và token cài đặt. Ba secret khác nhau: id_hash của AI và tel_hash của thống kê không nối được với nhau; token
// AI = HMAC(AI_TOKEN_SECRET, aiInstallId) nên kiểm được mà không cần lưu token.

import { createHmac, timingSafeEqual } from 'node:crypto';

export function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function installToken(secret: string, aiInstallId: string): string {
  return createHmac('sha256', secret).update(`ai-token:${aiInstallId}`).digest('base64url');
}

/** So sánh thời gian hằng (không lộ độ dài khớp qua thời gian phản hồi). */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
