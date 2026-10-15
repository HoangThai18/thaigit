let pending: Promise<string | null> | null = null;

function canvasSignal(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 40;
    const context = canvas.getContext('2d');
    if (context === null) return '';
    context.textBaseline = 'top';
    context.font = '16px Arial';
    context.fillStyle = '#f60';
    context.fillRect(100, 1, 60, 20);
    context.fillStyle = '#069';
    context.fillText('Thaigit ✓ Tiếng Việt', 2, 15);
    return canvas.toDataURL();
  } catch {
    return '';
  }
}

function webglSignal(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl === null) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info === null) return String(gl.getParameter(gl.RENDERER));
    return `${gl.getParameter(info.UNMASKED_VENDOR_WEBGL)}|${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)}`;
  } catch {
    return '';
  }
}

async function compute(): Promise<string | null> {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const parts = [
      nav.userAgent,
      nav.languages.join(','),
      nav.platform,
      nav.hardwareConcurrency,
      nav.deviceMemory ?? '',
      nav.maxTouchPoints,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      window.devicePixelRatio,
      webglSignal(),
      canvasSignal(),
    ];
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\u001f')));
    return [...new Uint8Array(digest)]
      .slice(0, 16)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/** Browser fingerprint (32 hex chars), computed once per page; null when the browser blocks the APIs. */
export function browserFingerprint(): Promise<string | null> {
  pending ??= compute();
  return pending;
}
