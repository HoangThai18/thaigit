'use client';

import { useEffect, useRef, useState } from 'react';
import { Shot } from './Shot';

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** Kéo thanh giữa để so giao diện sáng / tối. Lần đầu cuộn tới tự lắc nhẹ một vòng cho người xem biết kéo được. */
export function Compare() {
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const sweepFrame = useRef(0);

  useEffect(() => {
    const element = box.current;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!element || still || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const duration = 1800;
        const step = (now: number) => {
          if (touched.current) return;
          const k = Math.min(1, (now - start) / duration);
          setSplit(k < 1 ? 50 + 26 * Math.sin(k * Math.PI * 2) * (1 - k * 0.3) : 50);
          if (k < 1) sweepFrame.current = requestAnimationFrame(step);
        };
        sweepFrame.current = requestAnimationFrame(step);
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(sweepFrame.current);
    };
  }, []);

  const stopSweep = () => {
    touched.current = true;
    cancelAnimationFrame(sweepFrame.current);
  };

  const moveTo = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect && rect.width > 0) setSplit(clamp(((clientX - rect.left) / rect.width) * 100));
  };

  return (
    <div
      ref={box}
      className="compare"
      role="slider"
      tabIndex={0}
      aria-label="So sánh giao diện sáng và tối"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split)}
      aria-valuetext={`Tối chiếm ${Math.round(100 - split)}%`}
      onPointerDown={(event) => {
        stopSweep();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Trình duyệt không cho bắt con trỏ: vẫn kéo được khi chuột còn trong khung.
        }
        setDragging(true);
        moveTo(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging) moveTo(event.clientX);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(event) => {
        const delta = { ArrowLeft: -5, ArrowRight: 5, Home: -100, End: 100 }[event.key];
        if (delta === undefined) return;
        event.preventDefault();
        stopSweep();
        setSplit((value) => clamp(value + delta));
      }}
    >
      <Shot name="overview" alt="Giao diện sáng" sizes="(max-width: 1180px) 100vw, 1140px" />
      <Shot
        name="overview-dark"
        alt="Giao diện tối"
        sizes="(max-width: 1180px) 100vw, 1140px"
        style={{ clipPath: `inset(0 0 0 ${split}%)` }}
      />
      <div className="handle" style={{ left: `${split}%` }} aria-hidden="true">
        <div className="knob">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 6-6 6 6 6M15 6l6 6-6 6" />
          </svg>
        </div>
      </div>
      <span className="label light" aria-hidden="true">
        Sáng
      </span>
      <span className="label dark" aria-hidden="true">
        Tối
      </span>
    </div>
  );
}
