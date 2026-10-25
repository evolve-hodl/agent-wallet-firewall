import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { encodeFunctionData, erc20Abi, formatEther, formatUnits, isAddress, isHex, maxUint256, parseEther, parseUnits, type Address } from "viem";
import { z } from "zod";
import { NoApprover, TelegramApprover, type Approver } from "./approval.js";
import { AuditLog } from "./audit.js";
import { ClaudeIntentChecker, UnavailableIntentChecker, type IntentChecker } from "./checks/intent.js";
import { loadThreats } from "./checks/threats.js";
import { Firewall, formatOutcome } from "./firewall.js";
import { loadEnv, paths } from "./home.js";
import { Ledger } from "./ledger.js";
import { loadPolicy } from "./policy.js";
import { Wallet } from "./wallet.js";

const address = z.string().refine((v) => isAddress(v), "not a valid address").describe("0x address");
const reason = z.string().min(1).describe("Why you are doing this, in one sentence. The owner sees it.");
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function startServer(): Promise<void> {
  loadEnv();
  const key = process.env.PRIVATE_KEY;
  if (!key || !isHex(key)) throw new Error(`No PRIVATE_KEY found. Run "npx agent-wallet-firewall init" first (looks in ${paths.env}).`);

  const policy = loadPolicy(paths.policy);
  const wallet = new Wallet(key, process.env.RPC_URL);

  let intent: IntentChecker | undefined;
  if (!policy.intent_check.enabled) intent = undefined;
  else if (process.env.ANTHROPIC_API_KEY) intent = new ClaudeIntentChecker(policy.intent_check.model, policy.intent_check.when_unavailable);
  else intent = new UnavailableIntentChecker(policy.intent_check.when_unavailable, "Intent check is enabled but ANTHROPIC_API_KEY is not set");

  const { TELEGRAM_BOT_TOKEN: tgToken, TELEGRAM_CHAT_ID: tgChat } = process.env;
  const approver: Approver = tgToken && tgChat ? new TelegramApprover(tgToken, tgChat, policy.human_approval.timeout_seconds) : new NoApprover();

  const ledger = new Ledger(paths.state);
  const firewall = new Firewall(
    wallet,
    { policy, ledger, threats: loadThreats(paths.threats), chain: wallet, intent, wallet: wallet.address },
    approver,
    new AuditLog(paths.audit),
  );

  const server = new McpServer({ name: "agent-wallet-firewall", version: "0.1.0" });

  server.registerTool(
    "wallet_status",
    {
      title: "Wallet status",
      description: "Shows the protected wallet's address, balances, remaining daily budgets and the owner's mandate. Call this before making payments.",
      inputSchema: {},
    },
    async () => {
      const now = Date.now();
      const day = now - 24 * 3600 * 1000;
      const lines = [
        `Wallet: ${wallet.address} on ${wallet.chain.name} (testnet)`,
        `ETH: ${formatEther(await wallet.ethBalance())} (spent today ${formatEther(ledger.spentSince("eth", day))} of ${policy.limits.daily_eth})`,
      ];
      for (const [token, rule] of Object.entries(policy.limits.tokens)) {
        try {
          const info = await wallet.tokenInfo(token as Address);
          lines.push(`${rule.symbol}: ${formatUnits(info.balance, info.decimals)} (spent today ${formatUnits(ledger.spentSince(token, day), rule.decimals)} of ${rule.daily})`);
        } catch {
          lines.push(`${rule.symbol}: balance unavailable`);
        }
      }
      lines.push(`Owner's mandate: ${policy.mandate || "(none set)"}`, `Human approval: ${approver.name}`);
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "send_eth",
    {
      title: "Send ETH",
      description: "Send ETH from the protected wallet. Every transfer is checked by Agent Wallet Firewall and may be blocked or need the owner's approval.",
      inputSchema: { to: address, amount_eth: z.string().describe("Amount in ETH, e.g. '0.001'"), reason },
    },
    async ({ to, amount_eth, reason }) =>
      text(formatOutcome(await firewall.submit({ to: to as Address, value: parseEther(amount_eth) }, reason))),
  );

  server.registerTool(
    "send_token",
    {
      title: "Send ERC-20 token",
      description: "Send an ERC-20 token from the protected wallet. Checked by Agent Wallet Firewall.",
      inputSchema: { token: address.describe("Token contract address"), to: address, amount: z.string().describe("Amount in whole tokens, e.g. '5.5'"), reason },
    },
    async ({ token, to, amount, reason }) => {
      const { decimals } = await wallet.tokenInfo(token as Address);
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to as Address, parseUnits(amount, decimals)] });
      return text(formatOutcome(await firewall.submit({ to: token as Address, data, value: 0n }, reason)));
    },
  );

  server.registerTool(
    "approve_token",
    {
      title: "Approve token spending",
      description: "Allow a contract to spend an ERC-20 token from the protected wallet. Checked by Agent Wallet Firewall; unlimited approvals are blocked by default.",
      inputSchema: { token: address.describe("Token contract address"), spender: address, amount: z.string().describe("Amount in whole tokens, or 'unlimited'"), reason },
    },
    async ({ token, spender, amount, reason }) => {
      const value = amount === "unlimited" ? maxUint256 : parseUnits(amount, (await wallet.tokenInfo(token as Address)).decimals);
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender as Address, value] });
      return text(formatOutcome(await firewall.submit({ to: token as Address, data, value: 0n }, reason)));
    },
  );

  server.registerTool(
    "contract_call",
    {
      title: "Call a contract",
      description: "Send a raw transaction to a contract (for example from a dapp or an x402 payment). Agent Wallet Firewall decodes what it really does before signing.",
      inputSchema: {
        to: address,
        data: z.string().refine((v) => isHex(v), "must be 0x hex").describe("Calldata as 0x hex"),
        value_eth: z.string().default("0").describe("ETH to send along, e.g. '0'"),
        reason,
      },
    },
    async ({ to, data, value_eth, reason }) =>
      text(formatOutcome(await firewall.submit({ to: to as Address, data: data as `0x${string}`, value: parseEther(value_eth) }, reason))),
  );

  await server.connect(new StdioServerTransport());
  console.error(`agent-wallet-firewall running for ${wallet.address} on ${wallet.chain.name}`);
}
