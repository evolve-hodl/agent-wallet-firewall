import { appendFileSync } from "node:fs";

/** Append-only JSON Lines log of every decision. */
export class AuditLog {
  constructor(private readonly path?: string) {}

  write(entry: Record<string, unknown>): void {
    if (!this.path) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    appendFileSync(this.path, line + "\n");
  }
}
