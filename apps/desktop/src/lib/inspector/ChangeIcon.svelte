<!-- Huy hiệu loại thay đổi file (thêm/sửa/xoá/đổi tên/xung đột), màu theo `changeTone` — như ChangeIcon của app Swift. -->
<script lang="ts">
  import type { ChangeKind } from '@thaigit/core';
  import { vi } from '../strings.vi.ts';
  import { changeTone } from './changes.ts';

  interface Props {
    kind: ChangeKind;
    size?: number;
  }

  let { kind, size = 15 }: Props = $props();

  const tone = $derived(changeTone(kind));
  const label = $derived(vi.inspector.changeKind[kind]);
</script>

<svg class="change tone-{tone}" width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label}>
  <title>{label}</title>
  {#if kind === 'added'}
    <rect x="1" y="1" width="14" height="14" rx="3.2" fill="currentColor" />
    <path d="M8 4.6v6.8M4.6 8h6.8" stroke="#fff" stroke-width="1.7" stroke-linecap="round" fill="none" />
  {:else if kind === 'untracked'}
    <rect
      x="1.8"
      y="1.8"
      width="12.4"
      height="12.4"
      rx="3"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-dasharray="2.4 1.8"
    />
    <path
      d="M8 4.8v6.4M4.8 8h6.4"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      fill="none"
    />
  {:else if kind === 'deleted'}
    <rect x="1" y="1" width="14" height="14" rx="3.2" fill="currentColor" />
    <path d="M4.6 8h6.8" stroke="#fff" stroke-width="1.7" stroke-linecap="round" fill="none" />
  {:else if kind === 'renamed' || kind === 'copied'}
    <rect x="1" y="1" width="14" height="14" rx="3.2" fill="currentColor" />
    <path
      d="M4.4 8h6.6M8.6 5.4L11.2 8 8.6 10.6"
      stroke="#fff"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if kind === 'conflicted'}
    <path
      d="M8 1.6l6.6 11.6H1.4z"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
    <path d="M8 6.2v3.2" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
    <circle cx="8" cy="11.4" r="0.9" fill="#fff" />
  {:else if kind === 'unknown'}
    <rect
      x="1.8"
      y="1.8"
      width="12.4"
      height="12.4"
      rx="3"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
    />
    <path
      d="M6.2 6.4a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      fill="none"
    />
    <circle cx="8" cy="11.7" r="0.8" fill="currentColor" />
  {:else}
    <circle cx="8" cy="8" r="7" fill="currentColor" />
    <path d="M5.2 10.8l.5-2.1 4.1-4.1 1.6 1.6-4.1 4.1z" fill="#fff" />
  {/if}
</svg>

<style>
  .change {
    flex: none;
    display: block;
  }
  .tone-add {
    color: var(--success);
  }
  .tone-modify {
    color: var(--warning);
  }
  .tone-delete {
    color: var(--danger);
  }
  .tone-rename {
    color: var(--brand-blue);
  }
  .tone-warning {
    color: var(--warning);
  }
  .tone-muted {
    color: var(--text-tertiary);
  }
</style>
