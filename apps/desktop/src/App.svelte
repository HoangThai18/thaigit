<!--
  Vỏ ứng dụng: chọn host (Tauri / cầu nối dev), mở repo (hộp thoại, danh sách gần đây, "Mở bằng…"), hỏi tin tưởng repo lạ, rồi
  vào cửa sổ repo. Mỗi webview hiện đúng một repo (Rust tạo cửa sổ riêng cho repo khác — 4b).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { RecentRepo } from './lib/ipc/types.ts';
  import { detectOs, hasTauriInternals, resolveHost, type Host, type RepoPort } from './lib/platform/host.ts';
  import RepoWindow from './lib/shell/RepoWindow.svelte';
  import Toasts from './lib/shell/Toasts.svelte';
  import DialogHost from './lib/ui/DialogHost.svelte';
  import MenuHost from './lib/ui/MenuHost.svelte';
  import TrustPrompt from './lib/shell/TrustPrompt.svelte';
  import Welcome from './lib/shell/Welcome.svelte';
  import { vi } from './lib/strings.vi.ts';
  import { app } from './lib/stores/app.svelte.ts';
  import { prefs } from './lib/stores/prefs.svelte.ts';
  import { RepoStore } from './lib/stores/repo.svelte.ts';
  import { toasts, type ToastAction } from './lib/stores/toasts.svelte.ts';
  import { theme } from './lib/theme/theme.svelte.ts';

  type View =
    | { kind: 'boot' }
    | { kind: 'welcome' }
    | { kind: 'trust'; port: RepoPort }
    | { kind: 'repo'; store: RepoStore };

  let view = $state.raw<View>({ kind: 'boot' });
  let busy = $state(false);
  /** Chạy ngoài Tauri và không có cầu nối dev: không có lõi Rust để mở repo. */
  let unavailable = $state<string | undefined>(undefined);

  // Áp sáng/tối + kính lên <html> mỗi khi cài đặt (hoặc "giảm trong suốt" của OS) đổi.
  $effect(() => {
    theme.apply(prefs.value.scheme, prefs.value.glass);
  });

  onMount(() => {
    // macOS: thanh tiêu đề chồng (tauri.conf `titleBarStyle: Overlay`) nên chừa chỗ cho 3 nút đèn giao thông.
    document.documentElement.classList.toggle(
      'titlebar-overlay',
      hasTauriInternals() && detectOs() === 'mac',
    );
    const stopWatching = theme.watchSystem();
    void boot();
    return () => {
      stopWatching();
      if (view.kind === 'repo') void view.store.dispose();
      prefs.flush();
    };
  });

  async function boot(): Promise<void> {
    let host: Host;
    try {
      host = await resolveHost();
    } catch (error) {
      toasts.error(vi.welcome.openFailed, error);
      view = { kind: 'welcome' };
      return;
    }
    const hasCore = host.kind !== 'tauri' || hasTauriInternals();
    if (!hasCore) unavailable = vi.welcome.notInTauri;
    await app.init(host, hasCore);
    if (!hasCore) {
      view = { kind: 'welcome' };
      return;
    }
    try {
      const launched = await host.openLaunchRepo();
      if (launched) {
        await show(launched);
        return;
      }
    } catch (error) {
      toasts.error(vi.welcome.openFailed, error);
    }
    view = { kind: 'welcome' };
  }

  /** Chạy một thao tác mở repo: chặn bấm lặp, lỗi hiện thành toast (kèm nút `missing` khi thư mục không còn). */
  async function guarded(
    task: () => Promise<RepoPort | null>,
    options: { missing?: ToastAction } = {},
  ): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const port = await task();
      if (port) await show(port);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      toasts.error(vi.welcome.openFailed, error, {
        actions: code === 'not-found' && options.missing ? [options.missing] : [],
      });
    } finally {
      busy = false;
    }
  }

  async function show(port: RepoPort): Promise<void> {
    if (port.info.trust === 'unknown') {
      view = { kind: 'trust', port };
      return;
    }
    await enter(port);
  }

  async function enter(port: RepoPort): Promise<void> {
    if (view.kind === 'repo') await view.store.dispose();
    const store: RepoStore = new RepoStore(port, {
      // Chỉ tác động khi repo này vẫn là repo đang mở: nút bấm trễ trên toast của repo đã đóng không được hỏi tin tưởng lại rồi
      // đá văng repo hiện tại (`trust` → `enter` thay luôn cửa sổ).
      onUntrusted: () => {
        if (view.kind === 'repo' && view.store === store) void trust(port);
      },
    });
    view = { kind: 'repo', store };
    void store.start();
  }

  async function trust(port: RepoPort): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const next = await port.trust();
      if (next.info.trust === 'unknown') {
        // Cấu hình đổi kể từ lúc hỏi: lõi Rust chỉ tin những gì người dùng đã thấy → hỏi lại với danh sách mới.
        toasts.warning(vi.trust.changed);
        if (view.kind === 'repo') await view.store.dispose();
        view = { kind: 'trust', port: next };
        return;
      }
      await enter(next);
    } catch (error) {
      toasts.error(vi.trust.failed, error);
    } finally {
      busy = false;
    }
  }

  async function close(): Promise<void> {
    if (view.kind === 'repo') await view.store.dispose();
    view = { kind: 'welcome' };
    void app.refreshRecent();
  }

  const openFolder = (): Promise<void> => guarded(() => app.host?.pickAndOpenRepo() ?? Promise.resolve(null));
  const openRecent = (repo: RecentRepo): Promise<void> =>
    guarded(() => app.host?.openRecent(repo.id) ?? Promise.resolve(null), {
      // Thư mục đã bị xoá/đổi tên: cho phép dọn khỏi danh sách ngay trong thông báo lỗi.
      missing: { title: vi.welcome.forgetMissing, run: () => void app.forgetRecent(repo.id) },
    });
</script>

{#if view.kind === 'repo'}
  {#key view.store}
    <RepoWindow store={view.store} onclose={close} />
  {/key}
{:else if view.kind === 'trust'}
  {@const port = view.port}
  <TrustPrompt
    name={port.info.root.split(/[\\/]/).filter(Boolean).pop() ?? port.info.root}
    path={port.info.root}
    findings={port.info.findings}
    {busy}
    ontrust={() => trust(port)}
    oncancel={() => (view = { kind: 'welcome' })}
  />
{:else if view.kind === 'welcome'}
  <Welcome
    recent={app.recent}
    opening={busy}
    {unavailable}
    onopen={openFolder}
    onrecent={openRecent}
    onforget={(repo) => app.forgetRecent(repo.id)}
  />
{/if}

<Toasts />
<DialogHost />
<MenuHost />
