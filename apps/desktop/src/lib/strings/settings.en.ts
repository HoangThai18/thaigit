/** English translation of `setting.vi.ts` (same keys, same parameters). */
import type { settings as source } from './settings.vi.ts';
import type { Translation } from './types.ts';

export const settings: Translation<typeof source> = {
  title: 'Settings',
  open: 'Settings…',
  shortcut: 'Ctrl/⌘ + ,',
  close: 'Done',

  appearance: 'Appearance',
  language: 'Language / Ngôn ngữ',
  languageHelp: 'Changing the language reloads this window; other windows switch when reopened.',
  scheme: 'Color scheme',
  schemeSystem: 'Follow system',
  schemeLight: 'Light',
  schemeDark: 'Dark',
  glass: 'Glass effect (turn off on slow machines)',
  relativeDates: 'Show relative times ("5 minutes ago")',

  history: 'History',
  commitLimit: 'Commits loaded at a time',
  logOrder: 'Commit order',
  logOrderDate: 'By date',
  logOrderTopo: 'By branch (topological)',
  showRemoteBranches: 'Show remote branches in the graph',
  showTags: 'Show tags in the graph',

  sync: 'Sync',
  pullMode: 'Pull button uses',
  pullMerge: 'Merge',
  pullRebase: 'Rebase',
  pullFastForward: 'Fast-forward only',
  fetchPrune: 'Remove deleted remote branches when fetching (--prune)',
  showAvatars: 'Real author avatars on the graph',
  showAvatarsTip:
    'Off = the graph downloads no images and just draws initials (author names never leave this computer)',
  autoFetch: 'Auto-fetch every (minutes, 0 = off)',

  diff: 'Diff',
  diffContext: 'Context lines around changes',

  ai: 'AI commit messages',
  aiOn: 'On — you agreed to send filtered changes to the Thaigit server when you click the AI button.',
  aiOff:
    'Off — the first time you click "Write with AI", Thaigit asks for your consent before sending anything.',
  aiDisable: 'Turn off AI',
  aiLanguage: 'Default language',
  aiLength: 'Default length',
  aiConventional: 'Use Conventional Commits (feat:, fix:…)',

  privacy: 'Privacy',
  telemetry: 'Send anonymous statistics',
  telemetryHelp:
    'At most once a day: a random ID, the operating system, CPU architecture and Thaigit version — to know how many people use which version. No repository names, paths, code or emails are sent. Turning it off deletes the ID.',
  telemetryUnsupported: "This build doesn't send statistics.",

  updates: 'Updates',
  channel: 'Update channel',
  channelBeta: 'Beta — get early test builds',
  channelStable: 'Stable',
  channelFailed: "Couldn't change the update channel",

  safety: 'Safety',
  safetyHelp:
    "Thaigit doesn't trust unusual repos: every git command passes through a checkpoint before running.",
  safetyAllowedCommands: (n: number) =>
    `Only the ${n} git commands Thaigit knows run (no aliases, no unusual paths).`,
  safetyForceSafeConfig:
    'Force `core.fsmonitor=false`, empty `core.hooksPath`, and `protocol.file.allow=user`, `protocol.ext.allow=never` on every command.',
  safetyDiffNeverRunsRepoCode:
    'Viewing-diff commands (`diff`, `show`, `blame`, `log`…) always add `--no-ext-diff --no-textconv`: the repo cannot run any program from its config.',
  safetyUrlSchemesBlocked: (schemes: string) =>
    `Block the URL schemes ${schemes} — no clone / pull / push through arbitrary programs.`,
  safetyEnvStripped:
    "Strip env vars that can point at another repo (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`…) and block the caller's `-c` flags.",

  invalidNumber: (min: number, max: number) => `Enter a number from ${min} to ${max}`,

  askTitle: 'Help make Thaigit better?',
  askText:
    'Allow sending anonymous statistics (once a day: a random ID, operating system, version). Nothing about your repositories or code is sent. You can change this in Settings.',
  askYes: 'Allow',
  askNo: 'No, thanks',
};
