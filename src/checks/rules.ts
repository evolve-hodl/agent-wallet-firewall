import { formatEther, formatUnits, parseEther, parseUnits, type Address } from "viem";
import { UNLIMITED_THRESHOLD } from "../decode.js";
import type { Ledger } from "../ledger.js";
import type { Policy } from "../policy.js";
import type { Finding, Proposal } from "../types.js";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function recipientRule(policy: Policy, to: Address): Finding | undefined {
  const addr = to.toLowerCase();
  if (policy.recipients.allow.includes(addr)) return { check: "recipients", verdict: "allow", reason: `${to} is on the allowlist` };
  switch (policy.recipients.mode) {
    case "allowlist_only":
      return { check: "recipients", verdict: "deny", reason: `${to} is not on the allowlist` };
    case "ask_unknown":
      return { check: "recipients", verdict: "ask", reason: `${to} is a new recipient` };
    case "open":
      return undefined;
  }
}

/** Deterministic limits. These never call a model and cannot be talked out of anything. */
export function checkRules(p: Proposal, policy: Policy, ledger: Ledger, now: number): Finding[] {
  const out: Finding[] = [];
  const { limits } = policy;
  const a = p.action;

  if (ledger.txSince(now - HOUR) >= limits.max_tx_per_hour) {
    out.push({ check: "rate_limit", verdict: "deny", reason: `More than ${limits.max_tx_per_hour} transactions in the last hour` });
  }

  const value = p.tx.value;
  if (value > 0n) {
    const spent = ledger.spentSince("eth", now - DAY);
    if (value > parseEther(String(limits.max_per_tx_eth))) {
      out.push({ check: "eth_limit", verdict: "deny", reason: `${formatEther(value)} ETH is above the per-transaction limit of ${limits.max_per_tx_eth} ETH` });
    } else if (spent + value > parseEther(String(limits.daily_eth))) {
      out.push({ check: "eth_budget", verdict: "deny", reason: `Daily ETH budget of ${limits.daily_eth} would be exceeded (already spent ${formatEther(spent)} ETH)` });
    } else if (value > parseEther(String(policy.human_approval.above_eth))) {
      out.push({ check: "eth_limit", verdict: "ask", reason: `${formatEther(value)} ETH is above the auto-approve threshold of ${policy.human_approval.above_eth} ETH` });
    }
  }

  switch (a.kind) {
    case "native_transfer": {
      const r = recipientRule(policy, a.to);
      if (r) out.push(r);
      break;
    }
    case "erc20_transfer": {
      const token = a.token.toLowerCase();
      const rule = limits.tokens[token];
      if (!rule) {
        out.push({ check: "token_limit", verdict: "ask", reason: `Token ${a.token} has no configured limits` });
      } else {
        const spent = ledger.spentSince(token, now - DAY);
        if (a.amount > parseUnits(String(rule.max_per_tx), rule.decimals)) {
          out.push({ check: "token_limit", verdict: "deny", reason: `${formatUnits(a.amount, rule.decimals)} ${rule.symbol} is above the per-transaction limit of ${rule.max_per_tx}` });
        } else if (spent + a.amount > parseUnits(String(rule.daily), rule.decimals)) {
          out.push({ check: "token_budget", verdict: "deny", reason: `Daily ${rule.symbol} budget of ${rule.daily} would be exceeded (already spent ${formatUnits(spent, rule.decimals)})` });
        }
      }
      if (a.from) out.push({ check: "transfer_from", verdict: "ask", reason: `Moves tokens out of ${a.from} via transferFrom` });
      const r = recipientRule(policy, a.to);
      if (r) out.push(r);
      break;
    }
    case "erc20_approve": {
      const rule = policy.limits.tokens[a.token.toLowerCase()];
      if (a.amount >= UNLIMITED_THRESHOLD && policy.approvals.block_unlimited) {
        out.push({ check: "approval", verdict: "deny", reason: `Unlimited approval for ${a.spender}. This is how most wallet drains start.` });
      } else if (
        policy.approvals.allowed_spenders.includes(a.spender.toLowerCase()) &&
        rule &&
        a.amount <= parseUnits(String(rule.max_per_tx), rule.decimals)
      ) {
        out.push({ check: "approval", verdict: "allow", reason: `Limited approval for an allowed spender` });
      } else {
        out.push({ check: "approval", verdict: "ask", reason: `Approval lets ${a.spender} move your tokens later` });
      }
      break;
    }
    case "set_approval_for_all":
      out.push(
        a.approved
          ? { check: "approval", verdict: "deny", reason: `setApprovalForAll gives ${a.operator} control over every item in the collection` }
          : { check: "approval", verdict: "allow", reason: "Revoking an approval" },
      );
      break;
    case "contract_call":
      out.push(
        policy.contract_calls.allowed_contracts.includes(a.to.toLowerCase())
          ? { check: "contract", verdict: "allow", reason: `${a.to} is an allowed contract` }
          : { check: "contract", verdict: "ask", reason: `Unknown call to contract ${a.to}` },
      );
      break;
  }
  return out;
}

/** What a proposal spends, for the ledger once it is executed. */
export function spendsOf(p: Proposal): { asset: string; amount: bigint }[] {
  const spends: { asset: string; amount: bigint }[] = [];
  if (p.tx.value > 0n) spends.push({ asset: "eth", amount: p.tx.value });
  if (p.action.kind === "erc20_transfer") spends.push({ asset: p.action.token.toLowerCase(), amount: p.action.amount });
  return spends;
}
