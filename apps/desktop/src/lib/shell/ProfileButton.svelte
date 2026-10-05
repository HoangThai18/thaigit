<!--
  Profile trên thanh công cụ (như GitKraken): avatar tên / email Git đang dùng để commit; bấm để xem, đổi tên & email, chọn
  tài khoản GitHub / GitLab cho repo, hoặc mở Cài đặt.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { editIdentity, loadIdentity, type GitIdentity } from '../actions/identity.ts';
  import { assignAccountForRepo } from '../forge/assignOwner.ts';
  import Avatar from '../inspector/Avatar.svelte';
  import { menus } from '../stores/menus.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import { settingsStore } from '../stores/settings.svelte.ts';
  import { vi } from '../strings.vi.ts';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  let identity = $state<GitIdentity>({ name: null, email: null });
  let button = $state<HTMLButtonElement | null>(null);

  async function refresh(): Promise<void> {
    try {
      identity = await loadIdentity(store);
    } catch {
      // Config unreadable: stay empty, the identity dialog still works.
    }
  }

  onMount(() => void refresh());

  function open(event: MouseEvent): void {
    if (!button) return;
    void refresh();
    menus.openBelow(
      button,
      [
        {
          kind: 'header',
          title: identity.name ? `${identity.name} <${identity.email ?? '?'}>` : vi.window.identityMissing,
        },
        {
          title: vi.window.identityEdit,
          icon: 'pencil',
          run: () =>
            void editIdentity(store, identity).then((saved) => {
              if (saved) void refresh();
            }),
        },
        { title: vi.window.identityAccount, icon: 'user', run: () => void assignAccountForRepo(store) },
        { kind: 'separator' },
        { title: vi.settings.open, icon: 'settings', run: () => settingsStore.open() },
      ],
      { focusFirst: event.detail === 0 },
    );
  }
</script>

<button
  type="button"
  class="profile"
  bind:this={button}
  aria-haspopup="menu"
  aria-label={vi.window.profile}
  title={identity.name ? `${identity.name} <${identity.email ?? ''}>` : vi.window.identityMissing}
  onclick={open}
>
  <Avatar name={identity.name ?? '?'} size={26} />
</button>

<style>
  .profile {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 15px;
    background: none;
    cursor: pointer;
  }

  .profile:hover {
    background: var(--row-hover);
  }

  .profile:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
