<!--
  Safety: a read-only summary of the restrictions the Rust core and the Node adapter enforce on every git
  invocation. The texts are tied to the policy (packages/contracts/git-policy.json is the single source of
  truth) so the section never claims a protection that isn't real.
 -->
<script lang="ts">
  import { gitPolicy } from '@thaigit/contracts';
  import { vi } from '../strings.vi.ts';
</script>

<section>
  <h3>{vi.settings.safety}</h3>
  <p class="help">{vi.settings.safetyHelp}</p>
  <ul class="safety-list">
    <li>{vi.settings.safetyAllowedCommands(Object.keys(gitPolicy.subcommands).length)}</li>
    <li>{vi.settings.safetyForceSafeConfig}</li>
    <li>{vi.settings.safetyDiffNeverRunsRepoCode}</li>
    <li>{vi.settings.safetyUrlSchemesBlocked(gitPolicy.url.rejectSchemes.join(', '))}</li>
    <li>{vi.settings.safetyEnvStripped}</li>
  </ul>
</section>

<style>
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

  .help {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.45;
  }

  .safety-list {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    line-height: 1.5;
  }

  .safety-list li + li {
    margin-top: 4px;
  }
</style>
