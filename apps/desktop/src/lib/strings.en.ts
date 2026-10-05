/** Bản tiếng Anh của mọi chuỗi giao diện — cùng hình dạng với `strings.vi.ts` (kiểm bằng kiểu `Strings`). */
import { accounts, pullRequests } from './strings/accounts.en.ts';
import { ai } from './strings/ai.en.ts';
import { branches } from './strings/branches.en.ts';
import { dnd } from './strings/dnd.en.ts';
import { history } from './strings/history.en.ts';
import { lfs } from './strings/lfs.en.ts';
import { palette } from './strings/palette.en.ts';
import { rebase } from './strings/rebase.en.ts';
import { related } from './strings/related.en.ts';
import { remote } from './strings/remote.en.ts';
import { risk } from './strings/risk.en.ts';
import { settings } from './strings/settings.en.ts';
import { shell } from './strings/shell.en.ts';
import { snapshots } from './strings/snapshots.en.ts';
import { ssh } from './strings/ssh.en.ts';
import { staging } from './strings/staging.en.ts';
import { tabs } from './strings/tabs.en.ts';
import { terminal } from './strings/terminal.en.ts';
import { update } from './strings/update.en.ts';
import type { Strings } from './strings.vi.ts';

export const en: Strings = {
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
};
