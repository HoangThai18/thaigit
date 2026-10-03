<!--
  Clone repository: dán địa chỉ (hiện host / đường dẫn đã nhận ra, chặn transport chạy lệnh, cảnh báo URL kèm token), chọn thư
  mục đặt repo, tên thư mục; trong lúc clone hiện dòng tiến độ của git và cho Huỷ. Xong thì mở repo vừa clone.
-->
<script lang="ts">
  import type { PickedFolder } from '../ipc/types.ts';
  import type { Host, RepoPort } from '../platform/host.ts';
  import { vi } from '../strings.vi.ts';
  import { toasts } from '../stores/toasts.svelte.ts';
  import { checkCloneUrl } from './cloneUrl.ts';

  interface Props {
    host: Host;
    onopened: (port: RepoPort) => void;
    onclose: () => void;
  }

  let { host, onopened, onclose }: Props = $props();

  let url = $state('');
  let folder = $state.raw<PickedFolder | null>(null);
  let name = $state('');
  let nameEdited = $state(false);
  let running = $state(false);
  let progress = $state('');
  let controller: AbortController | null = null;
  let urlInput = $state<HTMLInputElement | null>(null);

  const check = $derived(checkCloneUrl(url));
  const validName = $derived(
    name.trim() !== '' &&
      name.trim() !== '.' &&
      name.trim() !== '..' &&
      name.trim().toLowerCase() !== '.git' &&
      [...name].length <= 255 &&
      !/[/\\:*?"<>|\0-\x1f]/.test(name),
  );
  const canStart = $derived(check.ok && folder !== null && validName && !running);

  $effect(() => {
    urlInput?.focus();
  });

  // Tên thư mục đi theo URL cho tới khi người dùng tự sửa.
  $effect(() => {
    if (!nameEdited && check.ok) name = check.defaultName;
  });

  async function pick(): Promise<void> {
    try {
      const picked = await host.pickFolder();
      if (picked) folder = picked;
    } catch (error) {
      toasts.error(vi.welcome.cloneFailed, error);
    }
  }

  async function start(): Promise<void> {
    if (!canStart || folder === null) return;
    running = true;
    progress = vi.welcome.cloneRunning;
    controller = new AbortController();
    try {
      const port = await host.cloneRepo(url.trim(), folder, name.trim(), {
        signal: controller.signal,
        onProgress: (line) => {
          const text = line.trim();
          if (text !== '') progress = text;
        },
      });
      onopened(port);
    } catch (error) {
      if (!controller.signal.aborted) toasts.error(vi.welcome.cloneFailed, error);
    } finally {
      running = false;
      controller = null;
    }
  }

  function cancel(): void {
    if (running) controller?.abort();
    else onclose();
  }

  function onkeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      void start();
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={() => !running && onclose()}>
  <div
    class="dialog glass"
    role="dialog"
    aria-modal="true"
    aria-labelledby="clone-title"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    {onkeydown}
  >
    <h2 id="clone-title">{vi.welcome.cloneTitle}</h2>
    <label class="field">
      <span class="label">{vi.welcome.cloneUrl}</span>
      <input
        type="text"
        bind:this={urlInput}
        bind:value={url}
        placeholder={vi.welcome.cloneUrlPlaceholder}
        spellcheck="false"
        autocomplete="off"
        disabled={running}
      />
    </label>
    {#if url.trim() !== ''}
      {#if check.ok}
        <p class="note"><bdi>{vi.welcome.cloneHost(check.host, check.path)}</bdi></p>
        {#if check.hasCredentials}
          <p class="warning">{vi.welcome.cloneCredentials}</p>
        {/if}
      {:else}
        <p class="error">
          {check.reason === 'dangerous' ? vi.welcome.cloneDangerous : vi.welcome.cloneInvalid}
        </p>
      {/if}
    {/if}

    <div class="field">
      <span class="label">{vi.welcome.cloneFolder}</span>
      <div class="folder">
        <span class="path" title={folder?.path ?? ''}
          ><bdi>{folder?.path ?? vi.welcome.cloneFolderNone}</bdi></span
        >
        <button type="button" class="button" disabled={running} onclick={pick}
          >{vi.welcome.cloneFolderPick}</button
        >
      </div>
    </div>

    <label class="field">
      <span class="label">{vi.welcome.cloneName}</span>
      <input
        type="text"
        value={name}
        spellcheck="false"
        autocomplete="off"
        disabled={running}
        oninput={(event) => {
          name = event.currentTarget.value;
          nameEdited = true;
        }}
      />
    </label>
    {#if name !== '' && !validName}
      <p class="error">{vi.welcome.cloneInvalidName}</p>
    {/if}

    {#if running}
      <p class="progress" aria-live="polite"><bdi>{progress}</bdi></p>
    {/if}

    <div class="buttons">
      <button type="button" class="button" onclick={cancel}
        >{running ? vi.welcome.cloneCancel : vi.welcome.cloneClose}</button
      >
      <button type="button" class="button primary" disabled={!canStart} onclick={() => void start()}
        >{vi.welcome.cloneStart}</button
      >
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.28);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(520px, calc(100vw - 48px));
    padding: 20px 22px 16px;
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
    text-align: left;
  }

  h2 {
    margin: 0 0 4px;
    font-size: 15px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .label {
    color: var(--text-secondary);
    font-size: 12px;
  }

  input {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 9px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }

  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .folder {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note,
  .warning,
  .error,
  .progress {
    margin: -4px 0 0;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .note {
    color: var(--text-tertiary);
  }

  .warning {
    color: var(--warning);
  }

  .error {
    color: var(--danger);
  }

  .progress {
    margin-top: 2px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }

  .button {
    padding: 6px 14px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .button.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
