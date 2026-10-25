import { checkRules } from "./checks/rules.js";
import { checkSimulation, type ChainReader } from "./checks/simulation.js";
import { checkThreats, type ThreatList } from "./checks/threats.js";
import type { IntentChecker } from "./checks/intent.js";
import { describe } from "./decode.js";
import type { Ledger } from "./ledger.js";
import type { Policy } from "./policy.js";
import { combine, type Decision, type Proposal } from "./types.js";

export interface EngineContext {
  policy: Policy;
  ledger: Ledger;
  threats: ThreatList;
  chain?: ChainReader;
  intent?: IntentChecker;
  wallet: string;
  now?: () => number;
}

/**
 * Runs every check and combines them. Order: deterministic rules and lists first,
 * then simulation, then the model-based intent check (skipped if already denied).
 */
export async function evaluate(p: Proposal, ctx: EngineContext): Promise<Decision> {
  const now = ctx.now?.() ?? Date.now();
  const findings = [...checkThreats(p, ctx.threats, ctx.policy), ...checkRules(p, ctx.policy, ctx.ledger, now)];
  if (ctx.chain) findings.push(...(await checkSimulation(p, ctx.chain)));
  if (ctx.intent && combine(findings) !== "deny") {
    findings.push(
      await ctx.intent.check({
        mandate: ctx.policy.mandate,
        action: describe(p.action, ctx.policy),
        reason: p.reason,
        wallet: ctx.wallet,
      }),
    );
  }
  return { verdict: combine(findings), findings };
}
