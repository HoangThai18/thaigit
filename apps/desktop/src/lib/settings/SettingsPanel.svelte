<!--
  Màn Cài đặt (Ctrl/⌘ + ,): giao diện, lịch sử, đồng bộ, diff, AI, quyền riêng tư, kênh cập nhật. Mọi thay đổi áp ngay và lưu
  (prefs kẹp giá trị về khoảng hợp lệ). Esc / Xong / bấm nền để đóng.
-->
<script lang="ts">
  import type { UpdateChannel } from '@thaigit/contracts';
  import { updateSetChannel } from '../ipc/update.ts';
  import { hasTauriInternals } from '../platform/host.ts';
  import { vi } from '../strings.vi.ts';
  import { AI_ENABLED } from '../ai/enabled.ts';
  import { ai as defaultAi, type AiStore } from '../stores/ai.svelte.ts';
  import {
    AUTO_FETCH_MINUTES_MAX,
    COMMIT_LIMIT_MAX,
    COMMIT_LIMIT_MIN,
    DIFF_CONTEXT_MAX,
    prefs as defaultPrefs,
    type ColorScheme,
    type PrefsStore,
    type PullModePref,
  } from '../stores/prefs.svelte.ts';
  import { settingsStore as defaultSettings, type SettingsStore } from '../stores/settings.svelte.ts';
  import { telemetry as defaultTelemetry, type TelemetryStore } from '../stores/telemetry.svelte.ts';
  import { toasts } from '../stores/toasts.svelte.ts';
  import { accounts as defaultAccounts } from '../stores/accounts.svelte.ts';
  import AccountsSection from './AccountsSection.svelte';

  interface Props {
    settings?: SettingsStore;
    prefs?: PrefsStore;
    ai?: AiStore;
    telemetry?: TelemetryStore;
    setChannel?: (channel: UpdateChannel) => Promise<void>;
  }

  let {
    settings = defaultSettings,
    prefs = defaultPrefs,
    ai = defaultAi,
    telemetry = defaultTelemetry,
    setChannel = updateSetChannel,
  }: Props = $props();

  const value = $derived(prefs.value);
  const inApp = hasTauriInternals();
  let doneButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (settings.isOpen && doneButton) doneButton.focus();
  });

  // Danh sách tài khoản nạp khi mở Cài đặt (Rust là nguồn sự thật; lỗi thì giữ danh sách cũ).
  $effect(() => {
    if (settings.isOpen) void defaultAccounts.refresh().catch(() => undefined);
  });

  function numberInput(event: Event, apply: (value: number) => void): void {
    const input = event.currentTarget as HTMLInputElement;
    const parsed = Number(input.value);
    if (input.value.trim() !== '' && Number.isFinite(parsed)) apply(parsed);
    // Giá trị đã kẹp (vd. nhập 5 cho số commit → 200): hiện lại đúng giá trị đang dùng.
    queueMicrotask(() => {
      input.value = String(input.dataset.current ?? input.value);
    });
  }

  async function changeChannel(channel: UpdateChannel): Promise<void> {
    const previous = settings.channel;
    settings.rememberChannel(channel);
    try {
      await setChannel(channel);
    } catch (error) {
      settings.rememberChannel(previous);
      toasts.error(vi.settings.channelFailed, error);
    }
  }

  function onwindowkeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault();
      if (settings.isOpen) settings.close();
      else settings.open();
      return;
    }
    if (settings.isOpen && event.key === 'Escape') {
      event.preventDefault();
      settings.close();
    }
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#if settings.isOpen}
  <div class="backdrop" role="presentation" onclick={() => settings.close()}>
    <div
      class="panel glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') settings.close();
      }}
    >
      <header>
        <h2 id="settings-title">{vi.settings.title}</h2>
        <button type="button" class="done" bind:this={doneButton} onclick={() => settings.close()}
          >{vi.settings.close}</button
        >
      </header>
      <div class="body">
        <section>
          <h3>{vi.settings.appearance}</h3>
          <label class="row">
            <span>{vi.settings.scheme}</span>
            <select
              value={value.scheme}
              onchange={(event) => prefs.update({ scheme: event.currentTarget.value as ColorScheme })}
            >
              <option value="system">{vi.settings.schemeSystem}</option>
              <option value="light">{vi.settings.schemeLight}</option>
              <option value="dark">{vi.settings.schemeDark}</option>
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={value.glass}
              onchange={(event) => prefs.update({ glass: event.currentTarget.checked })}
            />
            <span>{vi.settings.glass}</span>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={value.relativeDates}
              onchange={(event) => prefs.update({ relativeDates: event.currentTarget.checked })}
            />
            <span>{vi.settings.relativeDates}</span>
          </label>
        </section>

        <section>
          <h3>{vi.settings.history}</h3>
          <label class="row">
            <span>{vi.settings.commitLimit}</span>
            <input
              type="number"
              min={COMMIT_LIMIT_MIN}
              max={COMMIT_LIMIT_MAX}
              step="100"
              value={value.commitLimit}
              data-current={value.commitLimit}
              title={vi.settings.invalidNumber(COMMIT_LIMIT_MIN, COMMIT_LIMIT_MAX)}
              onchange={(event) => numberInput(event, (n) => prefs.update({ commitLimit: n }))}
            />
          </label>
          <label class="row">
            <span>{vi.settings.logOrder}</span>
            <select
              value={value.logOrder}
              onchange={(event) => prefs.update({ logOrder: event.currentTarget.value as 'date' | 'topo' })}
            >
              <option value="date">{vi.settings.logOrderDate}</option>
              <option value="topo">{vi.settings.logOrderTopo}</option>
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={value.showRemoteBranches}
              onchange={(event) => prefs.update({ showRemoteBranches: event.currentTarget.checked })}
            />
            <span>{vi.settings.showRemoteBranches}</span>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={value.showTags}
              onchange={(event) => prefs.update({ showTags: event.currentTarget.checked })}
            />
            <span>{vi.settings.showTags}</span>
          </label>
        </section>

        <section>
          <h3>{vi.settings.sync}</h3>
          <label class="row">
            <span>{vi.settings.pullMode}</span>
            <select
              value={value.pullMode}
              onchange={(event) => prefs.update({ pullMode: event.currentTarget.value as PullModePref })}
            >
              <option value="merge">{vi.settings.pullMerge}</option>
              <option value="rebase">{vi.settings.pullRebase}</option>
              <option value="ff-only">{vi.settings.pullFastForward}</option>
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={value.fetchPrune}
              onchange={(event) => prefs.update({ fetchPrune: event.currentTarget.checked })}
            />
            <span>{vi.settings.fetchPrune}</span>
          </label>
          <label class="row">
            <span>{vi.settings.autoFetch}</span>
            <input
              type="number"
              min="0"
              max={AUTO_FETCH_MINUTES_MAX}
              value={value.autoFetchMinutes}
              data-current={value.autoFetchMinutes}
              title={vi.settings.invalidNumber(0, AUTO_FETCH_MINUTES_MAX)}
              onchange={(event) => numberInput(event, (n) => prefs.update({ autoFetchMinutes: n }))}
            />
          </label>
        </section>

        <section>
          <h3>{vi.settings.diff}</h3>
          <label class="row">
            <span>{vi.settings.diffContext}</span>
            <input
              type="number"
              min="0"
              max={DIFF_CONTEXT_MAX}
              value={value.diffContext}
              data-current={value.diffContext}
              title={vi.settings.invalidNumber(0, DIFF_CONTEXT_MAX)}
              onchange={(event) => numberInput(event, (n) => prefs.update({ diffContext: n }))}
            />
          </label>
        </section>

        {#if AI_ENABLED}
          <section>
            <h3>{vi.settings.ai}</h3>
            <p class="help">{ai.consented ? vi.settings.aiOn : vi.settings.aiOff}</p>
            <label class="row">
              <span>{vi.settings.aiLanguage}</span>
              <select
                value={ai.saved.options.language}
                onchange={(event) =>
                  ai.setOptions({ language: event.currentTarget.value as 'auto' | 'vi' | 'en' })}
              >
                <option value="auto">{vi.ai.languageAuto}</option>
                <option value="vi">{vi.ai.languageVi}</option>
                <option value="en">{vi.ai.languageEn}</option>
              </select>
            </label>
            <label class="row">
              <span>{vi.settings.aiLength}</span>
              <select
                value={ai.saved.options.length}
                onchange={(event) =>
                  ai.setOptions({ length: event.currentTarget.value as 'short' | 'normal' | 'detailed' })}
              >
                <option value="short">{vi.ai.lengthShort}</option>
                <option value="normal">{vi.ai.lengthNormal}</option>
                <option value="detailed">{vi.ai.lengthDetailed}</option>
              </select>
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={ai.saved.options.conventional}
                onchange={(event) => ai.setOptions({ conventional: event.currentTarget.checked })}
              />
              <span>{vi.settings.aiConventional}</span>
            </label>
            {#if ai.consented}
              <button
                type="button"
                class="danger"
                onclick={() => {
                  ai.disable();
                  toasts.info(vi.ai.disabledToast);
                }}>{vi.settings.aiDisable}</button
              >
            {/if}
          </section>
        {/if}

        {#if inApp}
          <AccountsSection />
        {/if}

        <section>
          <h3>{vi.settings.privacy}</h3>
          <label class="check">
            <input
              type="checkbox"
              checked={telemetry.saved.enabled}
              disabled={!telemetry.supported && !telemetry.saved.enabled}
              onchange={(event) => telemetry.setEnabled(event.currentTarget.checked)}
            />
            <span>{vi.settings.telemetry}</span>
          </label>
          <p class="help">
            {telemetry.supported ? vi.settings.telemetryHelp : vi.settings.telemetryUnsupported}
          </p>
        </section>

        {#if inApp}
          <section>
            <h3>{vi.settings.updates}</h3>
            <label class="row">
              <span>{vi.settings.channel}</span>
              <select
                value={settings.channel}
                onchange={(event) => void changeChannel(event.currentTarget.value as UpdateChannel)}
              >
                <option value="beta">{vi.settings.channelBeta}</option>
                <option value="stable">{vi.settings.channelStable}</option>
              </select>
            </label>
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 860;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.28);
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(600px, calc(100vw - 48px));
    max-height: calc(100vh - 64px);
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 22px 10px;
    border-bottom: 1px solid var(--separator);
  }

  h2 {
    margin: 0;
    font-size: 16px;
  }

  .body {
    overflow: auto;
    padding: 6px 22px 18px;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px 0;
    border-bottom: 1px solid var(--separator);
  }

  section:last-child {
    border-bottom: none;
  }

  h3 {
    margin: 0 0 2px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    font-size: 13px;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
  }

  .check input {
    margin-top: 2px;
  }

  .help {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.45;
  }

  select,
  input[type='number'] {
    min-width: 170px;
    padding: 5px 8px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }

  input[type='number'] {
    min-width: 0;
    width: 110px;
    text-align: right;
  }

  select:focus,
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .done,
  .danger {
    padding: 5px 14px;
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .danger {
    align-self: flex-start;
    border-color: var(--field-border);
    background: var(--field-fill);
    color: var(--danger);
  }

  .done:focus-visible,
  .danger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
