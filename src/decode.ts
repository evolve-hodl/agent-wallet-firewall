import { decodeFunctionData, formatEther, formatUnits, parseAbi, type Address, type Hex } from "viem";
import type { Action } from "./types.js";
import type { Policy } from "./policy.js";

// The calls drainers hide inside "claim your airdrop" transactions.
const abi = parseAbi([
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function setApprovalForAll(address operator, bool approved)",
]);

export const UNLIMITED_THRESHOLD = 2n ** 255n;

/** Turns a raw transaction into what it actually does. */
export function classify(to: Address, data: Hex | undefined, value: bigint): Action {
  if (!data || data === "0x") return { kind: "native_transfer", to, value };
  try {
    const call = decodeFunctionData({ abi, data });
    switch (call.functionName) {
      case "transfer":
        return { kind: "erc20_transfer", token: to, to: call.args[0], amount: call.args[1] };
      case "transferFrom":
        return { kind: "erc20_transfer", token: to, from: call.args[0], to: call.args[1], amount: call.args[2] };
      case "approve":
      case "increaseAllowance":
        return { kind: "erc20_approve", token: to, spender: call.args[0], amount: call.args[1] };
      case "setApprovalForAll":
        return { kind: "set_approval_for_all", collection: to, operator: call.args[0], approved: call.args[1] };
    }
  } catch {
    // Not one of the known calls: stays a generic contract call.
  }
  return { kind: "contract_call", to, data, value };
}

/** Every address a transaction touches, for threat and block lists. */
export function involvedAddresses(action: Action): Address[] {
  switch (action.kind) {
    case "native_transfer":
      return [action.to];
    case "erc20_transfer":
      return action.from ? [action.token, action.to, action.from] : [action.token, action.to];
    case "erc20_approve":
      return [action.token, action.spender];
    case "set_approval_for_all":
      return [action.collection, action.operator];
    case "contract_call":
      return [action.to];
  }
}

function tokenAmount(policy: Policy, token: Address, amount: bigint): string {
  const rule = policy.limits.tokens[token.toLowerCase()];
  if (amount >= UNLIMITED_THRESHOLD) return `UNLIMITED ${rule?.symbol ?? "tokens"}`;
  return rule ? `${formatUnits(amount, rule.decimals)} ${rule.symbol}` : `${amount} base units of unknown token ${token}`;
}

/** One line a human (or the intent model) can read. */
export function describe(action: Action, policy: Policy): string {
  switch (action.kind) {
    case "native_transfer":
      return `Send ${formatEther(action.value)} ETH to ${action.to}`;
    case "erc20_transfer":
      return action.from
        ? `Move ${tokenAmount(policy, action.token, action.amount)} from ${action.from} to ${action.to} (transferFrom)`
        : `Send ${tokenAmount(policy, action.token, action.amount)} to ${action.to}`;
    case "erc20_approve":
      return `Allow ${action.spender} to spend ${tokenAmount(policy, action.token, action.amount)} (token ${action.token})`;
    case "set_approval_for_all":
      return action.approved
        ? `Give ${action.operator} control over ALL items of collection ${action.collection}`
        : `Revoke ${action.operator} control over collection ${action.collection}`;
    case "contract_call":
      return `Call contract ${action.to} with ${formatEther(action.value)} ETH and data ${action.data.slice(0, 10)}...`;
  }
}
