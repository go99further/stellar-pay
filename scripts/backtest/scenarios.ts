import type { DecodedAmmEvent, RiskLevel } from "../../lib/agent/security-core";

export interface ExpectedDetections {
  priceImpact?: RiskLevel;
  liquidityFlow?: RiskLevel;
  anomaly?: RiskLevel;
  sandwich?: RiskLevel;
  flaggedAddresses?: string[];
  sandwichAttackers?: string[];
}

export interface BacktestScenario {
  id: string;
  category: "normal" | "attack" | "edge";
  name: string;
  description: string;
  reserveA: bigint;
  reserveB: bigint;
  events: DecodedAmmEvent[];
  probeSwap?: { tokenIn: "TKNA" | "TKNB"; amountIn: bigint };
  expected: ExpectedDetections;
}

const UNIT = 10_000_000n;

const ADDR = {
  alice: "GALICE" + "X".repeat(50),
  bob: "GBOB" + "X".repeat(52),
  carol: "GCAROL" + "X".repeat(50),
  attacker: "GATTACKER" + "X".repeat(47),
  whale: "GWHALE" + "X".repeat(50),
} as const;

function swap(
  ledger: number,
  user: string,
  tokenIn: "TKNA" | "TKNB",
  amountIn: bigint,
  amountOut: bigint
): DecodedAmmEvent {
  return { kind: "swap", ledger, user, tokenIn, amountIn, amountOut };
}

function addLiq(
  ledger: number,
  provider: string,
  amountA: bigint,
  amountB: bigint,
  lp: bigint
): DecodedAmmEvent {
  return { kind: "add_liq", ledger, provider, amountA, amountB, lpAmount: lp };
}

function remLiq(
  ledger: number,
  provider: string,
  amountA: bigint,
  amountB: bigint,
  lp: bigint
): DecodedAmmEvent {
  return { kind: "rem_liq", ledger, provider, amountA, amountB, lpAmount: lp };
}

export const SCENARIOS: BacktestScenario[] = [
  {
    id: "S01_normal_trading",
    category: "normal",
    name: "Normal light trading",
    description:
      "A few small swaps from different users, no liquidity removals.",
    reserveA: 100_000n * UNIT,
    reserveB: 100_000n * UNIT,
    events: [
      swap(100, ADDR.alice, "TKNA", 50n * UNIT, 49n * UNIT),
      swap(102, ADDR.bob, "TKNB", 30n * UNIT, 29n * UNIT),
      swap(105, ADDR.carol, "TKNA", 20n * UNIT, 19n * UNIT),
    ],
    probeSwap: { tokenIn: "TKNA", amountIn: 100n * UNIT },
    expected: {
      priceImpact: "low",
      liquidityFlow: "low",
      anomaly: "low",
      sandwich: "low",
    },
  },
  {
    id: "S02_whale_price_impact",
    category: "attack",
    name: "Whale swap causing high price impact",
    description:
      "A single user attempts to swap 20% of reserves — expect HIGH price impact.",
    reserveA: 100_000n * UNIT,
    reserveB: 100_000n * UNIT,
    events: [],
    probeSwap: { tokenIn: "TKNA", amountIn: 20_000n * UNIT },
    expected: {
      priceImpact: "high",
    },
  },
  {
    id: "S03_sandwich_attack",
    category: "attack",
    name: "Classic sandwich attack",
    description:
      "Attacker buys TKNA before a victim's TKNA buy, then sells TKNA right after.",
    reserveA: 100_000n * UNIT,
    reserveB: 100_000n * UNIT,
    events: [
      swap(200, ADDR.attacker, "TKNB", 5_000n * UNIT, 4_500n * UNIT), // front-run: buy TKNA
      swap(201, ADDR.alice, "TKNB", 1_000n * UNIT, 850n * UNIT),       // victim
      swap(202, ADDR.attacker, "TKNA", 4_500n * UNIT, 5_200n * UNIT),  // back-run: sell TKNA
    ],
    expected: {
      sandwich: "medium",
      sandwichAttackers: [ADDR.attacker],
    },
  },
  {
    id: "S04_multi_sandwich",
    category: "attack",
    name: "Multiple sandwich attacks in a session",
    description:
      "Attacker performs 2 sandwich attacks within the recent window.",
    reserveA: 100_000n * UNIT,
    reserveB: 100_000n * UNIT,
    events: [
      swap(300, ADDR.attacker, "TKNB", 3_000n * UNIT, 2_800n * UNIT),
      swap(301, ADDR.bob, "TKNB", 500n * UNIT, 450n * UNIT),
      swap(302, ADDR.attacker, "TKNA", 2_800n * UNIT, 3_100n * UNIT),

      swap(310, ADDR.attacker, "TKNA", 4_000n * UNIT, 3_700n * UNIT),
      swap(311, ADDR.carol, "TKNA", 600n * UNIT, 540n * UNIT),
      swap(312, ADDR.attacker, "TKNB", 3_700n * UNIT, 4_200n * UNIT),
    ],
    expected: {
      sandwich: "high",
      sandwichAttackers: [ADDR.attacker],
    },
  },
  {
    id: "S05_liquidity_drain",
    category: "attack",
    name: "Whale drains >20% of liquidity",
    description:
      "A whale removes a huge chunk of liquidity in recent window — expect HIGH outflow + flagged address.",
    reserveA: 100_000n * UNIT,
    reserveB: 100_000n * UNIT,
    events: [
      remLiq(400, ADDR.whale, 25_000n * UNIT, 25_000n * UNIT, 25_000n * UNIT),
    ],
    expected: {
      liquidityFlow: "high",
      anomaly: "medium",
      flaggedAddresses: [ADDR.whale],
    },
  },
  {
    id: "S06_moderate_outflow",
    category: "edge",
    name: "Moderate outflow (10%)",
    description:
      "Single LP removes ~10% — borderline case, expect MEDIUM outflow.",
    reserveA: 100_000n * UNIT,
    reserveB: 100_000n * UNIT,
    events: [
      remLiq(500, ADDR.bob, 10_000n * UNIT, 10_000n * UNIT, 10_000n * UNIT),
    ],
    expected: {
      liquidityFlow: "medium",
      anomaly: "medium",
      flaggedAddresses: [ADDR.bob],
    },
  },
  {
    id: "S07_scattered_small_removals",
    category: "normal",
    name: "Many small removals by different users",
    description:
      "No single address removes > 5%; each removes 1-2% of reserves.",
    reserveA: 100_000n * UNIT,
    reserveB: 100_000n * UNIT,
    events: [
      remLiq(600, ADDR.alice, 1_000n * UNIT, 1_000n * UNIT, 1_000n * UNIT),
      remLiq(601, ADDR.bob, 1_500n * UNIT, 1_500n * UNIT, 1_500n * UNIT),
      remLiq(602, ADDR.carol, 2_000n * UNIT, 2_000n * UNIT, 2_000n * UNIT),
    ],
    expected: {
      liquidityFlow: "low",
      anomaly: "low",
    },
  },
  {
    id: "S08_false_positive_guard",
    category: "edge",
    name: "Same user two same-direction swaps — NOT a sandwich",
    description:
      "User buys TKNA twice in a row. Should NOT be flagged as sandwich (no opposite leg).",
    reserveA: 100_000n * UNIT,
    reserveB: 100_000n * UNIT,
    events: [
      swap(700, ADDR.alice, "TKNB", 1_000n * UNIT, 900n * UNIT),
      swap(701, ADDR.bob, "TKNB", 500n * UNIT, 450n * UNIT),
      swap(702, ADDR.alice, "TKNB", 800n * UNIT, 720n * UNIT),
    ],
    expected: {
      sandwich: "low",
    },
  },
];
