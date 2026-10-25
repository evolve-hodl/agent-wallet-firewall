import {
  BaseError,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { ChainReader } from "./checks/simulation.js";

/**
 * The wallet the agent never touches directly. The key lives only in this process.
 * Version 0 runs on Base Sepolia (testnet) only.
 */
export class Wallet implements ChainReader {
  readonly chain = baseSepolia;
  readonly address: Address;
  private readonly publicClient;
  private readonly walletClient;

  constructor(privateKey: Hex, rpcUrl?: string) {
    const account = privateKeyToAccount(privateKey);
    const transport = http(rpcUrl || undefined);
    this.address = account.address;
    this.publicClient = createPublicClient({ chain: baseSepolia, transport });
    this.walletClient = createWalletClient({ account, chain: baseSepolia, transport });
  }

  explorer(hash: Hash): string {
    return `${this.chain.blockExplorers.default.url}/tx/${hash}`;
  }

  async getCode(address: Address): Promise<Hex | undefined> {
    return this.publicClient.getCode({ address });
  }

  async simulate(tx: { to: Address; data?: Hex; value: bigint }): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.publicClient.call({ account: this.address, to: tx.to, data: tx.data, value: tx.value });
      return { ok: true };
    } catch (error) {
      if (!(error instanceof BaseError)) return { ok: false, error: String(error) };
      // shortMessage alone can be vague ("Transaction creation failed"); details names the cause.
      const detail = error.details && error.details !== error.shortMessage ? `: ${error.details}` : "";
      return { ok: false, error: `${error.shortMessage.replace(/\.$/, "")}${detail}`.slice(0, 300) };
    }
  }

  async send(tx: { to: Address; data?: Hex; value: bigint }): Promise<{ hash: Hash; status: "success" | "reverted" | "pending" }> {
    const hash = await this.walletClient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value });
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      return { hash, status: receipt.status };
    } catch {
      return { hash, status: "pending" };
    }
  }

  async ethBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.address });
  }

  async tokenInfo(token: Address): Promise<{ symbol: string; decimals: number; balance: bigint }> {
    const [symbol, decimals, balance] = await Promise.all([
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [this.address] }),
    ]);
    return { symbol, decimals, balance };
  }
}
