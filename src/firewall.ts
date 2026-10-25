import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import type { Approver } from "./approval.js";
import type { AuditLog } from "./audit.js";
import { spendsOf } from "./checks/rules.js";
import { classify, describe } from "./decode.js";
import { evaluate, type EngineContext } from "./engine.js";
import type { Decision, Proposal } from "./types.js";
import type { Wallet } from "./wallet.js";

export type Outcome =
  | { status: "executed"; summary: string; decision: Decision; hash: string; url: string; chainStatus: string; approvedBy?: string }
  | { status: "blocked"; summary: string; decision: Decision }
  | { status: "rejected"; summary: string; decision: Decision; approver: string };

/** Glues the pieces together: evaluate, ask a human if needed, sign, record. */
export class Firewall {
  constructor(
    private readonly wallet: Wallet,
    private readonly ctx: EngineContext,
    private readonly approver: Approver,
    private readonly audit: AuditLog,
  ) {}

  async submit(tx: { to: Address; data?: Hex; value: bigint }, reason: string): Promise<Outcome> {
    const p: Proposal = { id: randomBytes(4).toString("hex"), action: classify(tx.to, tx.data, tx.value), tx, reason };
    const summary = describe(p.action, this.ctx.policy);
    const decision = await evaluate(p, this.ctx);
    this.audit.write({ event: "decision", id: p.id, summary, reason, tx, verdict: decision.verdict, findings: decision.findings });

    if (decision.verdict === "deny") return { status: "blocked", summary, decision };

    let approvedBy: string | undefined;
    if (decision.verdict === "ask") {
      const approved = await this.approver.request(p, summary, decision).catch((error) => {
        this.audit.write({ event: "approval_error", id: p.id, error: String(error) });
        return false;
      });
      this.audit.write({ event: "approval", id: p.id, approver: this.approver.name, approved });
      if (!approved) return { status: "rejected", summary, decision, approver: this.approver.name };
      approvedBy = this.approver.name;
    }

    const sent = await this.wallet.send(tx);
    this.ctx.ledger.record(Date.now(), spendsOf(p));
    this.audit.write({ event: "executed", id: p.id, hash: sent.hash, status: sent.status });
    return { status: "executed", summary, decision, hash: sent.hash, url: this.wallet.explorer(sent.hash), chainStatus: sent.status, approvedBy };
  }
}

/** The text the agent gets back. Clear enough that it does not try to work around a block. */
export function formatOutcome(o: Outcome): string {
  const flagged = o.decision.findings.filter((f) => f.verdict !== "allow").map((f) => `- [${f.check}] ${f.reason}`);
  switch (o.status) {
    case "executed":
      return [
        `✅ Executed: ${o.summary}`,
        o.approvedBy ? `Approved by the owner via ${o.approvedBy}.` : "Within policy, no approval needed.",
        `Status: ${o.chainStatus}`,
        `Transaction: ${o.url}`,
      ].join("\n");
    case "blocked":
      return [
        `⛔ Blocked by Agent Wallet Firewall: ${o.summary}`,
        ...flagged,
        "This transaction is not allowed by the owner's policy. Do not retry it in another form; tell the user what was blocked and why.",
      ].join("\n");
    case "rejected":
      return [
        `⛔ Not approved: ${o.summary}`,
        ...flagged,
        o.approver === "none"
          ? "This needs the owner's approval, but no approval channel (Telegram) is configured. Tell the user."
          : "The owner rejected it or did not answer in time. Do not retry; tell the user.",
      ].join("\n");
  }
}
