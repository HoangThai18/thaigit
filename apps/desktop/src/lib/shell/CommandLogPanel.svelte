<!--
  Nhật ký lệnh git của repo (port CommandLogSheet.swift): lệnh mới nhất ở trên, mã thoát, thời gian chạy, stderr khi lỗi.
  Đối số và stderr đã được che credential ngay khi ghi (CommandLog.record).
-->
<script lang="ts">
  import { commandLine, type GitCommandRecord } from '@thaigit/core';
  import { formatClock } from '../format/time.ts';
  import { vi } from '../strings.vi.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store: RepoStore;
    onclose: () => void;
  }

  let { store, onclose }: Props = $props();

  let records = $state.raw<readonly GitCommandRecord[]>([]);
  let closeButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    const log = store.commandLog;
    records = [...log.records].reverse();
    return log.subscribe(() => {
      records = [...log.records].reverse();
    });
  });

  $effect(() => {
    closeButton?.focus();
  });

  function onkeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    }
  }

  function copyAll(): void {
    const text = [...records]
      .reverse()
      .map(
        (record) =>
          `${commandLine(record)}  → ${record.cancelled ? vi.remote.commandLogCancelled : record.exitCode} (${record.durationMs} ms)`,
      )
      .join('\n');
    void store.copy(text, vi.remote.commandLogTitle);
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}>
  <div
    class="panel glass"
    role="dialog"
    aria-modal="true"
    aria-labelledby="command-log-title"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    {onkeydown}
  >
    <header>
      <Icon name="terminal" size={16} />
      <h2 id="command-log-title">{vi.remote.commandLogTitle}</h2>
      <span class="grow"></span>
      <button type="button" class="button" onclick={copyAll} disabled={records.length === 0}
        >{vi.remote.commandLogCopy}</button
      >
      <button type="button" class="button" bind:this={closeButton} onclick={onclose}
        >{vi.remote.commandLogClose}</button
      >
    </header>
    <div class="list">
      {#if records.length === 0}
        <p class="empty">{vi.remote.commandLogEmpty}</p>
      {:else}
        {#each records as record (record.id)}
          <div class="record" class:failed={record.exitCode !== 0 && !record.cancelled}>
            <div class="line">
              <span class="time">{formatClock(record.startedAt)}</span>
              <code class="command selectable"><bdi>{commandLine(record)}</bdi></code>
              <span class="meta">
                {record.cancelled ? vi.remote.commandLogCancelled : `exit ${record.exitCode}`} · {record.durationMs}
                ms
              </span>
            </div>
            {#if record.stderr.trim() !== '' && record.exitCode !== 0}
              <pre class="stderr selectable">{record.stderr.trim()}</pre>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 850;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.28);
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(860px, calc(100vw - 48px));
    height: min(560px, calc(100vh - 64px));
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 12px 14px;
    border-bottom: 1px solid var(--separator);
  }

  h2 {
    margin: 0;
    font-size: 14px;
  }

  .grow {
    flex: 1;
  }

  .button {
    padding: 4px 12px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 0;
  }

  .empty {
    margin: 0;
    padding: 30px;
    color: var(--text-tertiary);
    font-size: 13px;
    text-align: center;
  }

  .record {
    padding: 5px 14px;
    border-bottom: 1px solid var(--separator);
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }

  .time,
  .meta {
    flex: none;
    color: var(--text-tertiary);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .command {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .record.failed .command,
  .record.failed .meta {
    color: var(--danger);
  }

  .stderr {
    margin: 5px 0 2px;
    padding: 6px 8px;
    max-height: 140px;
    overflow: auto;
    border-radius: var(--radius-s);
    background: var(--surface-muted);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 11.5px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
