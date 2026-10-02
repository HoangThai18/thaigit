<!-- Màn hình chính tối giản: mở thư mục + danh sách repo gần đây (do Rust lưu). Clone/tạo repo/cài đặt thuộc 4b. -->
<script lang="ts">
  import { formatRelative } from '../format/time.ts';
  import type { RecentRepo } from '../ipc/types.ts';
  import logo from '../assets/logo.png';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    recent: readonly RecentRepo[];
    opening: boolean;
    /** Thông báo khi chưa mở được repo (vd. chạy ngoài Tauri); có thì khoá nút mở. */
    unavailable?: string;
    onopen: () => void;
    onrecent: (repo: RecentRepo) => void;
    onforget: (repo: RecentRepo) => void;
  }

  let { recent, opening, unavailable, onopen, onrecent, onforget }: Props = $props();
</script>

<main class="welcome" data-tauri-drag-region>
  <section class="card glass">
    <img class="logo" src={logo} alt="" width="96" height="96" />
    <h1><span class="brand">{vi.appName}</span></h1>
    <p class="tagline">{vi.welcome.tagline}</p>

    <button type="button" class="primary" disabled={opening || unavailable !== undefined} onclick={onopen}>
      <Icon name="folder-open" size={17} />
      {opening ? vi.welcome.opening : vi.welcome.openFolder}
    </button>

    {#if unavailable}
      <p class="notice" role="status">{unavailable}</p>
    {/if}

    <h2>{vi.welcome.recent}</h2>
    {#if recent.length === 0}
      <p class="empty">{vi.welcome.recentEmpty}</p>
    {:else}
      <ul class="recent">
        {#each recent.slice(0, 8) as repo, index (index)}
          <li>
            <button type="button" class="item" disabled={opening} onclick={() => onrecent(repo)}>
              <span class="glyph"><Icon name="folder" size={18} /></span>
              <span class="text">
                <strong>{repo.name}</strong>
                <span class="path"><bdi>{repo.path}</bdi></span>
              </span>
              <span class="when">{formatRelative(repo.lastOpened / 1000)}</span>
            </button>
            <button
              type="button"
              class="forget"
              title={vi.welcome.forget}
              aria-label={vi.welcome.forget}
              onclick={() => onforget(repo)}
            >
              <Icon name="x" size={12} strokeWidth={2.4} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>

<style>
  .welcome {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 24px;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(520px, 100%);
    max-height: 100%;
    padding: 28px 32px 24px;
    border-radius: 24px;
    text-align: center;
    overflow-y: auto;
  }

  .logo {
    filter: drop-shadow(0 8px 16px rgb(20 30 60 / 0.25));
  }

  h1 {
    margin: 10px 0 4px;
    font-size: 36px;
    letter-spacing: -0.01em;
  }

  .brand {
    background: linear-gradient(90deg, var(--brand-orange), var(--brand-blue));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .tagline {
    margin: 0 0 18px;
    color: var(--text-secondary);
  }

  .primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 22px;
    border: 1px solid rgb(255 255 255 / 0.35);
    border-radius: 20px;
    background: linear-gradient(to bottom, #4a9bf0, var(--brand-blue));
    box-shadow: 0 4px 14px rgb(47 134 232 / 0.35);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
  }

  .primary:disabled {
    opacity: 0.6;
  }

  .notice {
    margin: 14px 0 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--chip-fill);
    color: var(--text-secondary);
    font-size: 12.5px;
  }

  h2 {
    align-self: flex-start;
    margin: 24px 0 8px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .empty {
    align-self: flex-start;
    margin: 0;
    color: var(--text-tertiary);
  }

  .recent {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .recent li {
    position: relative;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 40px 8px 10px;
    border: 0;
    border-radius: 12px;
    background: none;
    text-align: left;
  }

  .item:hover {
    background: var(--row-hover);
  }

  .glyph {
    display: grid;
    color: var(--text-secondary);
  }

  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .text strong {
    font-size: 13.5px;
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .when {
    flex: none;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .forget {
    position: absolute;
    top: 50%;
    right: 10px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 11px;
    background: none;
    color: var(--text-tertiary);
    opacity: 0;
    transform: translateY(-50%);
  }

  li:hover .forget,
  .forget:focus-visible {
    opacity: 1;
  }

  .forget:hover {
    background: var(--chip-fill);
    color: var(--text);
  }
</style>
