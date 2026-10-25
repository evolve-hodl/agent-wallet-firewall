import type { Address, Hex } from "viem";
import type { Finding, Proposal } from "../types.js";

/** The few chain reads the firewall needs. Mocked in the benchmark. */
export interface ChainReader {
  getCode(address: Address): Promise<Hex | undefined>;
  simulate(tx: { to: Address; data?: Hex; value: bigint }): Promise<{ ok: true } | { ok: false; error: string }>;
}

const EIP7702_PREFIX = "0xef0100";

export async function checkSimulation(p: Proposal, chain: ChainReader): Promise<Finding[]> {
  const out: Finding[] = [];
  const result = await chain.simulate(p.tx);
  if (!result.ok) out.push({ check: "simulation", verdict: "deny", reason: `Transaction would fail: ${result.error}` });

  if (p.action.kind === "native_transfer") {
    const code = await chain.getCode(p.action.to);
    if (code && code !== "0x" && !code.toLowerCase().startsWith(EIP7702_PREFIX)) {
      out.push({ check: "simulation", verdict: "ask", reason: `${p.action.to} is a contract, not a normal wallet` });
    }
  }
  return out;
}
