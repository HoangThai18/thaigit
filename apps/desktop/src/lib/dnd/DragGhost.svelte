<!--
  Nhãn bay theo con trỏ khi đang kéo: tên nhánh / số file, và gợi ý thả vào đâu. Không bắt chuột (pointer-events: none) để
  `elementFromPoint` thấy đích bên dưới.
-->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';
  import { drag as defaultDrag, type DragStore } from './drag.svelte.ts';

  interface Props {
    store?: DragStore;
  }

  let { store = defaultDrag }: Props = $props();

  const active = $derived(store.active);
  const hint = $derived.by(() => {
    if (!active) return '';
    if (active.payload.kind === 'ref') return vi.dnd.hintRef;
    return active.payload.from === 'unstaged' ? vi.dnd.hintStage : vi.dnd.hintUnstage;
  });
</script>

{#if active}
  <div
    class="ghost"
    class:accepted={active.accepted}
    style:left="{active.x + 14}px"
    style:top="{active.y + 12}px"
  >
    <span class="label">
      <Icon
        name={active.payload.kind === 'ref'
          ? active.payload.ref.kind === 'tag'
            ? 'tag'
            : 'branch'
          : 'stage'}
        size={13}
      />
      <bdi>{active.payload.label}</bdi>
    </span>
    {#if !active.accepted}<span class="hint">{hint}</span>{/if}
  </div>
{/if}

<style>
  .ghost {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 320px;
    padding: 5px 9px;
    border-radius: var(--radius-s);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    font-size: 12px;
    pointer-events: none;
    opacity: 0.92;
  }

  .ghost.accepted {
    outline: 2px solid var(--accent);
  }

  .label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint {
    color: var(--text-tertiary);
    font-size: 11px;
  }
</style>
