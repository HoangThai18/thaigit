// Shared byte helpers for the runner, parsers and repository (pure, no `node:` imports).

// Lossy decoding matches Swift's `String(decoding:as:UTF8.self)`: invalid bytes become U+FFFD, a BOM is preserved.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** NUL-separated path list (each entry ends with NUL), for `--pathspec-from-file=- --pathspec-file-nul`. */
export function nulSeparated(paths: readonly string[]): Uint8Array {
  for (const path of paths) {
    // A NUL in a name would split it into an unintended extra pathspec.
    if (path === '' || path.includes('\0'))
      throw new RangeError(`Đường dẫn không hợp lệ: ${JSON.stringify(path)}`);
  }
  return concatBytes(paths.map((path) => encodeUtf8(`${path}\0`)));
}

/** Lowercase hex SHA-256 (Web Crypto: available in Node ≥ 19, the webview and workers). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
