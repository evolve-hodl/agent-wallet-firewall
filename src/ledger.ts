import { existsSync, readFileSync, writeFileSync } from "node:fs";

interface Entry {
  ts: number;
  /** "eth" or a lowercase token address. Undefined for transactions that move no value. */
  asset?: string;
  amount?: string;
}

/** Remembers what was spent, for daily budgets and rate limits. Persists to a JSON file when given a path. */
export class Ledger {
  private entries: Entry[] = [];

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) this.entries = JSON.parse(readFileSync(path, "utf8")).entries ?? [];
  }

  spentSince(asset: string, since: number): bigint {
    return this.entries
      .filter((e) => e.asset === asset && e.ts >= since)
      .reduce((sum, e) => sum + BigInt(e.amount ?? "0"), 0n);
  }

  txSince(since: number): number {
    return this.entries.filter((e) => e.ts >= since).length;
  }

  record(ts: number, spends: { asset: string; amount: bigint }[]): void {
    if (spends.length === 0) this.entries.push({ ts });
    for (const s of spends) this.entries.push({ ts, asset: s.asset, amount: s.amount.toString() });
    // Only the last day matters for budgets.
    const cutoff = ts - 2 * 24 * 3600 * 1000;
    this.entries = this.entries.filter((e) => e.ts >= cutoff);
    if (this.path) writeFileSync(this.path, JSON.stringify({ entries: this.entries }, null, 2));
  }
}
