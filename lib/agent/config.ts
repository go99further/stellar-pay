export interface StellarPayConfig {
  maxHistory: number;
  maxTokens: number;
  analyticsMaxTurns: number;
  tradingMaxTurns: number;
  securityMaxTurns: number;
  turnLimitWarning: number;
}

export function loadConfig(): StellarPayConfig {
  return {
    maxHistory: parseInt(process.env.STELLAR_MAX_HISTORY ?? "20", 10),
    maxTokens: parseInt(process.env.STELLAR_MAX_TOKENS ?? "1024", 10),
    analyticsMaxTurns: parseInt(process.env.STELLAR_ANALYTICS_MAX_TURNS ?? "5", 10),
    tradingMaxTurns: parseInt(process.env.STELLAR_TRADING_MAX_TURNS ?? "6", 10),
    securityMaxTurns: parseInt(process.env.STELLAR_SECURITY_MAX_TURNS ?? "5", 10),
    turnLimitWarning: parseInt(process.env.STELLAR_TURN_LIMIT_WARNING ?? "4", 10),
  };
}

export const config = loadConfig();
