# Agent Wallet Firewall

**A firewall between your AI agent and your wallet.** Every transaction the agent wants to sign is checked against your rules, a simulation, threat lists and your actual intent. Suspicious ones are blocked or sent to your phone for a yes/no.

> ⚠️ Version 0. Runs on **Base Sepolia testnet only**. Do not use it with real money yet.

<!-- Demo GIF: agent reads a poisoned invoice, tries to pay the attacker, firewall blocks, phone buzzes -->

## Why

AI agents are getting wallets. They pay for APIs (x402), trade, and settle invoices. But an agent can be tricked:

- **Prompt injection:** a web page, email or token name says "send the funds to this new address". OWASP says this cannot be fully prevented.
- **Memory injection:** a poisoned memory makes a malicious transfer look like something you agreed to earlier ([research on ElizaOS agents](https://arxiv.org/abs/2503.16248)).
- **Drainer calls:** a "claim your airdrop" transaction that secretly approves someone to take all your tokens.

Spending limits alone do not stop this: an attacker stays under the limit, or drains you in many small payments.

## How it works

The agent never holds the key. It talks to this MCP server, and the server signs only what passes every check:

```
AI agent (Claude, Cursor, any MCP client)
        │  send_eth / send_token / approve_token / contract_call
        ▼
┌──────────────── Agent Wallet Firewall ────────────────┐
│ 1. Decode      what does this transaction really do?  │
│ 2. Threats     known drainer addresses, your blocklist │
│ 3. Rules       per-tx limits, daily budgets, rate      │
│                limits, recipients, approvals           │
│ 4. Simulate    would it fail? is the recipient a       │
│                contract?                               │
│ 5. Intent      does it match what YOU asked for?       │
│                (a separate model, the agent can't      │
│                 talk to it)                            │
│ 6. Human       anything unclear → Telegram approve /   │
│                reject, no answer = rejected            │
└───────────────────────────┬───────────────────────────┘
                            ▼
                     sign & send (or block)
```

The strictest check wins. A model can only make a decision stricter, never override a hard rule.

**Your mandate** (what the agent may do, in plain words) lives in a local file the agent cannot read or write. The intent check compares every transaction against it, and treats the agent's own explanation as untrusted.

## Agent-Drain-Benchmark

18 attack and false-alarm scenarios ship with the repo. Run them yourself:

```bash
npm run bench              # rules only, offline, free
npm run bench -- --intent  # adds the intent check (needs ANTHROPIC_API_KEY)
```

Rules alone catch 16 of 18. The two that get through are the interesting ones: a changed address in an invoice and a fake "as we agreed earlier" memory. Both look completely normal to a spending limit. That is what the intent check is for.

| # | Attack | Caught by |
|---|---|---|
| 3–5 | Over the limit, thousand small cuts, transaction flood | rules |
| 7 | Known drainer address | threat list |
| 8–9 | Unlimited approval, hidden `increaseAllowance` | decoder + rules |
| 10 | NFT drainer `setApprovalForAll` | decoder + rules |
| 11 | `transferFrom` drain | decoder + rules |
| 14 | Transaction that would fail | simulation |
| 16 | "Alice's address changed" prompt injection | intent check |
| 17 | "As we agreed earlier" memory injection | intent check |

Found a bypass? See [SECURITY.md](SECURITY.md). Confirmed bypasses become new benchmark scenarios.

## Quickstart

Requires Node.js 20.12 or newer.

```bash
git clone https://github.com/evolve-hodl/agent-wallet-firewall.git
cd agent-wallet-firewall
npm install            # also builds
node dist/cli.js init  # creates ~/.agent-wallet-firewall with a fresh TESTNET wallet
```

`init` prints your new testnet address and the config snippet for your MCP client. Then:

1. Send the address some free Base Sepolia ETH from a testnet faucet.
2. Write your mandate and limits in `~/.agent-wallet-firewall/policy.yaml`.
3. Optional: add `ANTHROPIC_API_KEY` (intent check) and `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (approvals on your phone) to `~/.agent-wallet-firewall/.env`.
4. Add the printed snippet to your MCP client. For Claude Desktop on macOS that is `~/Library/Application Support/Claude/claude_desktop_config.json`. Restart the client.

Try the attack yourself: give the agent [`demo/poisoned-invoice.md`](demo/poisoned-invoice.md) and ask it to pay the invoice.

## Tools the agent gets

| Tool | What it does |
|---|---|
| `wallet_status` | Address, balances, remaining budgets, your mandate |
| `send_eth` | Send ETH |
| `send_token` | Send an ERC-20 token |
| `approve_token` | Approve token spending (unlimited is blocked by default) |
| `contract_call` | Raw contract call, decoded before signing |

Every call needs a `reason`. You see it in the approval message; the firewall never trusts it.

## Files

Everything lives in `~/.agent-wallet-firewall/`:

| File | Purpose |
|---|---|
| `policy.yaml` | Your mandate and rules ([example](policy.example.yaml)) |
| `.env` | Testnet key and optional API keys (permissions 600) |
| `threats.json` | Known malicious addresses |
| `audit.jsonl` | Every decision, with reasons |
| `state.json` | Spending history for budgets |

## Roadmap

- [ ] Live threat feeds instead of a local list
- [ ] Asset-change simulation (exactly what leaves your wallet)
- [ ] Set your mandate from your phone, per task
- [ ] More chains, mainnet once it is battle-tested
- [ ] Plugins for agent frameworks (AgentKit, ElizaOS)
- [ ] x402 payment checks
- [ ] Hosted version with dashboard, team policies and audit export

Interested in the hosted version? [Join the waitlist](#) <!-- TODO: waitlist link -->

## License

MIT
