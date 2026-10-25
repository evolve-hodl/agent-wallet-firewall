import { existsSync, readFileSync } from "node:fs";
import { involvedAddresses } from "../decode.js";
import type { Policy } from "../policy.js";
import type { Finding, Proposal } from "../types.js";

/** Known bad addresses, address (lowercase) -> label. */
export type ThreatList = Map<string, string>;

export function loadThreats(path: string): ThreatList {
  if (!existsSync(path)) return new Map();
  const raw = JSON.parse(readFileSync(path, "utf8")) as { addresses?: Record<string, string> };
  return new Map(Object.entries(raw.addresses ?? {}).map(([addr, label]) => [addr.toLowerCase(), label]));
}

export function checkThreats(p: Proposal, threats: ThreatList, policy: Policy): Finding[] {
  const out: Finding[] = [];
  for (const addr of involvedAddresses(p.action)) {
    const key = addr.toLowerCase();
    const label = threats.get(key);
    if (label) out.push({ check: "threat_list", verdict: "deny", reason: `${addr} is a known malicious address (${label})` });
    else if (policy.recipients.block.includes(key)) out.push({ check: "blocklist", verdict: "deny", reason: `${addr} is on your blocklist` });
  }
  return out;
}
