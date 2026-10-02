<!--
  Hỏi tin tưởng repo lạ (tối giản, 4a): repo có khoá cấu hình / hook có thể chạy lệnh. Chưa có lệnh git nào chạy cho tới khi người dùng
  chọn. "Mở ở chế độ hạn chế" + nhãn trên thanh công cụ thuộc 4b.
-->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    name: string;
    path: string;
    findings: readonly string[];
    busy: boolean;
    ontrust: () => void;
    oncancel: () => void;
  }

  let { name, path, findings, busy, ontrust, oncancel }: Props = $props();
</script>

<main class="trust" data-tauri-drag-region>
  <div class="card glass" role="alertdialog" aria-labelledby="trust-title" aria-describedby="trust-lead">
    <span class="shield"><Icon name="shield" size={34} strokeWidth={1.6} /></span>
    <h1 id="trust-title">{vi.trust.title}</h1>
    <p class="repo"><strong>{name}</strong> <span class="path selectable">{path}</span></p>
    <p id="trust-lead" class="lead">{vi.trust.lead}</p>

    {#if findings.length > 0}
      <h2>{vi.trust.findings}</h2>
      <ul class="findings selectable">
        {#each findings as finding (finding)}
          <li>{finding}</li>
        {/each}
      </ul>
    {/if}

    <div class="actions">
      <button type="button" class="secondary" disabled={busy} onclick={oncancel}>{vi.trust.cancel}</button>
      <button type="button" class="primary" disabled={busy} onclick={ontrust}>{vi.trust.trust}</button>
    </div>
  </div>
</main>

<style>
  .trust {
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

  .shield {
    display: grid;
    color: var(--warning);
  }

  h1 {
    margin: 8px 0 6px;
    font-size: 20px;
  }

  .repo {
    margin: 0 0 10px;
    max-width: 100%;
  }

  .path {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .lead {
    margin: 0 0 14px;
    color: var(--text-secondary);
  }

  h2 {
    align-self: flex-start;
    margin: 0 0 6px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .findings {
    align-self: stretch;
    margin: 0 0 16px;
    padding: 8px 12px 8px 28px;
    border-radius: 10px;
    background: var(--chip-fill);
    font-family: var(--font-mono);
    font-size: 11.5px;
    text-align: left;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: 10px;
  }

  .primary,
  .secondary {
    padding: 8px 20px;
    border-radius: 18px;
    font-size: 13.5px;
    font-weight: 600;
  }

  .primary {
    border: 1px solid rgb(255 255 255 / 0.35);
    background: linear-gradient(to bottom, #4a9bf0, var(--brand-blue));
    color: #fff;
  }

  .secondary {
    border: 1px solid var(--field-border);
    background: var(--field-fill);
  }

  button:disabled {
    opacity: 0.6;
  }
</style>
