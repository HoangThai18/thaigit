// Pre-commit risk flags (no AI involved) — plain rules plus the input collector that reads from the repo.
export {
  LARGE_FILE_BYTES,
  RISK_CODES,
  detectRisks,
  isTestPath,
  type RiskCode,
  type RiskFlag,
  type RiskInput,
} from './risk-flags.ts';
export { addedLinesByPath, collectRiskInputs } from './collect.ts';
