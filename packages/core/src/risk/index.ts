// Cờ rủi ro trước khi commit (không AI) — luật thuần + bộ gom đầu vào từ repo.
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
