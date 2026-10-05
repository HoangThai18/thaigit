<!--
  Mục "Khoá SSH" trong Cài đặt: khoá SSH riêng của Thaigit (như agent của 1Password). Khoá bí mật do Rust giữ trong kho bí
  mật của hệ điều hành — webview chỉ thấy tên, khoá công khai và dấu vân tay.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { SshKeyInfo } from '@thaigit/contracts';
  import { openUrl } from '../ipc/os.ts';
  import { showBidi } from '../format/bidi.ts';
  import { vi } from '../strings.vi.ts';
  import { accounts as globalAccounts, type AccountsStore } from '../stores/accounts.svelte.ts';
  import { dialogs, textValue } from '../stores/dialogs.svelte.ts';
  import { sshKeys as globalSshKeys, type SshKeysStore } from '../stores/sshKeys.svelte.ts';
  import { toasts } from '../stores/toasts.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store?: SshKeysStore;
    accountsStore?: AccountsStore;
    copy?: (text: string) => Promise<void>;
  }

  let {
    store = globalSshKeys,
    accountsStore = globalAccounts,
    copy = (text) => navigator.clipboard.writeText(text),
  }: Props = $props();

  const text = vi.ssh;

  /** Hosts offered for the connection check: github.com, gitlab.com plus the hosts of the added GitHub / GitLab accounts. */
  const testHosts = $derived.by(() => {
    const hosts = ['github.com', 'gitlab.com'];
    for (const account of accountsStore.view.accounts) {
      if (account.provider !== 'bitbucket' && !hosts.includes(account.host)) hosts.push(account.host);
    }
    return hosts;
  });

  /** Accounts that can receive an uploaded key (GitHub / GitLab with a token). */
  const uploadTargets = $derived(
    accountsStore.view.accounts.filter((account) => account.provider !== 'bitbucket' && account.hasToken),
  );

  onMount(() => {
    void store.refresh();
  });

  async function generate(): Promise<void> {
    const values = await dialogs.form({
      title: text.generateTitle,
      message: text.generateMessage,
      fields: [
        {
          kind: 'text',
          id: 'name',
          label: text.namePlaceholder,
          value: '',
          placeholder: text.namePlaceholder,
        },
      ],
      confirmTitle: text.generate,
      validate: (current) => (textValue(current, 'name') === '' ? text.namePlaceholder : null),
    });
    if (values === null) return;
    const name = textValue(values, 'name');
    if (await store.generate(name)) toasts.success(text.generatedToast(name));
  }

  async function importKey(): Promise<void> {
    if (await store.importKey()) toasts.success(text.importedToast);
  }

  async function copyKey(key: SshKeyInfo): Promise<void> {
    try {
      await copy(key.publicKey);
      toasts.success(text.copiedToast);
    } catch {
      toasts.error(vi.errors.friendly.unexpected);
    }
  }

  async function rename(key: SshKeyInfo): Promise<void> {
    const values = await dialogs.form({
      title: text.renameTitle,
      fields: [{ kind: 'text', id: 'name', label: text.namePlaceholder, value: key.name }],
      confirmTitle: text.rename,
      validate: (current) => (textValue(current, 'name') === '' ? text.namePlaceholder : null),
    });
    if (values !== null) await store.rename(key.id, textValue(values, 'name'));
  }

  async function remove(key: SshKeyInfo): Promise<void> {
    const ok = await dialogs.confirm({
      title: text.remove,
      message: text.removeConfirm(key.name),
      confirmTitle: text.remove,
      destructive: true,
    });
    if (ok && (await store.remove(key.id))) toasts.info(text.removedToast(key.name));
  }

  async function upload(key: SshKeyInfo, host: string, login: string): Promise<void> {
    const result = await store.upload(key.id, host, login);
    if (result === null) return;
    if (result.outcome === 'added') toasts.success(text.uploadedToast(host));
    else if (result.outcome === 'alreadyExists') toasts.info(text.existsToast(host));
    else {
      await copy(key.publicKey).catch(() => undefined);
      void openUrl(result.page, true);
      toasts.info(text.missingScopeToast(host));
    }
  }

  function created(date: string): string {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? '' : text.created(parsed.toLocaleDateString());
  }
</script>

<section class="ssh">
  <h3>{text.title}</h3>
  <p class="help">{text.help}</p>

  {#each store.view.keys as key, index (index)}
    <div class="key">
      <div class="line">
        <Icon name="key" size={14} />
        <span class="name"><bdi>{showBidi(key.name)}</bdi></span>
        <span class="badge">{key.keyType}</span>
        {#if key.encrypted}
          <span class="badge" title={text.encryptedHelp}>{text.encrypted}</span>
        {/if}
        <span class="spacer"></span>
        <button type="button" class="link" onclick={() => void copyKey(key)}>{text.copy}</button>
        <button type="button" class="link" onclick={() => void rename(key)}>{text.rename}</button>
        <button type="button" class="link danger" onclick={() => void remove(key)}>{text.remove}</button>
      </div>
      <div class="sub mono">{key.fingerprint}</div>
      <div class="sub">{created(key.createdAt)}</div>
      {#if uploadTargets.length > 0}
        <div class="uploads">
          {#each uploadTargets as account, targetIndex (targetIndex)}
            <button
              type="button"
              class="small"
              disabled={store.busy}
              onclick={() => void upload(key, account.host, account.login)}
              >{text.uploadTo(showBidi(account.login), account.host)}</button
            >
          {/each}
        </div>
      {/if}
    </div>
  {/each}

  {#if store.view.keys.length === 0}
    <p class="help">{text.empty}</p>
  {/if}

  <div class="buttons">
    <button type="button" class="primary" disabled={store.busy} onclick={() => void generate()}
      >{text.generate}</button
    >
    <button type="button" disabled={store.busy} onclick={() => void importKey()}>{text.import}</button>
  </div>
  {#if store.error !== null}
    <p class="error">{store.error}</p>
  {/if}
  <p class="help">{text.vaultHelp}</p>

  {#if store.view.keys.length > 0}
    <label class="check">
      <input
        type="checkbox"
        checked={store.view.enabled}
        onchange={(event) => void store.setEnabled(event.currentTarget.checked)}
      />
      <span>{text.enabled}</span>
    </label>
    <p class="help">{text.enabledHelp}</p>
    {#each testHosts as host (host)}
      {@const status = store.tests[host]}
      <div class="line test">
        <span>{host}</span>
        {#if status === 'ok'}
          <span class="ok">{text.testOk(host)}</span>
        {:else if status === 'failed'}
          <span class="fail">{text.testFailed(host)}</span>
        {/if}
        <span class="spacer"></span>
        <button
          type="button"
          class="small"
          disabled={status === 'testing'}
          onclick={() => void store.test(host)}>{status === 'testing' ? text.testing : text.test}</button
        >
      </div>
    {/each}
  {/if}
</section>

<style>
  .ssh {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px 0;
    border-bottom: 1px solid var(--separator);
  }

  .help {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.45;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 12px;
  }

  .key {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .name {
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  .badge {
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--chip-fill);
    color: var(--text-secondary);
    font-size: 11px;
  }

  .sub {
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .mono {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
    user-select: text;
    -webkit-user-select: text;
  }

  .uploads,
  .buttons {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .small {
    font-size: 12px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .test {
    font-size: 12px;
  }

  .ok {
    color: var(--success);
  }

  .fail {
    color: var(--warning);
  }
</style>
