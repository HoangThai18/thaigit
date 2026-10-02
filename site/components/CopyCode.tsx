'use client';

import { useState } from 'react';

/** Khối lệnh có nút "Chép". */
export function CopyCode({ code, label = 'Chép' }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <pre className="code">
      <code>{code}</code>
      <button
        type="button"
        className="copy"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? 'Đã chép' : label}
      </button>
    </pre>
  );
}
