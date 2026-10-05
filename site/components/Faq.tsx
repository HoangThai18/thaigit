'use client';

import { useState } from 'react';
import type { FaqItem } from '@/lib/content';

export function Faq({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState(0);
  return (
    <div>
      {items.map((item, index) => {
        const isOpen = index === open;
        const id = `faq-${index + 1}`;
        return (
          <div key={item.q} className="faq-item">
            <h3 className="faq-q">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() => setOpen(isOpen ? -1 : index)}
              >
                {item.q}
                <span className="plus-icon" aria-hidden="true">
                  +
                </span>
              </button>
            </h3>
            <div id={id} className={`collapse${isOpen ? ' open' : ''}`} inert={!isOpen}>
              <div>
                <div className="faq-a">
                  {item.a.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
