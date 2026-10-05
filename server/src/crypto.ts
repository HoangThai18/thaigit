// Hashing of ids and the install token. Three separate secrets: the AI id_hash and the analytics tel_hash cannot be linked;
// the AI token = HMAC(AI_TOKEN_SECRET, aiInstallId), so it can be verified without storing it.

import { createHmac, timingSafeEqual } from 'node:crypto';

export function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function installToken(secret: string, aiInstallId: string): string {
  return createHmac('sha256', secret).update(`ai-token:${aiInstallId}`).digest('base64url');
}

/** Constant-time comparison (does not leak the matching prefix through response timing). */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
