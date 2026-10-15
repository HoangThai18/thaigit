<!--
  Home screen, laid out like the Swift 1.x app: on the left the logo and the big actions (open, clone, create, settings,
  accounts), on the right a "Recent" panel. Also hosts the one-time anonymous-stats question (off unless the user agrees).
-->
<script lang="ts">
  import { formatRelative } from '../format/time.ts';
  import type { RecentRepo } from '../ipc/types.ts';
  import logo from '../assets/logo.png';
  import { hasTauriInternals } from '../platform/host.ts';
  import { vi } from '../strings.vi.ts';
  import { feedback } from '../stores/feedback.svelte.ts';
  import { settingsStore } from '../stores/settings.svelte.ts';
  import { telemetry } from '../stores/telemetry.svelte.ts';
  import { updates } from '../stores/update.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import type { IconName } from '../ui/icons.ts';

  interface Props {
    recent: readonly RecentRepo[];
    opening: boolean;
    /** Message when no repo could be opened (e.g. running outside Tauri); when present the open button is disabled. */
    unavailable?: string;
    onopen: () => void;
    onrecent: (repo: RecentRepo) => void;
    onforget: (repo: RecentRepo) => void;
    /** Clone / create a new repo (absent when running outside the app). */
    onclone?: () => void;
    oninit?: () => void;
  }

  let { recent, opening, unavailable, onopen, onrecent, onforget, onclone, oninit }: Props = $props();

  const version = import.meta.env.VITE_APP_VERSION ?? '';
  const inApp = hasTauriInternals();

  interface Action {
    title: string;
    subtitle: string;
    icon: IconName;
    tint: string;
    shortcut: string;
    disabled: boolean;
    run: () => void;
  }

  const actions = $derived(
    [
      {
        title: opening ? vi.welcome.opening : vi.welcome.openTitle,
        subtitle: vi.welcome.openSub,
        icon: 'folder-open',
        tint: 'var(--brand-blue)',
        shortcut: '',
        disabled: opening || unavailable !== undefined,
        run: onopen,
      },
      onclone && {
        title: vi.welcome.cloneTitle,
        subtitle: vi.welcome.cloneSub,
        icon: 'download',
        tint: 'var(--success)',
        shortcut: '',
        disabled: opening,
        run: onclone,
      },
      oninit && {
        title: vi.welcome.initTitle,
        subtitle: vi.welcome.initSub,
        icon: 'plus',
        tint: 'var(--brand-orange)',
        shortcut: '',
        disabled: opening,
        run: oninit,
      },
      {
        title: vi.settings.title,
        subtitle: vi.welcome.settingsSub,
        icon: 'settings',
        tint: 'var(--text-secondary)',
        shortcut: '',
        disabled: false,
        run: () => settingsStore.open(),
      },
      inApp && {
        title: vi.welcome.accounts,
        subtitle: vi.welcome.accountsSub,
        icon: 'user',
        tint: '#af52de',
        shortcut: '',
        disabled: false,
        run: () => settingsStore.open('accounts'),
      },
    ].filter((action): action is Action => Boolean(action)),
  );
</script>

<main class="welcome" data-tauri-drag-region>
  <section class="left">
    <header class="brand-row">
      <img class="logo" src={logo} alt="" width="72" height="72" />
      <div>
        <h1><span class="brand">{vi.appName}</span></h1>
        <p class="tagline">{vi.welcome.shortTagline}</p>
      </div>
    </header>

    <div class="actions">
      {#each actions as action, index (index)}
        <button
          type="button"
          class="action glass"
          style:--tint={action.tint}
          disabled={action.disabled}
          onclick={action.run}
        >
          <span class="action-icon"><Icon name={action.icon} size={22} /></span>
          <span class="action-text">
            <strong>{action.title}</strong>
            <span>{action.subtitle}</span>
          </span>
          {#if action.shortcut}<kbd>{action.shortcut}</kbd>{/if}
        </button>
      {/each}
    </div>

    {#if unavailable}
      <p class="notice" role="status">{unavailable}</p>
    {/if}

    {#if inApp && telemetry.supported && !telemetry.saved.asked}
      <div class="ask" role="region" aria-label={vi.settings.askTitle}>
        <strong>{vi.settings.askTitle}</strong>
        <p>{vi.settings.askText}</p>
        <div class="ask-buttons">
          <button type="button" class="ask-no" onclick={() => telemetry.dismiss()}>{vi.settings.askNo}</button
          >
          <button type="button" class="ask-yes" onclick={() => telemetry.setEnabled(true)}
            >{vi.settings.askYes}</button
          >
        </div>
      </div>
    {/if}

    <span class="grow"></span>

    <footer class="footer">
      {#if version}<span>{vi.appName} {version}</span>{/if}
      <button type="button" class="link" onclick={() => feedback.open()}>{vi.feedback.title}</button>
      {#if inApp}
        {#if updates.available}
          <button type="button" class="link" onclick={() => void updates.install()}>
            {vi.update.installMenu(updates.available.version)}
          </button>
        {:else}
          <button
            type="button"
            class="link"
            disabled={updates.checking || updates.installing}
            onclick={() => void updates.check(version)}>{vi.update.checkNow}</button
          >
        {/if}
      {/if}
    </footer>
  </section>

  <section class="recent-panel glass">
    <h2>{vi.welcome.recentTitle}</h2>
    {#if recent.length === 0}
      <div class="empty">
        <Icon name="history" size={34} />
        <strong>{vi.welcome.recentEmptyTitle}</strong>
        <span>{vi.welcome.recentEmptySub}</span>
      </div>
    {:else}
      <ul class="recent">
        {#each recent as repo, index (index)}
          <li>
            <button
              type="button"
              class="item"
              title={repo.path}
              disabled={opening}
              onclick={() => onrecent(repo)}
            >
              <span class="glyph"><Icon name="folder" size={20} /></span>
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
    display: flex;
    gap: 20px;
    height: 100%;
    padding: 20px 20px 20px 0;
    overflow: hidden;
  }

  .left {
    display: flex;
    flex-direction: column;
    flex: none;
    gap: 22px;
    width: 420px;
    max-width: 45%;
    padding: 16px 0 16px 36px;
    overflow-y: auto;
  }

  .brand-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .logo {
    flex: none;
    filter: drop-shadow(0 6px 14px rgb(47 134 232 / 0.25));
  }

  h1 {
    margin: 0;
    font-size: 34px;
    letter-spacing: -0.01em;
  }

  .brand {
    background: linear-gradient(90deg, var(--brand-orange), var(--brand-blue));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .tagline {
    margin: 2px 0 0;
    color: var(--text-secondary);
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .action {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    border-radius: 16px;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .action:hover:not(:disabled) {
    background: color-mix(in srgb, var(--tint) 18%, var(--glass-fill));
  }

  .action:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .action:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .action-icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    color: var(--tint);
  }

  .action-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 2px;
    min-width: 0;
  }

  .action-text strong {
    font-size: 14px;
    font-weight: 600;
  }

  .action-text span {
    color: var(--text-secondary);
    font-size: 12px;
  }

  kbd {
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .notice {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--chip-fill);
    color: var(--text-secondary);
    font-size: 12.5px;
  }

  .ask {
    padding: 12px 14px;
    border: 1px solid var(--separator);
    border-radius: var(--radius-m);
    background: var(--field-fill);
    font-size: 12.5px;
  }

  .ask p {
    margin: 4px 0 10px;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .ask-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .ask-no,
  .ask-yes {
    padding: 4px 12px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .ask-yes {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .grow {
    flex: 1;
  }

  .footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .link:disabled {
    color: var(--text-tertiary);
    cursor: default;
  }

  .recent-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    border-radius: 24px;
    overflow: hidden;
  }

  h2 {
    margin: 0;
    padding: 24px 24px 10px;
    font-size: 15px;
    font-weight: 600;
  }

  .empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: var(--text-tertiary);
  }

  .empty strong {
    color: var(--text-secondary);
    font-size: 15px;
  }

  .recent {
    flex: 1;
    margin: 0;
    padding: 0 12px 12px;
    overflow-y: auto;
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
    padding: 9px 44px 9px 12px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .item:hover {
    background: var(--row-hover);
  }

  .glyph {
    display: grid;
    color: var(--accent);
  }

  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .text strong {
    font-size: 13.5px;
    font-weight: 600;
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
    right: 12px;
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

  @media (max-width: 760px) {
    .welcome {
      flex-direction: column;
      padding: 16px;
      overflow-y: auto;
    }

    .left {
      width: auto;
      max-width: none;
      padding: 0;
      overflow: visible;
    }

    .recent-panel {
      min-height: 280px;
    }
  }
</style>
