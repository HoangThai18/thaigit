import { GUIDE_SLUGS, type Lang } from './i18n';
import type { GuideText } from './guide-types';
import { GUIDES_EN } from './guides.en';
import { GUIDES_VI } from './guides.vi';
import type { ShotName } from './shots';

export type { GuideSection, GuideText } from './guide-types';

export interface Guide {
  id: string;
  tag: Record<Lang, string>;
  accent: [string, string];
  cover: ShotName;
  minutes: number;
  updated: string;
}

const ORANGE: [string, string] = ['#f7764f', '#e2412a'];
const BLUE: [string, string] = ['#4b9bf0', '#1f6fd1'];
const GREEN: [string, string] = ['#2fc37a', '#14945a'];
const VIOLET: [string, string] = ['#a17bf7', '#7447e0'];
const CYAN: [string, string] = ['#21b8cf', '#0b8fa5'];
const AMBER: [string, string] = ['#f7b53b', '#dd8a0c'];

export const GUIDES: Guide[] = [
  {
    id: 'conflict',
    tag: { vi: 'Xung đột', en: 'Conflicts' },
    accent: ORANGE,
    cover: 'conflict',
    minutes: 6,
    updated: '2026-10-05',
  },
  {
    id: 'stage-lines',
    tag: { vi: 'Commit', en: 'Commits' },
    accent: BLUE,
    cover: 'diff-lines',
    minutes: 4,
    updated: '2026-10-05',
  },
  {
    id: 'undo',
    tag: { vi: 'Hoàn tác', en: 'Undo' },
    accent: VIOLET,
    cover: 'overview',
    minutes: 5,
    updated: '2026-10-05',
  },
  {
    id: 'merge-rebase',
    tag: { vi: 'Nhánh', en: 'Branches' },
    accent: GREEN,
    cover: 'drag',
    minutes: 6,
    updated: '2026-10-05',
  },
  {
    id: 'stash',
    tag: { vi: 'Nhánh', en: 'Branches' },
    accent: AMBER,
    cover: 'switch',
    minutes: 4,
    updated: '2026-10-05',
  },
  {
    id: 'install',
    tag: { vi: 'Bắt đầu', en: 'Getting started' },
    accent: CYAN,
    cover: 'welcome',
    minutes: 4,
    updated: '2026-10-05',
  },
  {
    id: 'cherry-pick',
    tag: { vi: 'Commit', en: 'Commits' },
    accent: ORANGE,
    cover: 'overview-dark',
    minutes: 4,
    updated: '2026-10-05',
  },
  {
    id: 'gitignore',
    tag: { vi: 'Cơ bản', en: 'Basics' },
    accent: GREEN,
    cover: 'diff-split',
    minutes: 4,
    updated: '2026-10-05',
  },
  {
    id: 'fetch-pull',
    tag: { vi: 'Remote', en: 'Remotes' },
    accent: BLUE,
    cover: 'large',
    minutes: 4,
    updated: '2026-10-05',
  },
  {
    id: 'tag',
    tag: { vi: 'Phát hành', en: 'Releases' },
    accent: AMBER,
    cover: 'image-diff',
    minutes: 4,
    updated: '2026-10-05',
  },
  {
    id: 'ssh',
    tag: { vi: 'Bảo mật', en: 'Security' },
    accent: CYAN,
    cover: 'welcome',
    minutes: 5,
    updated: '2026-10-05',
  },
];

const TEXTS: Record<Lang, Record<string, GuideText>> = { vi: GUIDES_VI, en: GUIDES_EN };

export function guideText(lang: Lang, id: string): GuideText {
  return TEXTS[lang][id];
}

export function guideSlug(lang: Lang, id: string): string {
  return GUIDE_SLUGS[id][lang];
}

export function findGuide(lang: Lang, slug: string): Guide | undefined {
  return GUIDES.find((guide) => GUIDE_SLUGS[guide.id][lang] === slug);
}

export function relatedGuides(current: Guide, count = 3): Guide[] {
  const others = GUIDES.filter((guide) => guide.id !== current.id);
  const sameTag = others.filter((guide) => guide.tag.vi === current.tag.vi);
  const rest = others.filter((guide) => guide.tag.vi !== current.tag.vi);
  return [...sameTag, ...rest].slice(0, count);
}
