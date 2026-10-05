/**
 * Real commit-author avatars for graph nodes (like GitKraken). Rust downloads and disk-caches them, then
 * returns data URLs (`avatar_lookup`); here we only keep the DECODED images so the canvas can paint them.
 * Without an image the node draws initials.
 *
 * One store shared by every window: a given email is only asked about once, and `version` bumps whenever a
 * new image arrives so the canvas layer repaints exactly once instead of once per row.
 */
import { avatarLookup, type GithubRepoRef } from '../ipc/index.ts';

/** Decoded images kept in RAM; beyond this the oldest is dropped (Rust still has the disk cache, so a refetch is cheap). */
const MEMORY_LIMIT = 400;
/** Give up on an email after this many failed attempts (missing command, broken IPC) — never hammer on every scroll. */
const MAX_ATTEMPTS = 3;

/** Cache key per email: normalised exactly like Rust's `normalize` so one person maps to one entry. */
export function avatarKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Avatar download port — tests substitute a fake and never touch real IPC. `github` is the open repo's GitHub
 * repo: it lets Rust resolve avatars for real emails through the commits API (most GitHub users have no
 * Gravatar).
 */
export type AvatarPort = (email: string, github: GithubRepoRef | null) => Promise<string | null>;

/** Decoded avatar: Rust only returns raster images, so this is always an `HTMLImageElement` (the canvas draws at natural size). */
export type AvatarImage = HTMLImageElement;

/** Decode a data URL into a loaded image. `null` when there is no `Image` (test environment) or the image is broken. */
async function decode(dataUrl: string): Promise<AvatarImage | null> {
  if (typeof Image === 'undefined') return null;
  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    return null;
  }
  return image;
}

export class AvatarStore {
  /** Bumps whenever a new image arrives — the canvas layer reads it to know when to repaint. */
  version = $state(0);
  readonly #images = new Map<string, AvatarImage>();
  /** Emails with no avatar (already looked up) — so we never ask about the same person twice. */
  readonly #missing = new Set<string>();
  readonly #pending = new Map<string, Promise<void>>();
  /** Failed attempt counts (command missing — e.g. the DEV bridge; or broken IPC). Once exhausted, no more retries. */
  readonly #failed = new Map<string, number>();

  /**
   * GitHub repo of the open repo. Reset whenever another tab is opened; already loaded images stay in memory
   * (correct for most repos), so only genuinely new images are looked up for a new repo.
   */
  github = $state<GithubRepoRef | null>(null);

  /**
   * The "Real avatars on graph" preference. Turning it off clears cached images (bumping `version` so the
   * canvas repaints initials) and stops all lookups — mirroring the Swift app's `AvatarStore.isEnabled`.
   */
  enabled = $state(true);

  constructor(private readonly port: AvatarPort = avatarLookup) {}

  /** Enable / disable avatars. With `true`, cleared images are reloaded as rows enter the viewport. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled || this.#images.size === 0) return;
    this.#images.clear();
    this.#missing.clear();
    this.version += 1;
  }

  /** Decoded avatar for `email`; `null` while not yet loaded or when there is none. */
  image(email: string): AvatarImage | null {
    const key = avatarKey(email);
    if (!key.includes('@')) return null;
    return this.#images.get(key) ?? null;
  }

  /** Make sure `email`'s image is in memory (downloading it if needed). Failures are silent: the node draws initials. */
  ensure(email: string): void {
    const key = avatarKey(email);
    if (!this.enabled) return;
    if (!key.includes('@') || this.#images.has(key) || this.#missing.has(key) || this.#pending.has(key))
      return;
    if ((this.#failed.get(key) ?? 0) >= MAX_ATTEMPTS) return;
    const pending = this.#load(key, email);
    this.#pending.set(key, pending);
    void pending.then(() => this.#pending.delete(key));
  }

  async #load(key: string, email: string): Promise<void> {
    let dataUrl: string | null;
    try {
      dataUrl = await this.port(email, this.github);
    } catch {
      // Don't record "no avatar": the lookup is worth retrying (network error, untrusted repo…). But don't retry forever.
      this.#failed.set(key, (this.#failed.get(key) ?? 0) + 1);
      return;
    }
    if (dataUrl === null) {
      this.#missing.add(key);
      return;
    }
    const image = await decode(dataUrl);
    if (image === null) {
      this.#missing.add(key);
      return;
    }
    this.#remember(key, image);
    this.version += 1;
  }

  #remember(key: string, image: AvatarImage): void {
    this.#images.delete(key);
    this.#images.set(key, image);
    while (this.#images.size > MEMORY_LIMIT) {
      const oldest = this.#images.keys().next();
      if (oldest.done) break;
      this.#images.delete(oldest.value);
    }
  }
}

/** Shared store: several repo windows looking at the same committer must not download them again. */
export const avatars = new AvatarStore();
