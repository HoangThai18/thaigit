'use client';

import { useEffect, useRef, useState } from 'react';
import { SoundOffIcon, SoundOnIcon } from './Icons';

type Props = { src: string; poster: string; soundOn: string; soundOff: string };

export function PromoVideo({ src, poster, soundOn, soundOff }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const wantSound = useRef(true);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const start = async () => {
      video.preload = 'auto';
      if (wantSound.current) {
        video.muted = false;
        try {
          await video.play();
          setMuted(false);
          return;
        } catch {
          video.muted = true;
        }
      }
      video.muted = true;
      setMuted(true);
      if (!reduced) await video.play().catch(() => {});
    };

    const stop = () => {
      video.pause();
      video.muted = true;
      setMuted(true);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.intersectionRatio >= 0.6) void start();
        else if (entry.intersectionRatio < 0.25) stop();
      },
      { threshold: [0, 0.25, 0.6, 1] },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const toggle = async () => {
    const video = ref.current;
    if (!video) return;
    const next = !muted;
    wantSound.current = !next;
    video.muted = next;
    setMuted(next);
    if (video.paused) await video.play().catch(() => {});
  };

  return (
    <div className="promo-video-frame">
      <video
        ref={ref}
        src={src}
        poster={poster}
        width={1600}
        height={900}
        muted
        loop
        playsInline
        preload="metadata"
        onClick={() => void toggle()}
      />
      <button
        type="button"
        className={`sound-toggle${muted ? ' is-muted' : ''}`}
        onClick={() => void toggle()}
        aria-pressed={!muted}
      >
        {muted ? <SoundOffIcon /> : <SoundOnIcon />}
        <span>{muted ? soundOn : soundOff}</span>
      </button>
    </div>
  );
}
