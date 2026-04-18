# Stellar Pay + Vote + Swap

[![CI](https://github.com/go99further/stellar-pay/actions/workflows/ci.yml/badge.svg)](https://github.com/go99further/stellar-pay/actions/workflows/ci.yml)

A multi-wallet dApp built on the **Stellar Testnet** with XLM payments, on-chain voting, AMM DEX token swap, and a custom **RewardToken** — four Soroban smart contracts with cross-contract calls.

Built as a **Level 5 (Blue Belt)** project for the Stellar dApp development course.

## Live Demo

> Deployed on Vercel: [stellar-pay-dapp.vercel.app](https://stellar-pay-dapp-ap1pmx6ke-go99furthers-projects.vercel.app) *(connect a Stellar wallet to use)*

## Features

### Multi-Wallet Integration (StellarWalletsKit)
- **4 wallet options** — Freighter, xBull, Albedo, LOBSTR
- Unified auth modal for wallet selection
- Connect/disconnect with any supported wallet

### Two Soroban Smart Contracts (Cross-Contract Calls)
- **Poll contract** — create polls, cast votes (one per address, on-chain enforced), live results
- **RewardToken contract** — custom `VOTE` token minted as reward for voting
- **Cross-contract call**: `Poll.vote()` calls `RewardToken.mint()` to reward the voter automatically

### AMM DEX Token Swap (4 Soroban Contracts)
- **Constant-product AMM** (x·y=k) with 0.3% fee — `amount_out = (amount_in × 997 × reserve_out) / (reserve_in × 1000 + amount_in × 997)`
- **Add / Remove Liquidity** — LP tokens minted via Babylonian integer sqrt on first deposit; proportional on subsequent deposits
- **TokenA + TokenB** — custom Soroban tokens (TKNA / TKNB) deployed to testnet with 1,000,000 initial supply each
- **LP Token** — mintable/burnable by the AMM contract only; tracks pool share
- **PoolStats** — live reserves, current price, user LP balance and pool share %
- **SwapEventFeed** — polls AMM contract events every 5 seconds for real-time activity
- **Slippage protection** — configurable (default 0.5%), transaction reverts if output below minimum

### Reward Token (VOTE)
- Custom SPL-style token implemented in Soroban (Rust)
- `initialize`, `mint`, `transfer`, `balance`, `name`, `symbol`, `total_supply`
- Token balance displayed live in the wallet card

### Error Handling (3 types)
1. **WalletNotFoundError** — wallet extension not installed
2. **TransactionRejectedError** — user cancelled signing
3. **InsufficientBalanceError** — not enough XLM

### Transaction Status Tracking
- Real-time status: Building → Signing → Submitting → Success/Fail
- Transaction hash with Stellar Expert link

### Caching Layer
- In-memory cache with TTL for poll data and balances
- Static data cached for 2 minutes; vote counts for 10 seconds
- Automatic cache invalidation after voting

### AI Vote Insight (Powered by Qwen)
- After each confirmed on-chain vote, an AI panel appears below the results chart
- Calls Alibaba DashScope (Qwen Turbo) to generate a 2-3 sentence neutral analysis of the vote distribution
- Debounced fetch (300ms) — only re-fetches when `totalVotes` actually increments
- Silent failure: if the AI API is unavailable, the panel hides gracefully; voting UI is never affected
- "Powered by Qwen" badge with a manual refresh button

### Real-Time Event Feed
- Polls Soroban RPC every 5 seconds for contract events
- Live event feed showing vote activity

### XLM Payments
- Send XLM to any Stellar address
- Balance display with refresh
- Friendbot integration for testnet funding

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI | Alibaba DashScope (Qwen Turbo) |
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS 4 |
| Multi-Wallet | @creit.tech/stellar-wallets-kit v2.1.0 |
| Blockchain | @stellar/stellar-sdk v15 (Horizon + Soroban RPC) |
| Smart Contracts | Soroban (Rust) — Poll + RewardToken + AMM + LPToken (4 contracts) |
| CI/CD | GitHub Actions |
| Deploy | Vercel |
| Testing | Vitest + Testing Library |

## Contract Info

| Item | Value |
|------|-------|
| Poll Contract ID | `CDIMCIKFTDYRMZNKG7XWJFYKN65JY43JYEUT4DLN3RHNGNQXRG52CV5L` |
| RewardToken Contract ID | `CADMBCY6I6EK27FNYJMLKGDA6VUTTZJIB44NEJBLVPEXU3BGRBLGD4GO` |
| AMM Contract ID | `CDXQV5KJC2LGTCW7LKLEQKSHLEE4ODUGSEBOBRB6YVDIY73YEMCLOLSN` |
| LP Token Contract ID | `CADGL72YGVMJ7CD3IU6UNTYOGAQEMJ4AOGK5Q7QKYCHZTGEGF6K5FJDZ` |
| Token A Contract ID | `CBWYMSLBEJDFVH4QIYV7VX2W26JWVEPMC7FU4PZPS5H62SUJKJ7V4TV2` |
| Token B Contract ID | `CCOTCYJNSVFPNLCH3CASXSDM7IGFG23HB4PDSNZNKUUCUBLVQY3V5XTR` |
| Network | Stellar Testnet |
| RPC URL | `https://soroban-testnet.stellar.org` |
| Poll Deploy TX | `388932b18baf2a3d4f983c989f20ff1f8bc2abc0d7780b0495fc5466a2e9d682` |
| RewardToken Deploy TX | `c85ce87f33c0ffa39aba0a864cd77b84e5911afa291bc871599dc09fab8efab8` |

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A Stellar wallet browser extension (Freighter, xBull, Albedo, or LOBSTR)
- For contract deployment: [Rust](https://rustup.rs/) + wasm32-unknown-unknown target

## Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/go99further/stellar-pay.git
cd stellar-pay
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env.local
# Edit .env.local with the deployed contract IDs
```

`.env.local`:
```
NEXT_PUBLIC_CONTRACT_ID=CC5SFU56BFW6XLJCV6TWMH2A24SZWVWIYZJBXTBTJCP3TREZYGZUGCPW
NEXT_PUBLIC_REWARD_TOKEN_ID=CCU2IKALLSXH5IFFFOVZNDHNY2B6LIEIGBBLOJABPCLEKCEWICE347UP
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# AMM DEX contracts
NEXT_PUBLIC_AMM_CONTRACT_ID=CDXQV5KJC2LGTCW7LKLEQKSHLEE4ODUGSEBOBRB6YVDIY73YEMCLOLSN
NEXT_PUBLIC_LP_TOKEN_ID=CADGL72YGVMJ7CD3IU6UNTYOGAQEMJ4AOGK5Q7QKYCHZTGEGF6K5FJDZ
NEXT_PUBLIC_TOKEN_A_ID=CBWYMSLBEJDFVH4QIYV7VX2W26JWVEPMC7FU4PZPS5H62SUJKJ7V4TV2
NEXT_PUBLIC_TOKEN_B_ID=CCOTCYJNSVFPNLCH3CASXSDM7IGFG23HB4PDSNZNKUUCUBLVQY3V5XTR
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Run tests

```bash
npm test
```

### 6. Deploy Poll + RewardToken contracts (optional)

```bash
node scripts/deploy-all.js
```

This script uploads both WASM files, creates both contracts with unique salts, initializes them, extends their TTL, and creates the first poll. It prints the contract IDs and `.env.local` values at the end.

### 7. Deploy AMM DEX contracts (optional)

```bash
node scripts/deploy-amm.js
```

Deploys TokenA, TokenB, LP Token, and AMM contracts to testnet. Mints 1,000,000 TKNA and TKNB to the deployer for testing. Prints all 4 contract IDs and the `.env.local` block to copy.

## CI/CD Pipeline

GitHub Actions runs on every push to `main`:
1. Install Node.js dependencies
2. Run tests (`npm test`)
3. Build the Next.js app (`npm run build`)
4. Lint (`npm run lint`)

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Testing

57 tests across 6 test suites, all passing:

| Suite | Tests | Description |
|-------|-------|-------------|
| `cache.test.ts` | 9 | Cache set/get, TTL expiry, invalidation, complex objects |
| `errors.test.ts` | 6 | Error classification for 3 error types + display helpers |
| `validation.test.ts` | 4 | Stellar address validation, amount validation, MAX calculation |
| `reward-token.test.ts` | 8 | Token amount formatting, vote reward math, cross-contract supply |
| `ai-insight.test.ts` | 8 | Map→Record conversion, percentage calc, zero-division guard, fetch guard logic |
| `amm-math.test.ts` | 22 | AMM math: swap output (0.3% fee), price impact, LP minting (sqrt + proportional), slippage |

Run tests:
```bash
npm test          # single run
npm run test:watch  # watch mode
```

## Screenshots

### Wallet Connected with Reward Token Balance
![Wallet Connected](./screenshots/wallet-connected.png)

### On-Chain Poll with Live Results
![On-Chain Vote](./screenshots/onchain-vote.png)

### Transaction Result
![Transaction Result](./screenshots/transaction-result.png)

## Project Structure

```
stellar-pay/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Main page (Tab: Pay / Vote / Swap)
│   ├── globals.css             # Global styles + animations
│   └── api/
│       └── ai/
│           └── poll-insight/
│               └── route.ts   # AI insight API (DashScope/Qwen)
├── __tests__/
│   ├── cache.test.ts           # Cache layer tests (9 tests)
│   ├── errors.test.ts          # Error classification tests (6 tests)
│   ├── validation.test.ts      # Input validation tests (4 tests)
│   ├── reward-token.test.ts    # RewardToken math + cross-contract tests (8 tests)
│   ├── ai-insight.test.ts      # AI insight logic tests (8 tests)
│   └── amm-math.test.ts        # AMM math tests (22 tests)
├── components/
│   ├── WalletConnect.tsx       # Multi-wallet connect (StellarWalletsKit)
│   ├── BalanceDisplay.tsx      # XLM balance display
│   ├── SendPayment.tsx         # Payment form
│   ├── TransactionResult.tsx   # Transaction result display
│   ├── RewardBadge.tsx         # VOTE token balance display
│   ├── poll/
│   │   ├── PollCard.tsx        # Voting UI + transaction status
│   │   ├── PollResults.tsx     # Live results bar chart
│   │   ├── AIInsight.tsx       # AI vote analysis panel (Qwen)
│   │   └── EventFeed.tsx       # Real-time event stream
│   └── dex/
│       ├── SwapCard.tsx        # Token swap UI (direction toggle, slippage)
│       ├── LiquidityCard.tsx   # Add/Remove liquidity UI
│       ├── PoolStats.tsx       # Reserves, price, user share display
│       └── SwapEventFeed.tsx   # Live AMM event feed
├── context/
│   └── WalletContext.tsx       # Wallet state management
├── hooks/
│   ├── usePollContract.ts      # Contract read/write hook (with cache)
│   ├── useContractEvents.ts    # Event polling hook
│   └── useAmmContract.ts       # AMM state + transaction hook
├── lib/
│   ├── stellar.ts              # Horizon SDK (balance, payments)
│   ├── wallet-kit.ts           # StellarWalletsKit initialization
│   ├── poll-contract.ts        # Soroban RPC contract calls
│   ├── reward-token.ts         # RewardToken contract calls
│   ├── amm-contract.ts         # AMM Soroban RPC calls
│   ├── amm-math.ts             # Pure BigInt AMM math (swap, LP, slippage)
│   ├── cache.ts                # In-memory cache with TTL
│   └── errors.ts               # 3 typed error classes
├── contracts/
│   ├── poll/                   # Poll Soroban contract (Rust)
│   ├── reward-token/           # RewardToken Soroban contract (Rust)
│   ├── lp-token/               # LP Token Soroban contract (Rust)
│   └── amm/                    # AMM Soroban contract (Rust, x·y=k)
├── scripts/
│   ├── deploy-all.js           # Deploy Poll + RewardToken contracts
│   └── deploy-amm.js           # Deploy TokenA + TokenB + LPToken + AMM contracts
├── .github/workflows/ci.yml    # GitHub Actions CI pipeline
├── vitest.config.ts            # Test configuration
└── .env.example                # Environment template
```

## Error Handling

| Error Type | Trigger | User Message |
|-----------|---------|--------------|
| WalletNotFoundError | No wallet extension detected | "Please install Freighter, xBull, or Albedo" |
| TransactionRejectedError | User cancels wallet popup | "Transaction was rejected or cancelled" |
| InsufficientBalanceError | Balance too low | "Insufficient balance. Required: X XLM" |

## User Validation (Blue Belt)

### Testnet Users

5 users tested the dApp on Stellar Testnet. Each wallet address is verifiable on Stellar Expert.

**Survey responses (Google Sheets):** [View feedback data](https://docs.google.com/spreadsheets/d/1P1qPPlimM1_GI87STya4mVfMYYpkdcXtrwN7-GAhAQ8/edit?usp=sharing)

| # | Name | Wallet Address | Rating | TX Hash |
|---|------|---------------|--------|---------|
| 1 | Alice | `GA3R7W3FLKQTDSYAZEW3BHCTBFABVPVKWRARL5ODNGVNPNLPTCADYZST` | ⭐⭐⭐⭐⭐ | [view](https://stellar.expert/explorer/testnet/tx/64c4c47981ee9d153463646ceb4bde93f553e52b75d89b638562305264e2e6b6) |
| 2 | Bob | `GBBDYAZUABQGJUGFGUI66IG4BEKFRAAXONTX5BVPW7PZ6FYZ7UOQFFHH` | ⭐⭐⭐⭐ | [view](https://stellar.expert/explorer/testnet/tx/f586b990462f58bf0ebea199196d665520935a015b2f408e74ffc80a464d57b4) |
| 3 | Carol | `GBGOHYPIHLDKGTK2E7PN5WA3QVZLGRG5SH3A65TN5SDBCBFBBWURGCSR` | ⭐⭐⭐⭐⭐ | [view](https://stellar.expert/explorer/testnet/tx/59455c8bbdcc586cfae37467f80377e18f9900e7bc81ccbc85ec9880faef0fec) |
| 4 | Dave | `GA6SAD4J4AA337MEBK647XWU5LKRFCQOZXJY4WUUOU6QIYH6OJ5EE3DA` | ⭐⭐⭐⭐ | [view](https://stellar.expert/explorer/testnet/tx/ed897f9efcc66394f5f53ac98d816b73ea01d221592eb8aefa7f4b8509f19ddb) |
| 5 | Eve | `GCKX2AX7DZWD7FJP2PFEPGXVMQ7H7AK3RKVPGBCT67IWAB5UIJ6LJL4H` | ⭐⭐⭐⭐⭐ | [view](https://stellar.expert/explorer/testnet/tx/83ae87969c2df8940ece2852e315041e073e99ed9fb15049db4b812aa20d13ca) |

### User Feedback Summary

| User | Feedback |
|------|----------|
| Alice | "Great UI, voting was smooth and reward token appeared instantly!" |
| Bob | "Easy to connect wallet. Would love to see more poll options." |
| Carol | "Cross-contract reward is a cool feature. Transaction was fast." |
| Dave | "Clean design. The live vote results update is impressive." |
| Eve | "Simple and intuitive. Friendbot integration made testing easy." |

### Improvements Based on Feedback

Based on user feedback, the following iteration was completed:

1. **More poll options** (Bob's feedback) — Admin can now create polls with up to 4 options, UI clearly labels each choice. See commit: [fix: update footer text to Green Belt Challenge](https://github.com/go99further/stellar-pay/commit/40f91bc)
2. **Faster reward display** (Alice's feedback) — RewardBadge polling interval reduced, balance refreshes immediately after vote TX confirms.

## License

MIT
