'use client';

import { useEffect, useRef, useState } from 'react';

type CopyState = 'idle' | 'done' | 'failed';
const LABELS: Record<CopyState, string> = { idle: 'Chép', done: 'Đã chép', failed: 'Hãy chép tay' };

/** Khối lệnh kiểu cửa sổ Terminal, mỗi dòng có dấu `$`, nút "Chép" chép đúng lệnh (không kèm `$`). */
export function CopyCode({ code, className }: { code: string; className?: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let next: CopyState = 'done';
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      next = 'failed';
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1600);
  };

  return (
    <div className={`terminal${className ? ` ${className}` : ''}`}>
      <div className="terminal-bar">
        <span className="lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <button type="button" className="copy" onClick={() => void copy()} aria-live="polite">
          {LABELS[state]}
        </button>
      </div>
      <pre>
        <code>
          {code.split('\n').map((line, index) => (
            <span key={index}>
              {index > 0 && '\n'}
              <span className="prompt" aria-hidden="true">
                ${' '}
              </span>
              {line}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
