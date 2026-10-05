'use client';

import { useEffect, useRef, useState } from 'react';
import type { Feature } from '@/lib/content';
import { SHOTS } from '@/lib/shots';
import { useLang } from './LangProvider';
import { Shot } from './Shot';

export function FeatureTabs({ features, seconds = 6 }: { features: Feature[]; seconds?: number }) {
  const lang = useLang();
  const [active, setActive] = useState(0);
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setAutoplay(!still);
    const element = wrap.current;
    if (!element || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), {
      threshold: 0.25,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const running = autoplay && visible && !paused;
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      setActive((index) => (index + 1) % features.length);
      setRun((value) => value + 1);
    }, seconds * 1000);
    return () => clearTimeout(timer);
  }, [running, active, run, seconds, features.length]);

  const select = (index: number) => {
    setActive(index);
    setRun((value) => value + 1);
  };
  const pause = () => setPaused(true);
  const resume = () => {
    setPaused(false);
    setRun((value) => value + 1);
  };
  const current = features[active] ?? features[0];

  return (
    <div
      ref={wrap}
      className="features"
      data-reveal
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume();
      }}
    >
      <div className="feature-list">
        {features.map((feature, index) => {
          const on = index === active;
          return (
            <div
              key={feature.id}
              id={feature.id}
              className={`feature-tab${on ? ' on' : ''}`}
              onClick={() => select(index)}
            >
              <div className="meta">
                <span className="num">{String(index + 1).padStart(2, '0')}</span>
                <span className="tag">{feature.tag}</span>
              </div>
              <h3>
                <button
                  type="button"
                  className="feature-tab-button"
                  aria-expanded={on}
                  aria-controls={`${feature.id}-panel`}
                  onClick={(event) => {
                    event.stopPropagation();
                    select(index);
                  }}
                >
                  {feature.title}
                </button>
              </h3>
              <div id={`${feature.id}-panel`} className={`collapse${on ? ' open' : ''}`} inert={!on}>
                <div>
                  <p>{feature.text}</p>
                  <ul className="check-list">
                    {feature.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {on && autoplay && (
                <div className={`progress${running ? '' : ' paused'}`} aria-hidden="true">
                  <span key={`${active}-${run}`} style={{ '--dur': `${seconds}s` } as React.CSSProperties} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="feature-preview">
        <div className="window">
          <div className="window-bar" aria-hidden="true">
            <span className="lights">
              <i />
              <i />
              <i />
            </span>
            <span className="window-title">{current ? SHOTS[current.shot].alt[lang] : ''}</span>
          </div>
          <div className="preview-stack">
            {features.map((feature, index) => (
              <Shot
                key={feature.id}
                name={feature.shot}
                lang={lang}
                className={index === active ? 'on' : undefined}
                alt={index === active ? undefined : ''}
                sizes="(max-width: 1000px) 100vw, 680px"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
