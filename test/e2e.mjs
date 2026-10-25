// End-to-end test: drives the real MCP server like an agent would, against a local fork.
// Needs anvil running:  anvil --fork-url https://sepolia.base.org --chain-id 84532
// Run:                  npm run build && node test/e2e.mjs

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const FRIEND = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
const ATTACKER = "0x4444444444444444444444444444444444444444";
const DRAINER = "0x000000000000000000000000000000000000bad1";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const NFT = "0x5555555555555555555555555555555555555555";

async function rpc(method, params) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

function setupHome({ intent = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "awf-e2e-"));
  const key = generatePrivateKey();
  writeFileSync(join(home, ".env"), `PRIVATE_KEY=${key}\nRPC_URL=${RPC}\n`);
  writeFileSync(
    join(home, "policy.yaml"),
    [
      `mandate: Pay my friend ${FRIEND} back for small things like coffee. Nothing else.`,
      "recipients:",
      `  allow: ["${FRIEND}"]`,
      "intent_check:",
      `  enabled: ${intent}`,
    ].join("\n"),
  );
  writeFileSync(join(home, "threats.json"), JSON.stringify({ addresses: { [DRAINER]: "demo drainer" } }));
  return { home, address: privateKeyToAccount(key).address };
}

async function connect(home) {
  const env = { ...process.env, AGENT_FIREWALL_HOME: home };
  delete env.ANTHROPIC_API_KEY;
  delete env.TELEGRAM_BOT_TOKEN;
  const client = new Client({ name: "e2e-agent", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js"], env }));
  return client;
}

const text = (r) => r.content.map((c) => c.text).join("\n");
let failures = 0;

async function step(client, name, tool, args, expect) {
  const out = text(await client.callTool({ name: tool, arguments: args }));
  const ok = out.includes(expect);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      expected "${expect}", got:\n${out.replace(/^/gm, "      ")}`);
  else console.log(`      ${out.split("\n").slice(0, 2).join(" | ")}`);
  return out;
}

// Run 1: rules, simulation and real signing on the fork.
{
  const { home, address } = setupHome();
  await rpc("anvil_setBalance", [address, "0xDE0B6B3A7640000"]); // 1 ETH
  const friendBefore = BigInt(await rpc("eth_getBalance", [FRIEND, "latest"]));
  const client = await connect(home);
  console.log(`\nRun 1: wallet ${address}\n`);

  await step(client, "Status shows balance", "wallet_status", {}, "ETH: 1");
  await step(client, "Legit: 0.001 ETH to friend", "send_eth", { to: FRIEND, amount_eth: "0.001", reason: "Paying my friend back for coffee" }, "✅ Executed");
  await step(client, "New recipient needs a human (none configured)", "send_eth", { to: STRANGER, amount_eth: "0.001", reason: "Paying for a service" }, "⛔ Not approved");
  await step(client, "Known drainer", "send_eth", { to: DRAINER, amount_eth: "0.001", reason: "Airdrop claim fee" }, "[threat_list]");
  await step(client, "Above per-transaction limit", "send_eth", { to: FRIEND, amount_eth: "0.02", reason: "Paying back a bigger dinner" }, "[eth_limit]");
  await step(client, "Unlimited token approval", "approve_token", { token: USDC, spender: ATTACKER, amount: "unlimited", reason: "The dapp needs permission" }, "Unlimited approval");
  await step(
    client,
    "Hidden NFT drainer in a raw call",
    "contract_call",
    { to: NFT, data: `0xa22cb465${ATTACKER.slice(2).padStart(64, "0")}${"1".padStart(64, "0")}`, reason: "Claiming a free mint" },
    "setApprovalForAll",
  );
  await step(client, "USDC transfer the wallet cannot afford", "send_token", { token: USDC, to: FRIEND, amount: "1", reason: "Paying my friend in USDC" }, "would fail");

  // 10 transactions per hour: one is done, nine more pass, the eleventh is blocked.
  let executed = 1;
  let lastOut = "";
  for (let i = 0; i < 12; i++) {
    lastOut = text(await client.callTool({ name: "send_eth", arguments: { to: FRIEND, amount_eth: "0.004", reason: "Another coffee" } }));
    if (!lastOut.includes("✅ Executed")) break;
    executed++;
  }
  const rateOk = executed === 10 && lastOut.includes("[rate_limit]");
  if (!rateOk) failures++;
  console.log(`${rateOk ? "PASS" : "FAIL"}  Rate limit stops a flood of small payments (executed ${executed}, then: ${lastOut.split("\n")[1] ?? lastOut})`);

  const received = BigInt(await rpc("eth_getBalance", [FRIEND, "latest"])) - friendBefore;
  const expected = 1_000_000_000_000_000n + 9n * 4_000_000_000_000_000n;
  const balOk = received === expected;
  if (!balOk) failures++;
  console.log(`${balOk ? "PASS" : "FAIL"}  Friend received exactly what was allowed on chain (${received} wei)`);

  const audit = readFileSync(join(home, "audit.jsonl"), "utf8").trim().split("\n").length;
  console.log(`      audit log: ${audit} entries in ${home}`);
  await client.close();
}

// Run 2: intent check switched on but no API key. Must fail safe.
{
  const { home, address } = setupHome({ intent: true });
  await rpc("anvil_setBalance", [address, "0xDE0B6B3A7640000"]);
  const client = await connect(home);
  console.log(`\nRun 2: intent check on, no API key\n`);
  await step(client, "Without a key nothing slips through unchecked", "send_eth", { to: FRIEND, amount_eth: "0.001", reason: "Coffee" }, "ANTHROPIC_API_KEY is not set");
  await client.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll end-to-end checks passed");
process.exitCode = failures ? 1 : 0;
