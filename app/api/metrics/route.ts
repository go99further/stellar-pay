import { NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { fetchAmmEvents } from "@/lib/amm-events";
import { decodeSwapEvent, decodeEventTopic } from "@/lib/event-decoder";
import { cache, CACHE_KEYS, CACHE_TTL } from "@/lib/cache";

const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const AMM_CONTRACT_ID = process.env.NEXT_PUBLIC_AMM_CONTRACT_ID || "";
const TOKEN_A_ID = process.env.NEXT_PUBLIC_TOKEN_A_ID || "";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

const DECIMALS = 7;

function formatAmount(raw: bigint): string {
  const str = raw.toString().padStart(DECIMALS + 1, "0");
  const intPart = str.slice(0, str.length - DECIMALS) || "0";
  const fracPart = str.slice(-DECIMALS).replace(/0+$/, "") || "0";
  return `${intPart}.${fracPart}`;
}

async function getTvl(): Promise<{ tvlA: string; tvlB: string }> {
  if (!AMM_CONTRACT_ID) return { tvlA: "0.0", tvlB: "0.0" };
  try {
    const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);
    // Use a dummy account for simulation — any funded testnet address works
    const dummyKey = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
    const account = await rpcServer.getAccount(dummyKey).catch(() => null);
    if (!account) return { tvlA: "0.0", tvlB: "0.0" };

    const contract = new StellarSdk.Contract(AMM_CONTRACT_ID);
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: "1000000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("get_reserves"))
      .setTimeout(30)
      .build();

    const sim = await rpcServer.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(sim)) return { tvlA: "0.0", tvlB: "0.0" };

    const native = StellarSdk.scValToNative(sim.result!.retval) as [unknown, unknown];
    return {
      tvlA: formatAmount(BigInt(String(native[0]))),
      tvlB: formatAmount(BigInt(String(native[1]))),
    };
  } catch {
    return { tvlA: "0.0", tvlB: "0.0" };
  }
}

export async function GET() {
  const cached = cache.get<object>(CACHE_KEYS.METRICS_SUMMARY);
  if (cached) return NextResponse.json(cached);

  try {
    const { events } = await fetchAmmEvents();

    let swapCount = 0;
    let volumeARaw = 0n;
    let volumeBRaw = 0n;
    const recentSwaps: object[] = [];

    for (const evt of events) {
      const topic1 = evt.topic[1] ? decodeEventTopic(evt.topic[1]) : "";
      if (topic1 !== "swap") continue;

      const decoded = decodeSwapEvent(evt.value);
      if (!decoded) continue;

      swapCount++;
      const isAtoB = decoded.tokenIn === TOKEN_A_ID;
      if (isAtoB) {
        volumeARaw += decoded.amountIn;
      } else {
        volumeBRaw += decoded.amountIn;
      }

      if (recentSwaps.length < 10) {
        recentSwaps.push({
          user: decoded.user.slice(0, 8) + "..." + decoded.user.slice(-4),
          direction: isAtoB ? "TKNA → TKNB" : "TKNB → TKNA",
          amountIn: formatAmount(decoded.amountIn),
          amountOut: formatAmount(decoded.amountOut),
          ledger: evt.ledger,
        });
      }
    }

    const { tvlA, tvlB } = await getTvl();

    const result = {
      swapCount,
      volumeA: formatAmount(volumeARaw),
      volumeB: formatAmount(volumeBRaw),
      tvlA,
      tvlB,
      recentSwaps,
      cachedAt: new Date().toISOString(),
    };

    cache.set(CACHE_KEYS.METRICS_SUMMARY, result, CACHE_TTL.METRICS_SUMMARY);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}
