# Stellar Pay + Vote

A multi-wallet dApp built on the **Stellar Testnet** with XLM payments and on-chain voting via a Soroban smart contract.

Built as a **Level 3 (Orange Belt)** project for the Stellar dApp development course.

## Demo Video

[Watch the 1-minute demo](YOUR_VIDEO_LINK_HERE)

## Features

### Multi-Wallet Integration (StellarWalletsKit)
- **4 wallet options** — Freighter, xBull, Albedo, LOBSTR
- Unified auth modal for wallet selection
- Connect/disconnect with any supported wallet

### Smart Contract (Soroban)
- **Poll contract** deployed on Stellar Testnet
- Create polls with 2-4 options
- Cast votes (one vote per address, enforced on-chain)
- Read poll data (question, options, vote counts)
- Events emitted on every vote

### Error Handling (3 types)
1. **WalletNotFoundError** — wallet extension not installed
2. **TransactionRejectedError** — user cancelled signing
3. **InsufficientBalanceError** — not enough XLM

### Transaction Status Tracking
- Real-time status: Building → Signing → Submitting → Success/Fail
- Transaction hash with Stellar Expert link

### Caching Layer
- In-memory cache with TTL for poll data and balances
- Static data (question, options) cached for 2 minutes
- Vote counts cached for 10 seconds
- Automatic cache invalidation after voting

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
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS 4 |
| Multi-Wallet | @creit.tech/stellar-wallets-kit v2.1.0 |
| Blockchain | @stellar/stellar-sdk v15 (Horizon + Soroban RPC) |
| Smart Contract | Soroban (Rust) |
| Testing | Vitest + Testing Library |

## Contract Info

| Item | Value |
|------|-------|
| Contract ID | `CBW7N5YI34QFHTHRGK5ICBHGWA672ABPEFONMQEE2JZTQUGAJMUDJ5PT` |
| Network | Stellar Testnet |
| RPC URL | `https://soroban-testnet.stellar.org` |
| Deploy TX Hash | `ecb22d2521f1868064f05ee8ea2dd0a6fb0dccbef0526c63957be2ce40510041` |
| Poll Creation TX | `4743513a6ef6bd18a60d7cf1fb0ca563a7299302f6d016631fbbadaa08f4e2fa` |

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A Stellar wallet browser extension (Freighter, xBull, Albedo, or LOBSTR)
- For contract deployment: [Rust](https://rustup.rs/) + [Stellar CLI](https://github.com/stellar/stellar-cli)

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
# Edit .env.local with your deployed contract ID
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

### 6. Deploy the Smart Contract (optional)

```bash
cd contracts/poll
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/poll_contract.wasm \
  --network testnet \
  --source <YOUR_SECRET_KEY>
```

## Testing

19 tests across 3 test suites, all passing:

### Test Output
![Test Output](./screenshots/test-output.png)

### Test Suites

| Suite | Tests | Description |
|-------|-------|-------------|
| `cache.test.ts` | 9 | Cache set/get, TTL expiry, invalidation, complex objects |
| `errors.test.ts` | 6 | Error classification for 3 error types + display helpers |
| `validation.test.ts` | 4 | Stellar address validation, amount validation, MAX calculation |

Run tests:
```bash
npm test          # single run
npm run test:watch  # watch mode
```

## Screenshots

### Wallet Options Available
![Wallet Options](./screenshots/wallet-options.png)

### Wallet Connected with Balance
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
│   ├── page.tsx                # Main page (Tab: Pay / Vote)
│   └── globals.css             # Global styles + animations
├── __tests__/
│   ├── cache.test.ts           # Cache layer tests (9 tests)
│   ├── errors.test.ts          # Error classification tests (6 tests)
│   └── validation.test.ts      # Input validation tests (4 tests)
├── components/
│   ├── WalletConnect.tsx       # Multi-wallet connect (StellarWalletsKit)
│   ├── BalanceDisplay.tsx      # XLM balance display
│   ├── SendPayment.tsx         # Payment form
│   ├── TransactionResult.tsx   # Transaction result display
│   └── poll/
│       ├── PollCard.tsx        # Voting UI + transaction status
│       ├── PollResults.tsx     # Live results bar chart
│       └── EventFeed.tsx       # Real-time event stream
├── context/
│   └── WalletContext.tsx       # Wallet state management
├── hooks/
│   ├── usePollContract.ts      # Contract read/write hook (with cache)
│   └── useContractEvents.ts    # Event polling hook
├── lib/
│   ├── stellar.ts              # Horizon SDK (balance, payments)
│   ├── wallet-kit.ts           # StellarWalletsKit initialization
│   ├── poll-contract.ts        # Soroban RPC contract calls
│   ├── cache.ts                # In-memory cache with TTL
│   └── errors.ts               # 3 typed error classes
├── contracts/poll/
│   ├── Cargo.toml              # Rust project config
│   └── src/lib.rs              # Soroban poll contract
├── vitest.config.ts            # Test configuration
└── .env.example                # Environment template
```

## Error Handling

| Error Type | Trigger | User Message |
|-----------|---------|--------------|
| WalletNotFoundError | No wallet extension detected | "Please install Freighter, xBull, or Albedo" |
| TransactionRejectedError | User cancels wallet popup | "Transaction was rejected or cancelled" |
| InsufficientBalanceError | Balance too low | "Insufficient balance. Required: X XLM" |

## License

MIT
