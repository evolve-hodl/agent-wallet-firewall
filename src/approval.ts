import type { Decision, Proposal } from "./types.js";

/** Asks a human when a check says "ask". Resolves true only on an explicit approval. */
export interface Approver {
  readonly name: string;
  request(p: Proposal, summary: string, decision: Decision): Promise<boolean>;
}

export class NoApprover implements Approver {
  readonly name = "none";
  async request(): Promise<boolean> {
    return false;
  }
}

interface TelegramUpdate {
  update_id: number;
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { message_id: number; chat: { id: number } } };
}

/** Sends an Approve/Reject message to the owner's Telegram and waits for the tap. */
export class TelegramApprover implements Approver {
  readonly name = "telegram";
  private offset = 0;

  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly timeoutSeconds: number,
  ) {}

  private async api<T>(method: string, body: object): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
    return json.result;
  }

  async request(p: Proposal, summary: string, decision: Decision): Promise<boolean> {
    const flagged = decision.findings.filter((f) => f.verdict !== "allow").map((f) => `• ${f.reason}`);
    const text = [
      "🛡 Agent Wallet Firewall: approval needed",
      "",
      summary,
      "",
      `Agent says: ${p.reason || "(no reason given)"}`,
      "",
      ...flagged,
      "",
      `Auto-reject in ${this.timeoutSeconds}s.`,
    ].join("\n");

    const sent = await this.api<{ message_id: number }>("sendMessage", {
      chat_id: this.chatId,
      text,
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `approve:${p.id}` },
          { text: "❌ Reject", callback_data: `reject:${p.id}` },
        ]],
      },
    });

    const deadline = Date.now() + this.timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const wait = Math.max(1, Math.min(25, Math.floor((deadline - Date.now()) / 1000)));
      const updates = await this.api<TelegramUpdate[]>("getUpdates", {
        offset: this.offset,
        timeout: wait,
        allowed_updates: ["callback_query"],
      });
      for (const u of updates) {
        this.offset = u.update_id + 1;
        const cq = u.callback_query;
        // Only the owner's chat can approve.
        if (!cq?.data?.endsWith(`:${p.id}`) || String(cq.from.id) !== this.chatId) continue;
        const approved = cq.data.startsWith("approve:");
        await this.api("answerCallbackQuery", { callback_query_id: cq.id, text: approved ? "Approved" : "Rejected" });
        await this.finish(sent.message_id, text, approved ? "✅ Approved" : "❌ Rejected");
        return approved;
      }
    }
    await this.finish(sent.message_id, text, "⏱ Timed out, rejected");
    return false;
  }

  private async finish(messageId: number, text: string, result: string): Promise<void> {
    await this.api("editMessageText", { chat_id: this.chatId, message_id: messageId, text: `${text}\n\n${result}` }).catch(() => {});
  }
}
