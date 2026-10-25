import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** Everything lives in one folder, ~/.agent-wallet-firewall by default. */
export const HOME = process.env.AGENT_FIREWALL_HOME || join(homedir(), ".agent-wallet-firewall");

export const paths = {
  env: join(HOME, ".env"),
  policy: join(HOME, "policy.yaml"),
  threats: join(HOME, "threats.json"),
  state: join(HOME, "state.json"),
  audit: join(HOME, "audit.jsonl"),
};

export function loadEnv(): void {
  if (existsSync(paths.env)) process.loadEnvFile(paths.env);
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Homebrew's versioned Cellar path breaks on upgrade; desktop apps also lack Homebrew in PATH. */
function stableNodePath(): string {
  const brewNode = "/opt/homebrew/bin/node";
  return process.execPath.includes("/Cellar/") && existsSync(brewNode) ? brewNode : process.execPath;
}

const DEMO_THREATS = {
  note: "Known malicious addresses, address -> label. Version 0 ships a demo entry only; add real feeds here.",
  addresses: {
    "0x000000000000000000000000000000000000bad1": "demo attacker used in the README",
  },
};

/** Creates the config folder, a fresh testnet wallet and example files. Never overwrites. */
export function init(): void {
  mkdirSync(HOME, { recursive: true });
  const created: string[] = [];

  if (!existsSync(paths.policy)) {
    copyFileSync(join(packageRoot, "policy.example.yaml"), paths.policy);
    created.push(paths.policy);
  }
  if (!existsSync(paths.threats)) {
    writeFileSync(paths.threats, JSON.stringify(DEMO_THREATS, null, 2) + "\n");
    created.push(paths.threats);
  }

  let address: string | undefined;
  if (!existsSync(paths.env)) {
    const key = generatePrivateKey();
    address = privateKeyToAccount(key).address;
    writeFileSync(
      paths.env,
      [
        "# Agent Wallet Firewall. TESTNET ONLY: never put a key that holds real money here.",
        `PRIVATE_KEY=${key}`,
        "RPC_URL=https://sepolia.base.org",
        "",
        "# Intent check (optional): https://console.anthropic.com",
        "ANTHROPIC_API_KEY=",
        "",
        "# Approvals on your phone (optional): create a bot with @BotFather, then get your chat id from @userinfobot",
        "TELEGRAM_BOT_TOKEN=",
        "TELEGRAM_CHAT_ID=",
        "",
      ].join("\n"),
    );
    chmodSync(paths.env, 0o600);
    created.push(paths.env);
  }

  const lines = [`Agent Wallet Firewall folder: ${HOME}`];
  for (const c of created) lines.push(`  created ${c}`);
  if (created.length === 0) lines.push("  everything already exists, nothing changed");
  if (address) {
    lines.push("", `New testnet wallet: ${address}`, "Send it some free Base Sepolia ETH from a testnet faucet (search for \"Base Sepolia faucet\").");
  }
  lines.push(
    "",
    "Next: edit policy.yaml (your mandate and limits), then add this to your MCP client config:",
    JSON.stringify({ mcpServers: { "agent-wallet-firewall": { command: stableNodePath(), args: [join(packageRoot, "dist", "cli.js")] } } }, null, 2),
  );
  console.log(lines.join("\n"));
}
