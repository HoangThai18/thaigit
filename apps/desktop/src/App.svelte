<!--
  Vỏ ứng dụng: chọn host (Tauri / cầu nối dev), mở repo (hộp thoại, danh sách gần đây, "Mở bằng…"), hỏi tin tưởng repo lạ, rồi
  vào cửa sổ repo. Mỗi cửa sổ có nhiều tab (như GitKraken), mỗi tab một repo; chỉ tab đang chọn được vẽ, repo ở tab nền vẫn
  sống. Cửa sổ chính nhớ các tab để lần sau mở lại.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { RecentRepo } from './lib/ipc/types.ts';
  import { detectOs, hasTauriInternals, resolveHost, type Host, type RepoPort } from './lib/platform/host.ts';
  import RepoWindow from './lib/shell/RepoWindow.svelte';
  import TabBar from './lib/shell/TabBar.svelte';
  import Toasts from './lib/shell/Toasts.svelte';
  import DialogHost from './lib/ui/DialogHost.svelte';
  import AiConsent from './lib/ai/AiConsent.svelte';
  import AiResultDialog from './lib/ai/AiResultDialog.svelte';
  import CreatePullRequestDialog from './lib/forge/CreatePullRequestDialog.svelte';
  import SettingsPanel from './lib/settings/SettingsPanel.svelte';
  import { telemetry } from './lib/stores/telemetry.svelte.ts';
  import MenuHost from './lib/ui/MenuHost.svelte';
  import UpdateBar from './lib/shell/UpdateBar.svelte';
  import {
    appReady,
    onUpdateAvailable,
    onUpdateProgress,
    updateCheck,
    updateInstall,
  } from './lib/ipc/update.ts';
  import { updates } from './lib/stores/update.svelte.ts';
  import { askpassReply, onAskpassClosed, onAskpassRequest } from './lib/ipc/askpass.ts';
  import { isMainWindow, newWindow } from './lib/ipc/os.ts';
  import { askpass } from './lib/stores/askpass.svelte.ts';
  import TrustPrompt from './lib/shell/TrustPrompt.svelte';
  import CrashPanel from './lib/shell/CrashPanel.svelte';
  import Welcome from './lib/shell/Welcome.svelte';
  import CloneDialog from './lib/shell/CloneDialog.svelte';
  import { dialogs, textValue } from './lib/stores/dialogs.svelte.ts';
  import { vi } from './lib/strings.vi.ts';
  import { app } from './lib/stores/app.svelte.ts';
  import { prefs } from './lib/stores/prefs.svelte.ts';
  import { RepoStore } from './lib/stores/repo.svelte.ts';
  import { menus, tidyMenu, type MenuItem } from './lib/stores/menus.svelte.ts';
  import { TabsStore, type TabItem } from './lib/stores/tabs.svelte.ts';
  import { toasts, type ToastAction } from './lib/stores/toasts.svelte.ts';
  import { theme } from './lib/theme/theme.svelte.ts';

  type View =
    | { kind: 'boot' }
    | { kind: 'welcome' }
    | { kind: 'trust'; port: RepoPort }
    | { kind: 'repo'; store: RepoStore };

  const tabs = new TabsStore<View>();
  tabs.add({ kind: 'boot' });
  const active = $derived(tabs.active);
  const activeId = $derived(tabs.activeId ?? -1);
  let busy = $state(false);
  let showClone = $state(false);
  /** Chạy ngoài Tauri và không có cầu nối dev: không có lõi Rust để mở repo. */
  let unavailable = $state<string | undefined>(undefined);
  /** Cửa sổ chính của app trên Tauri: nhớ các tab đang mở để lần sau mở lại. Bật sau khi đã mở lại xong. */
  let remembersTabs = $state(false);

  // Áp sáng/tối + kính lên <html> mỗi khi cài đặt (hoặc "giảm trong suốt" của OS) đổi.
  $effect(() => {
    theme.apply(prefs.value.scheme, prefs.value.glass);
  });

  // Nhớ repo của các tab (theo thứ tự) và tab đang chọn.
  $effect(() => {
    if (!remembersTabs) return;
    const repos = tabs.tabs.flatMap((tab) => (tab.view.kind === 'repo' ? [tab] : []));
    const openTabs = repos.map((tab) => (tab.view.kind === 'repo' ? tab.view.store.port.info.repoId : ''));
    const activeTab = Math.max(
      0,
      repos.findIndex((tab) => tab.id === tabs.activeId),
    );
    const saved = untrack(() => prefs.value);
    if (saved.activeTab !== activeTab || saved.openTabs.join('\n') !== openTabs.join('\n')) {
      untrack(() => prefs.update({ openTabs, activeTab }));
    }
  });

  /** Tên hiển thị trên thanh tab. */
  function tabItem(id: number, view: View): TabItem {
    switch (view.kind) {
      case 'repo':
        return { id, title: view.store.name, tooltip: view.store.port.info.root };
      case 'trust':
        return { id, title: folderName(view.port.info.root), tooltip: view.port.info.root };
      default:
        return { id, title: vi.tabs.welcomeTitle, tooltip: vi.tabs.welcomeTitle };
    }
  }

  const tabItems = $derived(tabs.tabs.map((tab) => tabItem(tab.id, tab.view)));

  function folderName(root: string): string {
    return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  }

  function newTab(): void {
    if (app.host === null) return;
    tabs.add({ kind: 'welcome' });
    void app.refreshRecent();
  }

  function newAppWindow(): void {
    newWindow().catch((error: unknown) => toasts.error(vi.welcome.newWindowFailed, error));
  }

  /** Đóng repo của tab (dừng watcher, tự fetch…) nếu có. */
  async function release(view: View | undefined): Promise<void> {
    if (view?.kind === 'repo') await view.store.dispose();
  }

  /** Đóng tab; tab cuối cùng thì chỉ quay về màn hình chào. */
  async function closeTab(id: number): Promise<void> {
    const tab = tabs.get(id);
    if (!tab) return;
    // Bỏ repo khỏi tab TRƯỚC khi dừng nó: nút bấm trễ (toast của repo này) thấy ngay tab không còn giữ repo đó.
    if (tabs.tabs.length === 1) {
      tabs.set(id, { kind: 'welcome' });
      void app.refreshRecent();
    } else {
      tabs.remove(id);
    }
    await release(tab.view);
  }

  async function closeOtherTabs(id: number): Promise<void> {
    for (const tab of [...tabs.tabs]) if (tab.id !== id) await closeTab(tab.id);
  }

  function tabMenu(id: number): MenuItem[] {
    const view = tabs.get(id)?.view;
    const root =
      view?.kind === 'repo' ? view.store.port.info.root : view?.kind === 'trust' ? view.port.info.root : null;
    return tidyMenu([
      {
        title: vi.tabs.closeTab,
        icon: 'x',
        shortcut: vi.tabs.closeTabShortcut,
        run: () => void closeTab(id),
      },
      tabs.tabs.length > 1 && { title: vi.tabs.closeOthers, run: () => void closeOtherTabs(id) },
      root !== null && { kind: 'separator' },
      root !== null && {
        title: vi.tabs.copyPath,
        icon: 'copy',
        run: () =>
          void navigator.clipboard
            .writeText(root)
            .catch((error: unknown) => toasts.error(vi.errors.unexpectedTitle, error)),
      },
    ]);
  }

  /**
   * Phím tắt của cửa sổ: Ctrl/⌘ + T tab mới, Ctrl/⌘ + W đóng tab, Ctrl + Tab / Ctrl + Shift + Tab chuyển tab, Ctrl/⌘ + 1…9
   * chọn tab, Ctrl/⌘ + Shift + N cửa sổ mới (chỉ trong app). Đang có hộp thoại / menu thì không đổi tab dưới chân nó.
   */
  function onwindowkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || dialogs.current !== null || menus.current !== null || app.host === null)
      return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const code = event.code;
    if (!event.shiftKey && code === 'KeyT') newTab();
    else if (!event.shiftKey && code === 'KeyW') void closeTab(activeId);
    else if (code === 'Tab' && event.ctrlKey) tabs.cycle(event.shiftKey ? -1 : 1);
    else if (!event.shiftKey && /^Digit[1-9]$/.test(code)) {
      const digit = Number(code.slice(5));
      tabs.activateIndex(digit === 9 ? -1 : digit - 1);
    } else if (event.shiftKey && code === 'KeyN' && hasTauriInternals()) newAppWindow();
    else return;
    event.preventDefault();
  }

  /** Lỗi không lường trước (exception, promise bị từ chối không ai bắt): chỉ hiện một thông báo thân thiện. */
  function reportUnexpected(error: unknown): void {
    toasts.error(vi.errors.unexpectedTitle, error, { tag: 'unexpected' });
  }

  onMount(() => {
    const onRejection = (event: PromiseRejectionEvent): void => {
      event.preventDefault();
      reportUnexpected(event.reason);
    };
    const onError = (event: ErrorEvent): void => {
      // Lỗi tải tài nguyên (ảnh đại diện…) không phải exception: bỏ qua.
      if (event.error === undefined && event.message === '') return;
      event.preventDefault();
      reportUnexpected(event.error ?? event.message);
    };
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    // macOS: thanh tiêu đề chồng (tauri.conf `titleBarStyle: Overlay`) nên chừa chỗ cho 3 nút đèn giao thông.
    document.documentElement.classList.toggle(
      'titlebar-overlay',
      hasTauriInternals() && detectOs() === 'mac',
    );
    const stopWatching = theme.watchSystem();
    app.newTab = newTab;
    void boot();
    if (hasTauriInternals()) {
      // Cập nhật tự động: Rust tự kiểm định kỳ và báo qua sự kiện; giao diện chỉ hiện + cài khi người dùng bấm.
      void updates
        .start({
          check: updateCheck,
          install: updateInstall,
          onAvailable: (handler) => onUpdateAvailable((event) => handler(event.update)),
          onProgress: onUpdateProgress,
        })
        .catch(() => undefined);
      // Hỏi tên đăng nhập / mật khẩu / passphrase trong app khi git/ssh cần (fetch / pull / push / clone).
      void askpass
        .start({ reply: askpassReply, onRequest: onAskpassRequest, onClosed: onAskpassClosed })
        .catch(() => undefined);
      void appReady().catch(() => undefined);
      // Thống kê ẩn danh: chỉ gửi khi người dùng đã bật (mặc định tắt).
      telemetry.start();
    }
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
      updates.stop();
      askpass.stop();
      telemetry.stop();
      stopWatching();
      app.newTab = null;
      for (const tab of tabs.tabs) void release(tab.view);
      prefs.flush();
    };
  });

  async function boot(): Promise<void> {
    const first = tabs.activeId ?? tabs.add({ kind: 'boot' });
    let host: Host;
    try {
      host = await resolveHost();
    } catch (error) {
      toasts.error(vi.welcome.openFailed, error);
      tabs.set(first, { kind: 'welcome' });
      return;
    }
    const hasCore = host.kind !== 'tauri' || hasTauriInternals();
    if (!hasCore) unavailable = vi.welcome.notInTauri;
    await app.init(host, hasCore);
    if (!hasCore) {
      tabs.set(first, { kind: 'welcome' });
      return;
    }
    const restoring = host.kind === 'tauri' && isMainWindow();
    try {
      const launched = await host.openLaunchRepo();
      if (launched) {
        await show(first, launched);
        // Mở bằng thư mục ("Mở bằng Thaigit"): vẫn mở lại các tab cũ, sau tab vừa mở.
        if (restoring) await restoreTabs(host, false);
        remembersTabs = restoring;
        return;
      }
    } catch (error) {
      toasts.error(vi.welcome.openFailed, error);
    }
    tabs.set(first, { kind: 'welcome' });
    if (restoring) await restoreTabs(host, true);
    remembersTabs = restoring;
  }

  /** Mở lại repo của các tab lần trước (cửa sổ chính). `intoFirst`: tab đầu dùng luôn tab chào đang có. */
  async function restoreTabs(host: Host, intoFirst: boolean): Promise<void> {
    const { openTabs, activeTab } = prefs.value;
    const welcome = intoFirst ? tabs.activeId : null;
    const keepActive = intoFirst ? null : tabs.activeId;
    let failed = 0;
    let wanted: number | null = null;
    for (const [index, id] of openTabs.entries()) {
      try {
        const port = await host.openRecent(id);
        if (tabs.find((view) => sameRepo(view, port))) continue;
        const tabId = index === 0 && welcome !== null ? welcome : tabs.add({ kind: 'boot' });
        await show(tabId, port);
        if (index === activeTab) wanted = tabId;
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) toasts.warning(vi.tabs.restoreFailed(failed));
    const target = keepActive ?? wanted;
    if (target !== null) tabs.activate(target);
  }

  function sameRepo(view: View, port: RepoPort): boolean {
    const id = port.info.repoId;
    return (
      (view.kind === 'repo' && view.store.port.info.repoId === id) ||
      (view.kind === 'trust' && view.port.info.repoId === id)
    );
  }

  /** Chạy một thao tác mở repo vào tab `tabId`: chặn bấm lặp, lỗi hiện thành toast (kèm nút `missing` khi thư mục không còn). */
  async function guarded(
    tabId: number,
    task: () => Promise<RepoPort | null>,
    options: { missing?: ToastAction } = {},
  ): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const port = await task();
      if (port) await show(tabId, port);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      toasts.error(vi.welcome.openFailed, error, {
        actions: code === 'not-found' && options.missing ? [options.missing] : [],
      });
    } finally {
      busy = false;
    }
  }

  async function show(tabId: number, port: RepoPort): Promise<void> {
    // Repo đã mở ở tab khác: chuyển sang tab đó, bỏ tab chào vừa dùng để mở.
    const existing = tabs.find((view) => sameRepo(view, port));
    if (existing && existing.id !== tabId) {
      const current = tabs.get(tabId)?.view.kind;
      if (current === 'welcome' || current === 'boot') tabs.remove(tabId);
      tabs.activate(existing.id);
      return;
    }
    if (port.info.trust === 'unknown') {
      const previous = tabs.get(tabId)?.view;
      tabs.set(tabId, { kind: 'trust', port });
      await release(previous);
      return;
    }
    await enter(tabId, port);
  }

  async function enter(tabId: number, port: RepoPort): Promise<void> {
    const previous = tabs.get(tabId)?.view;
    if (!previous) return;
    const store: RepoStore = new RepoStore(port, {
      // Chỉ tác động khi repo này vẫn nằm ở tab đó: nút bấm trễ trên toast của repo đã đóng không được hỏi tin tưởng lại rồi
      // đá văng repo khác (`trust` → `enter` thay luôn tab).
      onUntrusted: () => {
        const view = tabs.get(tabId)?.view;
        if (view?.kind === 'repo' && view.store === store) void trust(tabId, port);
      },
    });
    tabs.set(tabId, { kind: 'repo', store });
    // Dừng repo cũ của tab (cùng repo khi vừa tin tưởng) TRƯỚC khi bật watcher của repo mới: watcher theo id repo.
    await release(previous);
    void store.start();
  }

  async function trust(tabId: number, port: RepoPort): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const next = await port.trust();
      if (next.info.trust === 'unknown') {
        // Cấu hình đổi kể từ lúc hỏi: lõi Rust chỉ tin những gì người dùng đã thấy → hỏi lại với danh sách mới.
        toasts.warning(vi.trust.changed);
        const previous = tabs.get(tabId)?.view;
        tabs.set(tabId, { kind: 'trust', port: next });
        await release(previous);
        return;
      }
      await enter(tabId, next);
    } catch (error) {
      toasts.error(vi.trust.failed, error);
    } finally {
      busy = false;
    }
  }

  /** Nút × trên thanh công cụ của repo: đóng repo của tab (tab duy nhất thì về màn hình chào). */
  const closeRepo = (tabId: number): Promise<void> => closeTab(tabId);

  /** Tạo repo mới: chọn thư mục cha, đặt tên, `git init`, mở luôn. */
  async function createRepo(tabId: number): Promise<void> {
    const host = app.host;
    if (!host || busy) return;
    try {
      const folder = await host.pickFolder();
      if (!folder) return;
      const values = await dialogs.form({
        title: vi.welcome.initTitle,
        message: vi.welcome.initMessage(folder.path),
        fields: [{ kind: 'text', id: 'name', label: vi.welcome.initName, value: 'repo-moi' }],
        confirmTitle: vi.welcome.initConfirm,
        validate: (current) => {
          const name = textValue(current, 'name');
          return name === '' || name === '.' || name === '..' || /[/\\:*?"<>|]/.test(name)
            ? vi.welcome.cloneInvalidName
            : null;
        },
      });
      if (!values) return;
      await guarded(tabId, () => host.initRepo(folder, textValue(values, 'name')));
    } catch (error) {
      toasts.error(vi.welcome.initFailed, error);
    }
  }

  const openFolder = (tabId: number): Promise<void> =>
    guarded(tabId, () => app.host?.pickAndOpenRepo() ?? Promise.resolve(null));
  const openRecent = (tabId: number, repo: RecentRepo): Promise<void> =>
    guarded(tabId, () => app.host?.openRecent(repo.id) ?? Promise.resolve(null), {
      // Thư mục đã bị xoá/đổi tên: cho phép dọn khỏi danh sách ngay trong thông báo lỗi.
      missing: { title: vi.welcome.forgetMissing, run: () => void app.forgetRecent(repo.id) },
    });
</script>

<svelte:window onkeydown={onwindowkeydown} />

<div class="shell" class:tabbed={tabItems.length > 1}>
  {#if tabItems.length > 1}
    <TabBar
      items={tabItems}
      activeId={tabs.activeId}
      onactivate={(id) => tabs.activate(id)}
      onclose={(id) => void closeTab(id)}
      onnew={newTab}
      onmove={(id, index) => tabs.move(id, index)}
      menu={tabMenu}
    />
  {/if}
  <div class="tab-content">
    {#if active}
      {@const tabId = active.id}
      {@const view = active.view}
      {#if view.kind === 'repo'}
        {#key view.store}
          <!-- Lỗi khi vẽ giao diện của repo: không hiện exception, chỉ báo thân thiện và cho thử lại / về màn hình chính. -->
          <svelte:boundary onerror={(error) => reportUnexpected(error)}>
            <RepoWindow store={view.store} onclose={() => closeRepo(tabId)} />
            {#snippet failed(_error, reset)}
              <CrashPanel onretry={reset} onhome={() => void closeRepo(tabId)} />
            {/snippet}
          </svelte:boundary>
        {/key}
      {:else if view.kind === 'trust'}
        {@const port = view.port}
        <TrustPrompt
          name={folderName(port.info.root)}
          path={port.info.root}
          findings={port.info.findings}
          {busy}
          ontrust={() => trust(tabId, port)}
          oncancel={() => void closeTab(tabId)}
        />
      {:else if view.kind === 'welcome'}
        <Welcome
          recent={app.recent}
          opening={busy}
          {unavailable}
          onopen={() => openFolder(tabId)}
          onrecent={(repo) => openRecent(tabId, repo)}
          onforget={(repo) => app.forgetRecent(repo.id)}
          onclone={app.host?.kind === 'tauri' ? () => (showClone = true) : undefined}
          oninit={app.host?.kind === 'tauri' ? () => void createRepo(tabId) : undefined}
        />
        {#if showClone && app.host}
          <CloneDialog
            host={app.host}
            onclose={() => (showClone = false)}
            onopened={(port) => {
              showClone = false;
              void show(tabId, port);
            }}
          />
        {/if}
      {/if}
    {/if}
  </div>
</div>

<Toasts />
<SettingsPanel />
<AiResultDialog />
<DialogHost />
<CreatePullRequestDialog />
<AiConsent />
<MenuHost />
<UpdateBar />

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .tab-content {
    flex: 1;
    min-height: 0;
  }

  /* Thanh tab đã chừa chỗ cho nút đèn giao thông của macOS: phần dưới không chừa nữa. */
  .tabbed .tab-content {
    --titlebar-inset: 0px;
  }
</style>
