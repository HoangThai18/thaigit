'use client';

import { useEffect, useRef, useState } from 'react';
import { SparkIcon } from './Icons';

const MESSAGE =
  'feat(auth): thêm đăng nhập qua API /login\n\n- Kiểm tra dữ liệu rỗng trước khi so khớp\n- Trả 401 khi sai tài khoản hoặc mật khẩu';

/** Ví dụ AI viết commit: chữ hiện dần khi cuộn tới; bấm nút để xem lại. Chỉ là minh hoạ, không gọi máy chủ nào. */
export function AiDemo() {
  const [typed, setTyped] = useState(MESSAGE.length);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const play = () => {
    clearInterval(timer.current);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setTyped(MESSAGE.length);
      return;
    }
    setTyped(0);
    timer.current = setInterval(() => {
      setTyped((count) => {
        if (count >= MESSAGE.length) {
          clearInterval(timer.current);
          return count;
        }
        return count + 1;
      });
    }, 24);
  };

  useEffect(() => {
    const element = box.current;
    if (!element || !('IntersectionObserver' in window)) return;
    // Còn ở dưới màn hình: xoá chữ trước để lúc cuộn tới thấy gõ từ đầu (không chớp cả đoạn rồi mới gõ).
    if (element.getBoundingClientRect().top > window.innerHeight) setTyped(0);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        play();
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearInterval(timer.current);
    };
  }, []);

  return (
    <div ref={box} className="ai-demo" role="group" aria-label="Ví dụ commit message do AI viết">
      <div className="ai-demo-head">
        <span>
          Thay đổi đã stage: 3 file · <span className="plus">+42</span> <span className="minus">−7</span>
        </span>
        <kbd aria-hidden="true">⌘↩</kbd>
      </div>
      <div className="ai-message">
        <span className="sr-only">{MESSAGE}</span>
        <span aria-hidden="true">
          {MESSAGE.slice(0, typed)}
          <span className="caret" />
        </span>
      </div>
      <button type="button" className="btn-spark" onClick={play}>
        <SparkIcon /> Viết bằng AI
      </button>
    </div>
  );
}
