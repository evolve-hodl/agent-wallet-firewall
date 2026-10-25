import type { Address, Hex } from "viem";

export type Verdict = "allow" | "ask" | "deny";

/** What a transaction actually does, decoded from its calldata. */
export type Action =
  | { kind: "native_transfer"; to: Address; value: bigint }
  | { kind: "erc20_transfer"; token: Address; to: Address; amount: bigint; from?: Address }
  | { kind: "erc20_approve"; token: Address; spender: Address; amount: bigint }
  | { kind: "set_approval_for_all"; collection: Address; operator: Address; approved: boolean }
  | { kind: "contract_call"; to: Address; data: Hex; value: bigint };

export interface TxRequest {
  to: Address;
  data?: Hex;
  value: bigint;
}

export interface Proposal {
  id: string;
  action: Action;
  tx: TxRequest;
  /** The agent's own explanation. Untrusted: it may come from a manipulated agent. */
  reason: string;
}

export interface Finding {
  check: string;
  verdict: Verdict;
  reason: string;
}

export interface Decision {
  verdict: Verdict;
  findings: Finding[];
}

const severity: Record<Verdict, number> = { allow: 0, ask: 1, deny: 2 };

/** The strictest verdict wins. No check can loosen another check's result. */
export function combine(findings: Finding[]): Verdict {
  let worst: Verdict = "allow";
  for (const f of findings) if (severity[f.verdict] > severity[worst]) worst = f.verdict;
  return worst;
}
