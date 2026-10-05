<!--
  Mục "Tài khoản" trong Cài đặt: đăng nhập GitHub / GitLab / Bitbucket, nhiều tài khoản trên cùng máy chủ, gán owner cho
  repo (user hoặc tổ chức) và tên/email commit. Token do Rust giữ trong kho bí mật của hệ điều hành — ô dán token ở đây
  không lưu gì ở webview.
-->
<script lang="ts">
  import type { ForgeProvider } from '@thaigit/contracts';
  import { openUrl } from '../ipc/os.ts';
  import { showBidi } from '../format/bidi.ts';
  import { vi } from '../strings.vi.ts';
  import { providerOfHost } from '../forge/target.ts';
  import {
    accounts as globalAccounts,
    hostOfProvider,
    type AccountsStore,
  } from '../stores/accounts.svelte.ts';
  import { dialogs } from '../stores/dialogs.svelte.ts';
  import { toasts } from '../stores/toasts.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store?: AccountsStore;
  }

  let { store = globalAccounts }: Props = $props();

  const text = vi.accounts;
  const providers: readonly ForgeProvider[] = ['github', 'gitlab', 'bitbucket'];

  let host = $state('github.com');
  let provider = $state<ForgeProvider>('github');
  let token = $state('');
  let showClientId = $state(false);
  let clientIdDraft = $state('');
  /** The account whose commit name / email is being edited. */
  let identityFor = $state<{ host: string; login: string } | null>(null);
  let identityName = $state('');
  let identityEmail = $state('');

  const hostKey = $derived(host.trim().toLowerCase());
  const hasClientId = $derived(store.clientIdFor(hostKey) !== '');

  function chooseProvider(next: ForgeProvider): void {
    provider = next;
    host = hostOfProvider(next);
    token = '';
  }

  function onHostInput(): void {
    token = '';
    const guess = providerOfHost(host);
    if (guess !== null && guess !== provider) provider = guess;
  }

  async function addToken(): Promise<void> {
    if (token.trim() === '') return;
    const account = await store.addToken(hostKey, token.trim(), provider);
    token = '';
    if (account !== null) toasts.success(text.addedToast(account.login));
  }

  async function startLogin(): Promise<void> {
    await store.startLogin(hostKey, provider, (login) => toasts.success(text.addedToast(login)));
  }

  async function removeAccount(accountHost: string, login: string): Promise<void> {
    const ok = await dialogs.confirm({
      title: text.remove,
      message: text.removeConfirm(login),
      confirmTitle: text.remove,
      destructive: true,
    });
    if (!ok) return;
    await store.remove(accountHost, login);
    if (store.error === null) toasts.info(text.removedToast(login));
  }

  function editIdentity(accountHost: string, login: string, name: string, email: string): void {
    identityFor = { host: accountHost, login };
    identityName = name;
    identityEmail = email;
  }

  async function saveIdentity(): Promise<void> {
    if (identityFor === null) return;
    await store.setIdentity(identityFor.host, identityFor.login, identityName, identityEmail);
    if (store.error === null) identityFor = null;
  }

  async function saveClientId(): Promise<void> {
    await store.setClientId(hostKey, clientIdDraft.trim());
    if (store.error === null) showClientId = false;
  }

  const isDefault = (accountHost: string, login: string): boolean =>
    store.defaultLoginFor(accountHost) === login;
</script>

<section class="accounts">
  <h3>{text.title}</h3>
  <p class="help">{text.help}</p>

  {#each store.hostsWithAccounts() as knownHost (knownHost)}
    {@const list = store.accountsFor(knownHost)}
    <div class="group">
      <div class="group-head">
        <span class="host"><bdi>{showBidi(knownHost)}</bdi></span>
        <span class="count">{list.length}</span>
      </div>
      {#each list as account (account.host + '/' + account.login)}
        <div class="account">
          <div class="line">
            <span class="login"><bdi>{showBidi(account.login)}</bdi></span>
            {#if isDefault(knownHost, account.login)}
              <span class="badge">{text.isDefault}</span>
            {/if}
            {#if !account.hasToken}
              <span class="badge warn">{text.tokenMissing}</span>
            {/if}
            <span class="spacer"></span>
            {#if !isDefault(knownHost, account.login)}
              <button
                type="button"
                class="link"
                onclick={() => void store.setDefault(knownHost, account.login)}>{text.setDefault}</button
              >
            {/if}
            <button
              type="button"
              class="link"
              onclick={() => editIdentity(knownHost, account.login, account.commitName, account.commitEmail)}
              >{text.identity}</button
            >
            <button
              type="button"
              class="link danger"
              onclick={() => void removeAccount(knownHost, account.login)}>{text.remove}</button
            >
          </div>
          {#if account.displayName}
            <div class="sub"><bdi>{showBidi(account.displayName)}</bdi></div>
          {/if}
          <div class="sub">
            <bdi>{showBidi(account.commitName)}</bdi> · <bdi>{showBidi(account.commitEmail)}</bdi>
          </div>
          {#if account.organizations.length > 0}
            <div class="sub orgs">
              {text.organizations}: {account.organizations.map((name) => showBidi(name)).join(', ')}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/each}

  {#if store.view.accounts.length === 0}
    <p class="help">{text.empty}</p>
  {/if}

  <div class="add">
    <label class="row">
      <span>{text.provider}</span>
      <select
        value={provider}
        onchange={(event) => chooseProvider(event.currentTarget.value as ForgeProvider)}
      >
        {#each providers as item (item)}
          <option value={item}>{hostOfProvider(item)}</option>
        {/each}
      </select>
    </label>
    <label class="row">
      <span>{text.host}</span>
      <input
        type="text"
        bind:value={host}
        oninput={onHostInput}
        placeholder={text.hostPlaceholder}
        spellcheck="false"
      />
    </label>

    {#if store.login !== null && store.login.host === hostKey}
      <div class="login-code">
        <span class="code-label">{text.codeLabel}</span>
        <code class="code">{store.login.userCode}</code>
        <button
          type="button"
          class="link"
          onclick={() => void openUrl(store.login?.verificationUri ?? '', true)}>{text.openPage}</button
        >
        <span class="waiting"><Icon name="spinner" size={12} />{text.waiting}</span>
        <button type="button" class="link danger" onclick={() => store.cancelLogin()}>{text.cancel}</button>
      </div>
    {:else}
      <label class="row">
        <span>{text.token}</span>
        <input
          type="password"
          bind:value={token}
          placeholder={text.tokenPlaceholder}
          spellcheck="false"
          autocomplete="off"
        />
      </label>
      <p class="help">{text.tokenHelp(hostKey)}</p>
      <div class="buttons">
        <button
          type="button"
          class="primary"
          disabled={store.busy || token.trim() === ''}
          onclick={() => void addToken()}
        >
          {store.busy ? text.adding : text.addSubmit}
        </button>
        {#if provider !== 'bitbucket'}
          <button
            type="button"
            disabled={store.busy || !hasClientId}
            title={hasClientId ? text.loginHelp : text.noClientId}
            onclick={() => void startLogin()}
          >
            {text.loginByCode}
          </button>
        {/if}
        <button
          type="button"
          class="link"
          onclick={() => {
            clientIdDraft = store.clientIdFor(hostKey);
            showClientId = !showClientId;
          }}>{text.clientId}</button
        >
      </div>
      {#if showClientId}
        <div class="client-id">
          <input type="text" bind:value={clientIdDraft} spellcheck="false" autocomplete="off" />
          <button type="button" class="primary" onclick={() => void saveClientId()}
            >{text.saveClientId}</button
          >
          <p class="help">{text.clientIdHelp}</p>
        </div>
      {/if}
    {/if}
  </div>

  {#if identityFor !== null}
    <div class="identity">
      <label class="row">
        <span>{text.identityName}</span>
        <input type="text" bind:value={identityName} spellcheck="false" />
      </label>
      <label class="row">
        <span>{text.identityEmail}</span>
        <input type="text" bind:value={identityEmail} spellcheck="false" />
      </label>
      <p class="help">{text.identityHelp}</p>
      <div class="buttons">
        <button type="button" class="primary" disabled={store.busy} onclick={() => void saveIdentity()}
          >{text.identitySave}</button
        >
        <button type="button" class="link" onclick={() => (identityFor = null)}>{text.cancel}</button>
      </div>
    </div>
  {/if}

  {#if store.error}
    <p class="error" role="alert">{store.error}</p>
  {/if}
</section>

<style>
  .accounts {
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

  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 650;
    color: var(--text-secondary);
  }

  .count {
    margin-left: auto;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .account {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .login {
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

  .badge.warn {
    color: var(--warning);
  }

  .sub {
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .orgs {
    overflow-wrap: anywhere;
  }

  .add,
  .identity,
  .client-id {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    font-size: 13px;
  }

  .buttons {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .login-code {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
  }

  .code-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .code {
    padding: 3px 8px;
    border-radius: var(--radius-s);
    background: var(--chip-fill);
    font-size: 15px;
    font-weight: 650;
    letter-spacing: 0.08em;
    user-select: text;
    -webkit-user-select: text;
  }

  .waiting {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-secondary);
    font-size: 12px;
  }
</style>
