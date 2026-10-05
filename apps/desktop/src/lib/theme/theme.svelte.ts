/**
 * Theme: applies the light / dark / system choice and the glass / no-glass mode to `<html>`, and tells the
 * graph canvas to repaint when colours change. The colour tokens live in tokens.css; here we only toggle
 * `data-theme` and the `no-glass` class (also enabled when the OS asks for reduced transparency).
 */
import { untrack } from 'svelte';
import type { ColorScheme } from '../stores/prefs.svelte.ts';

function query(text: string): MediaQueryList | null {
  return typeof matchMedia === 'undefined' ? null : matchMedia(text);
}

export class ThemeStore {
  /** Bumped whenever the palette may have changed (system light/dark switch, choice changed) → the canvas repaints with the new colours. */
  version = $state(0);
  /** The OS has "Reduce transparency" (macOS) / "Transparency effects" off (Windows) enabled — if the webview can report it. */
  systemReducedTransparency = $state(query('(prefers-reduced-transparency: reduce)')?.matches ?? false);

  apply(scheme: ColorScheme, glass: boolean, root: HTMLElement = document.documentElement): void {
    if (scheme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', scheme);
    root.classList.toggle('no-glass', !glass || this.systemReducedTransparency);
    // `apply` runs in an $effect: reading `version` here would make the effect self-trigger forever.
    untrack(() => {
      this.version += 1;
    });
  }

  /** Track system light/dark and "reduce transparency" changes. Returns an unsubscribe function. */
  watchSystem(): () => void {
    const dark = query('(prefers-color-scheme: dark)');
    const transparency = query('(prefers-reduced-transparency: reduce)');
    const onScheme = (): void => {
      this.version++;
    };
    const onTransparency = (): void => {
      this.systemReducedTransparency = transparency?.matches ?? false;
    };
    dark?.addEventListener('change', onScheme);
    transparency?.addEventListener('change', onTransparency);
    return () => {
      dark?.removeEventListener('change', onScheme);
      transparency?.removeEventListener('change', onTransparency);
    };
  }
}

export const theme = new ThemeStore();
