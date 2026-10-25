#!/usr/bin/env node
import { runBench } from "./bench.js";
import { init, loadEnv } from "./home.js";
import { startServer } from "./server.js";

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "init":
    init();
    break;
  case "bench":
    loadEnv();
    process.exitCode = (await runBench(args.includes("--intent"))) ? 0 : 1;
    break;
  case undefined:
  case "serve":
    // stdout belongs to the MCP protocol; everything human-readable goes to stderr.
    await startServer().catch((error) => {
      console.error(String(error instanceof Error ? error.message : error));
      process.exit(1);
    });
    break;
  default:
    console.error(`Unknown command "${command}". Use: agent-wallet-firewall [init | bench [--intent] | serve]`);
    process.exitCode = 1;
}
