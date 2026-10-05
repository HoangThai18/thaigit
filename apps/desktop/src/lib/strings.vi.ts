/**
 * Every UI string in one place. `vi` is the string set FOR THE ACTIVE LANGUAGE (the old name is kept so
 * call sites don't all have to change): Vietnamese by default, English (`strings.en.ts`) when the user picks
 * it in Settings — chosen once at load time.
 * This file MERGES the sub-files under `strings/` (each `*.vi.ts` has a sibling `*.en.ts` with the same
 * keys):
 *  - `shell.vi.ts`: the "shell" strings (welcome, trust, window, graph, sidebar, inspector, time,
 *    errors, toast, dialog, menu, busy…) spread out flat, so `vi.window.x`, `vi.graph.x`… keep working as
 *    they did before the split.
 *  - each feature area gets its own namespace: `vi.staging`, `vi.branches`, `vi.remote`, `vi.update`,
 *    `vi.snapshots`, `vi.history` (one file, one area) — so areas worked on in parallel can never collide
 *    on a key or edit the same file. `strings.test.ts` keeps the shell namespaces key-disjoint.
 */
import { locale } from './i18n/locale.ts';
import { en } from './strings.en.ts';
import { accounts, pullRequests } from './strings/accounts.vi.ts';
import { ai } from './strings/ai.vi.ts';
import { branches } from './strings/branches.vi.ts';
import { dnd } from './strings/dnd.vi.ts';
import { history } from './strings/history.vi.ts';
import { lfs } from './strings/lfs.vi.ts';
import { palette } from './strings/palette.vi.ts';
import { rebase } from './strings/rebase.vi.ts';
import { related } from './strings/related.vi.ts';
import { remote } from './strings/remote.vi.ts';
import { risk } from './strings/risk.vi.ts';
import { settings } from './strings/settings.vi.ts';
import { shell } from './strings/shell.vi.ts';
import { snapshots } from './strings/snapshots.vi.ts';
import { ssh } from './strings/ssh.vi.ts';
import { staging } from './strings/staging.vi.ts';
import { tabs } from './strings/tabs.vi.ts';
import { terminal } from './strings/terminal.vi.ts';
import type { Translation } from './strings/types.ts';
import { update } from './strings/update.vi.ts';

const viStrings = {
  ...shell,
  staging,
  branches,
  remote,
  update,
  ai,
  settings,
  dnd,
  history,
  rebase,
  palette,
  related,
  lfs,
  tabs,
  accounts,
  pullRequests,
  snapshots,
  risk,
  ssh,
  terminal,
} as const;

/** The shape shared by every translation (strings are `string`, functions keep their parameters). */
export type Strings = Translation<typeof viStrings>;

export const vi: Strings = locale === 'en' ? en : viStrings;
