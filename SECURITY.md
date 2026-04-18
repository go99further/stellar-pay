# Security Checklist

This document records the completed security review for the Stellar Pay + Vote + Swap dApp.

## Smart Contract Security

| Check | Status | Evidence |
|-------|--------|---------|
| All state-changing functions use `require_auth()` | ✅ | `poll/src/lib.rs:vote()`, `amm/src/lib.rs:swap()`, `add_liquidity()`, `remove_liquidity()` |
| Slippage protection on all AMM operations | ✅ | `min_amount_out`, `min_lp`, `min_a`, `min_b` guards in AMM contract |
| Input validation (positive amounts) | ✅ | `if amount_in <= 0 { panic!(...) }` in all AMM functions |
| One vote per address enforced on-chain | ✅ | `poll/src/lib.rs`: `has_voted` storage check before casting vote |
| Cross-contract calls use typed client interfaces | ✅ | `contractimport!` macro generates typed clients for LP Token and Token |
| No integer overflow (Soroban i128) | ✅ | Soroban SDK uses i128 with checked arithmetic; AMM formula uses 997/1000 multipliers |
| Admin-only functions protected | ✅ | `set_minter`, `initialize` require admin auth |

## Frontend Security

| Check | Status | Evidence |
|-------|--------|---------|
| No private keys in client-side code | ✅ | Only `NEXT_PUBLIC_*` env vars in browser; `FEE_BUMP_SPONSOR_SECRET` is server-only |
| No hardcoded secrets | ✅ | All secrets via environment variables |
| API routes validate input | ✅ | `/api/fee-bump` validates `signedXdr` type; `/api/ai/poll-insight` validates required fields |
| XSS prevention | ✅ | React escapes all rendered values by default; no `dangerouslySetInnerHTML` used |
| HTTPS enforced | ✅ | Vercel enforces HTTPS on all deployments |
| CORS: API routes are same-origin | ✅ | Next.js API routes are same-origin by default |
| No SQL injection | ✅ | No database used; all data from Soroban RPC |
| Wallet signing required for all transactions | ✅ | All write operations go through `signTransaction()` via StellarWalletsKit |
| Slippage tolerance configurable by user | ✅ | SwapCard and LiquidityCard expose slippage selector (0.25%, 0.5%, 1%) |

## Infrastructure Security

| Check | Status | Evidence |
|-------|--------|---------|
| CI/CD pipeline runs tests before deploy | ✅ | `.github/workflows/ci.yml`: test → build → lint → deploy |
| Environment variables managed via Vercel | ✅ | All secrets in Vercel project settings, not in repo |
| `.env.local` in `.gitignore` | ✅ | Local secrets never committed |
| Dependencies audited | ✅ | `@stellar/stellar-sdk v15`, `next v16`, no known critical CVEs |
| Fee bump sponsor key is server-side only | ✅ | `FEE_BUMP_SPONSOR_SECRET` used only in `app/api/fee-bump/route.ts` |

## Known Limitations (Testnet)

- Contracts deployed on **Stellar Testnet** only — not audited for mainnet use
- Testnet resets periodically; contract IDs will change after a reset
- Fee bump sponsor account requires manual XLM top-up if balance runs low
- In-memory cache is per-server-instance (no distributed cache)
- Metrics data covers only the last ~1000 ledgers (~1 hour) due to Soroban RPC limits

## Responsible Disclosure

If you discover a security vulnerability, please open a GitHub issue with the label `security`.
