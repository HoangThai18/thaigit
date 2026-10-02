<!-- Chồng thông báo nổi ở góc phải dưới (port ToastStack/ToastView): kính, nút hành động, "Xem đầy đủ" cho lỗi dài. -->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import { toasts, type Toast } from '../stores/toasts.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  let expanded = $state<Record<number, boolean>>({});

  const ICON: Record<Toast['style'], 'info' | 'check-circle' | 'warning' | 'x-circle'> = {
    info: 'info',
    success: 'check-circle',
    warning: 'warning',
    error: 'x-circle',
  };

  const isLong = (message: string): boolean => message.length > 220 || message.split('\n').length > 4;

  function run(toast: Toast, handler: () => void): void {
    toasts.dismiss(toast.id);
    handler();
  }
</script>

<div class="stack" aria-live="polite">
  {#each toasts.items as toast (toast.id)}
    <div class="toast glass {toast.style}" role={toast.style === 'error' ? 'alert' : 'status'}>
      <span class="glyph"><Icon name={ICON[toast.style]} size={18} /></span>
      <div class="content">
        <strong class="title">{toast.title}</strong>
        {#if toast.message}
          <pre class="message selectable" class:expanded={expanded[toast.id]}>{toast.message}</pre>
          {#if isLong(toast.message)}
            <button type="button" class="link" onclick={() => (expanded[toast.id] = !expanded[toast.id])}>
              {expanded[toast.id] ? vi.toast.collapse : vi.toast.expand}
            </button>
          {/if}
        {/if}
        {#if toast.actions.length > 0}
          <div class="actions">
            {#each toast.actions as action, index (index)}
              <button type="button" class="action" onclick={() => run(toast, action.run)}
                >{action.title}</button
              >
            {/each}
          </div>
        {/if}
      </div>
      <button
        type="button"
        class="close"
        title={vi.toast.dismiss}
        aria-label={vi.toast.dismiss}
        onclick={() => toasts.dismiss(toast.id)}
      >
        <Icon name="x" size={12} strokeWidth={2.4} />
      </button>
    </div>
  {/each}
</div>

<style>
  .stack {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(420px, calc(100vw - 32px));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    border-radius: 18px;
    pointer-events: auto;
    --tint: var(--info);
  }

  .toast.success {
    --tint: var(--success);
  }
  .toast.warning {
    --tint: var(--warning);
  }
  .toast.error {
    --tint: var(--danger);
  }

  .glyph {
    display: grid;
    flex: none;
    margin-top: 1px;
    color: var(--tint);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .title {
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .message {
    margin: 0;
    max-height: 4.8em;
    overflow: hidden;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.2;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .message.expanded {
    max-height: 40em;
    overflow-y: auto;
  }

  .link {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 12px;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .action {
    padding: 3px 12px;
    border: 1px solid var(--field-border);
    border-radius: 12px;
    background: var(--field-fill);
    font-size: 12px;
  }

  .close {
    display: grid;
    place-items: center;
    flex: none;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--text-secondary);
  }

  .close:hover {
    background: var(--row-hover);
  }
</style>
