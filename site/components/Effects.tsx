'use client';

import { useEffect } from 'react';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Hiệu ứng dùng chung của trang chủ, gắn một lần (không vẽ gì):
 * - `data-os` trên <html> để tô thẻ tải về hợp với máy đang xem;
 * - quầng sáng theo chuột cho phần tử `[data-spot]`;
 * - ảnh hero `[data-tilt]` nghiêng rồi dựng thẳng dần khi cuộn;
 * - `[data-reveal]` ở dưới màn hình hiện dần khi cuộn tới.
 * Mọi lỗi (trình duyệt cũ thiếu API) chỉ làm mất hiệu ứng, trang vẫn đọc được bình thường.
 */
export function Effects() {
  useEffect(() => {
    const root = document.documentElement;
    const ua = navigator.userAgent || '';
    root.dataset.os = /Windows/i.test(ua)
      ? 'win'
      : /Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)
        ? 'mac'
        : 'other';

    const onPointerMove = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest?.<HTMLElement>('[data-spot]');
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      target.style.setProperty('--my', `${event.clientY - rect.top}px`);
    };
    document.addEventListener('pointermove', onPointerMove, { passive: true });

    const still = reducedMotion();
    const tilt = document.querySelector<HTMLElement>('[data-tilt]');
    let frame = 0;
    const applyTilt = () => {
      frame = 0;
      if (!tilt) return;
      const viewport = window.innerHeight || 800;
      const progress = Math.min(1, Math.max(0, 1 - tilt.getBoundingClientRect().top / (viewport * 0.62)));
      tilt.style.transform = `rotateX(${(1 - progress) * 20}deg) scale(${0.9 + 0.1 * progress})`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(applyTilt);
    };
    if (tilt && !still) {
      applyTilt();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
    }

    let observer: IntersectionObserver | null = null;
    if (!still && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.remove('pre-reveal');
            observer?.unobserve(entry.target);
          }
        },
        { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
      );
      const viewport = window.innerHeight || 800;
      let index = 0;
      for (const element of document.querySelectorAll<HTMLElement>('[data-reveal]')) {
        // Phần đang thấy lúc mở trang giữ nguyên — không nhấp nháy.
        if (element.getBoundingClientRect().top < viewport) continue;
        element.style.setProperty('--delay', `${(index++ % 3) * 70}ms`);
        element.classList.add('pre-reveal');
        observer.observe(element);
      }
    }

    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
      observer?.disconnect();
      for (const element of document.querySelectorAll('.pre-reveal')) element.classList.remove('pre-reveal');
    };
  }, []);

  return null;
}
