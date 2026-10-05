import type { FaqItem } from './content';

export interface GuideNote {
  kind: 'tip' | 'warn';
  text: string;
}

export interface GuideSection {
  heading: string;
  paragraphs?: string[];
  steps?: string[];
  code?: string[];
  sample?: string[];
  note?: GuideNote;
  shot?: import('./shots').ShotName;
}

export interface GuideText {
  title: string;
  short: string;
  description: string;
  intro: string[];
  sections: GuideSection[];
  faq: FaqItem[];
}
