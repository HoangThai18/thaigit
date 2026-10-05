<!--
  Panel terminal dưới graph / diff (như GitKraken, như `TerminalPanel.swift` của app Swift): thanh tab, nút thêm tab, nút ẩn,
  kéo mép trên để đổi chiều cao. Mỗi tab giữ một xterm + một shell của máy chạy ở thư mục repo; ẩn panel không dừng shell,
  đóng tab / đóng repo thì dừng.
-->
<script lang="ts">
  import { FitAddon } from '@xterm/addon-fit';
  import { type ITheme, Terminal } from '@xterm/xterm';
  import '@xterm/xterm/css/xterm.css';
  import type { Attachment } from 'svelte/attachments';
  import { friendlyError } from '../errors/friendly.ts';
  import { terminalClose, terminalOpen, terminalResize, terminalWrite } from '../ipc/terminal.ts';
  import { hasTauriInternals } from '../platform/host.ts';
  import { vi } from '../strings.vi.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import { theme } from '../theme/theme.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import type { TerminalDock, TerminalTab } from './dock.svelte.ts';

  interface Props {
    store: RepoStore;
    dock: TerminalDock;
  }

  let { store, dock }: Props = $props();

  /** Terminal colours taken from the UI theme tokens (light / dark) so they blend with the rest of the window. */
  function palette(): ITheme {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
    return {
      background: token('--surface', '#ffffff'),
      foreground: token('--text', '#1d2330'),
      cursor: token('--accent', '#2f86e8'),
      selectionBackground: token('--selection', 'rgba(47, 134, 232, 0.16)'),
    };
  }

  /** The xterm of each tab (keyed by `key`) — re-themed with the UI, focused when a tab is picked or the panel is shown. */
  const terminals = new Map<number, Terminal>();

  $effect(() => {
    void theme.version;
    const colors = palette();
    for (const term of terminals.values()) term.options.theme = colors;
  });

  $effect(() => {
    const key = dock.selected;
    if (!dock.visible || key === null) return;
    // Only focusable once the frame is actually displayed.
    requestAnimationFrame(() => terminals.get(key)?.focus());
  });

  /** Attach an xterm + shell to a tab; detaching (the tab was closed / the panel was cancelled) stops the shell. */
  function session(tab: TerminalTab): Attachment<HTMLElement> {
    return (node) => {
      const term = new Terminal({
        fontFamily:
          getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
        fontSize: 12,
        cursorBlink: true,
        scrollback: 5000,
        theme: palette(),
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(node);
      terminals.set(tab.key, term);
      const refit = (): void => {
        if (node.clientWidth > 0 && node.clientHeight > 0) fit.fit();
      };
      refit();

      let id: string | null = null;
      let disposed = false;
      // Ctrl+` hides the panel; Ctrl+C while text is selected copies (does not send ^C); Ctrl+V lets the browser paste.
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey) || event.altKey) return true;
        if (event.code === 'Backquote') return false;
        if (event.code === 'KeyC' && (event.shiftKey || term.hasSelection())) {
          void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined);
          term.clearSelection();
          event.preventDefault();
          return false;
        }
        return event.code !== 'KeyV';
      });

      if (hasTauriInternals()) {
        terminalOpen(store.port.info.repoId, term.cols, term.rows, {
          ondata: (bytes) => term.write(bytes),
          onexit: () => {
            if (!disposed) dock.close(tab.key);
          },
        })
          .then((opened) => {
            if (disposed) void terminalClose(opened).catch(() => undefined);
            else id = opened;
          })
          .catch((error: unknown) => term.writeln(friendlyError(error)));
      } else {
        term.writeln(vi.terminal.unavailable);
      }
      const input = term.onData((data) => {
        if (id !== null) void terminalWrite(id, data).catch(() => undefined);
      });
      const resized = term.onResize(({ cols, rows }) => {
        if (id !== null) void terminalResize(id, cols, rows).catch(() => undefined);
      });
      const titled = term.onTitleChange((title) => dock.rename(tab.key, title));
      const observer = new ResizeObserver(refit);
      observer.observe(node);

      return () => {
        disposed = true;
        observer.disconnect();
        input.dispose();
        resized.dispose();
        titled.dispose();
        terminals.delete(tab.key);
        if (id !== null) void terminalClose(id).catch(() => undefined);
        term.dispose();
      };
    };
  }

  // Drag the top edge to change the height.
  let dragFrom: { y: number; height: number } | null = null;

  function onhandledown(event: PointerEvent): void {
    dragFrom = { y: event.clientY, height: dock.height };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onhandlemove(event: PointerEvent): void {
    if (dragFrom) dock.resize(dragFrom.height - (event.clientY - dragFrom.y));
  }
</script>

<section
  class="terminal"
  class:hidden={!dock.visible}
  style:height="{dock.height}px"
  aria-label={vi.terminal.title}
>
  <div
    class="handle"
    role="separator"
    aria-orientation="horizontal"
    title={vi.terminal.resize}
    onpointerdown={onhandledown}
    onpointermove={onhandlemove}
    onpointerup={() => (dragFrom = null)}
    onpointercancel={() => (dragFrom = null)}
  ></div>
  <header>
    <span class="icon"><Icon name="terminal" size={15} /></span>
    {#each dock.tabs as tab (tab.key)}
      <span class="chip" class:selected={tab.key === dock.selected}>
        <button type="button" class="chip-title" onclick={() => (dock.selected = tab.key)}>{tab.title}</button
        >
        <button
          type="button"
          class="chip-close"
          title={vi.terminal.closeTab}
          aria-label={vi.terminal.closeTab}
          onclick={() => dock.close(tab.key)}
        >
          <Icon name="x" size={11} />
        </button>
      </span>
    {/each}
    <button
      type="button"
      class="tool"
      title={vi.terminal.newTab}
      aria-label={vi.terminal.newTab}
      onclick={() => dock.add()}
    >
      <Icon name="plus" size={14} />
    </button>
    <span class="grow"></span>
    <button
      type="button"
      class="tool"
      title={vi.terminal.hide}
      aria-label={vi.terminal.hide}
      onclick={() => (dock.visible = false)}
    >
      <Icon name="chevron-down" size={14} />
    </button>
  </header>
  <div class="screens">
    {#each dock.tabs as tab (tab.key)}
      <div class="screen" class:active={tab.key === dock.selected} {@attach session(tab)}></div>
    {/each}
  </div>
</section>

<style>
  .terminal {
    display: flex;
    flex-direction: column;
    flex: none;
    min-height: 0;
    border-top: 1px solid var(--separator);
    background: var(--surface);
  }

  .terminal.hidden {
    display: none;
  }

  .handle {
    flex: none;
    height: 5px;
    margin-top: -3px;
    cursor: row-resize;
  }

  header {
    display: flex;
    align-items: center;
    flex: none;
    gap: 4px;
    padding: 2px 10px 4px;
    border-bottom: 1px solid var(--separator);
  }

  .icon {
    display: inline-flex;
    margin-right: 4px;
    color: var(--text-secondary);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px 0 8px;
    border-radius: 6px;
  }

  .chip.selected {
    background: var(--chip-fill);
  }

  .chip-title {
    max-width: 220px;
    overflow: hidden;
    padding: 3px 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .chip-close,
  .tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .chip-close {
    opacity: 0;
  }

  .chip.selected .chip-close,
  .chip:hover .chip-close {
    opacity: 1;
  }

  .chip-close:hover,
  .tool:hover {
    background: var(--row-hover);
    color: var(--text);
  }

  .grow {
    flex: 1;
  }

  .screens {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .screen {
    position: absolute;
    inset: 4px 0 0 8px;
    visibility: hidden;
  }

  .screen.active {
    visibility: visible;
  }
</style>
