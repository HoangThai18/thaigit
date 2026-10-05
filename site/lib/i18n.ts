export type Lang = 'vi' | 'en';

export const LANGS: readonly Lang[] = ['vi', 'en'];

export const LANG_NAME: Record<Lang, string> = { vi: 'Tiếng Việt', en: 'English' };

export const OG_LOCALE: Record<Lang, string> = { vi: 'vi_VN', en: 'en_US' };

export type PageKey = 'home' | 'mac' | 'windows' | 'guides' | 'changelog' | 'privacy';

export const PATHS: Record<PageKey, Record<Lang, string>> = {
  home: { vi: '/', en: '/en/' },
  mac: { vi: '/mac/', en: '/en/mac/' },
  windows: { vi: '/windows/', en: '/en/windows/' },
  guides: { vi: '/huong-dan/', en: '/en/guides/' },
  changelog: { vi: '/nhat-ky/', en: '/en/changelog/' },
  privacy: { vi: '/quyen-rieng-tu/', en: '/en/privacy/' },
};

export const GUIDE_SLUGS: Record<string, Record<Lang, string>> = {
  conflict: { vi: 'giai-conflict-git', en: 'resolve-merge-conflicts' },
  'stage-lines': { vi: 'stage-tung-dong', en: 'stage-lines' },
  undo: { vi: 'hoan-tac-commit', en: 'undo-a-commit' },
  'merge-rebase': { vi: 'merge-va-rebase', en: 'merge-vs-rebase' },
  stash: { vi: 'git-stash', en: 'git-stash' },
  install: { vi: 'cai-dat-git', en: 'install-git' },
  'cherry-pick': { vi: 'cherry-pick', en: 'cherry-pick' },
  gitignore: { vi: 'gitignore', en: 'gitignore' },
  'fetch-pull': { vi: 'pull-va-fetch', en: 'fetch-vs-pull' },
  tag: { vi: 'git-tag', en: 'git-tag' },
  ssh: { vi: 'khoa-ssh-github', en: 'ssh-key-github' },
};

export function langOfPath(pathname: string): Lang {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'vi';
}

export function guidePath(lang: Lang, id: string): string {
  return `${PATHS.guides[lang]}${GUIDE_SLUGS[id]?.[lang] ?? ''}/`;
}

export function counterpart(pathname: string, to: Lang): string {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const from = langOfPath(path);
  for (const key of Object.keys(PATHS) as PageKey[]) {
    if (PATHS[key][from] === path) return PATHS[key][to];
  }
  const base = PATHS.guides[from];
  if (path.startsWith(base)) {
    const slug = path.slice(base.length).replace(/\/$/, '');
    for (const id of Object.keys(GUIDE_SLUGS)) {
      if (GUIDE_SLUGS[id][from] === slug) return guidePath(to, id);
    }
  }
  return PATHS.home[to];
}

export function alternatesFor(paths: Record<Lang, string>): Record<string, string> {
  return { vi: paths.vi, en: paths.en, 'x-default': paths.vi };
}
