import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

const TokenRule = z.object({
  symbol: z.string(),
  decimals: z.number().int().min(0).max(36),
  max_per_tx: z.number().positive(),
  daily: z.number().positive(),
});

export const PolicySchema = z.object({
  /** What the owner wants the agent to do. Set out of band, so the agent cannot change it. */
  mandate: z.string().default(""),
  limits: z
    .object({
      max_per_tx_eth: z.number().nonnegative().default(0.01),
      daily_eth: z.number().nonnegative().default(0.05),
      max_tx_per_hour: z.number().int().positive().default(10),
      /** Keyed by token contract address. Tokens not listed here always need a human. */
      tokens: z.record(z.string(), TokenRule).default({}),
    })
    .prefault({}),
  recipients: z
    .object({
      mode: z.enum(["allowlist_only", "ask_unknown", "open"]).default("ask_unknown"),
      allow: z.array(z.string()).default([]),
      block: z.array(z.string()).default([]),
    })
    .prefault({}),
  approvals: z
    .object({
      block_unlimited: z.boolean().default(true),
      allowed_spenders: z.array(z.string()).default([]),
    })
    .prefault({}),
  contract_calls: z
    .object({
      allowed_contracts: z.array(z.string()).default([]),
    })
    .prefault({}),
  human_approval: z
    .object({
      above_eth: z.number().nonnegative().default(0.005),
      timeout_seconds: z.number().int().positive().default(120),
    })
    .prefault({}),
  intent_check: z
    .object({
      enabled: z.boolean().default(true),
      model: z.string().default("claude-opus-5-5"),
      when_unavailable: z.enum(["ask", "deny", "allow"]).default("ask"),
    })
    .prefault({}),
});

export type Policy = z.infer<typeof PolicySchema>;

export function parsePolicy(input: unknown): Policy {
  const policy = PolicySchema.parse(input ?? {});
  // Addresses are compared lowercase everywhere.
  const lower = (list: string[]) => list.map((a) => a.toLowerCase());
  policy.mandate = policy.mandate.trim();
  policy.recipients.allow = lower(policy.recipients.allow);
  policy.recipients.block = lower(policy.recipients.block);
  policy.approvals.allowed_spenders = lower(policy.approvals.allowed_spenders);
  policy.contract_calls.allowed_contracts = lower(policy.contract_calls.allowed_contracts);
  policy.limits.tokens = Object.fromEntries(
    Object.entries(policy.limits.tokens).map(([addr, rule]) => [addr.toLowerCase(), rule]),
  );
  return policy;
}

export function loadPolicy(path: string): Policy {
  return parsePolicy(parse(readFileSync(path, "utf8")));
}
