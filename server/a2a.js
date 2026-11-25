// A2A (Agent2Agent, protocol 0.3.0) for Bushido-Trades.
//
// The agent card at /.well-known/agent-card.json tells A2A clients what the agent does and where to talk to it.
// POST /a2a speaks A2A JSON-RPC: `message/send` with a request such as "swap 25 USDC to AERO" (or a data part
// { sell, buy, amount, taker }) answers with how to hire that exact job: the body to POST to the x402 job endpoint
// and the payment it needs (0.01 USDC on Base). Nothing is charged or executed here; the paid job stays on
// /api/agent/job behind x402, and the caller's own wallet signs any trade.
import { randomUUID } from "node:crypto";
import { AGENT_NAME, AGENT_DESCRIPTION, parseJob, paymentRequirements } from "./agent-job.js";

export const A2A_PATH = "/a2a";
export const A2A_VERSION = "0.3.0";

/** The A2A agent card. */
export function agentCard(cfg) {
  const origin = new URL(cfg.resource).origin;
  return {
    protocolVersion: A2A_VERSION,
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    url: origin + A2A_PATH,
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    iconUrl: `${origin}/Bushido-dApp/icons/icon-512.png`,
    provider: { organization: "Bushido", url: `${origin}/` },
    documentationUrl: cfg.resource, // GET returns the job's inputs, price and payment status
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: [
      {
        id: "base-swap-quote",
        name: "Best Base swap price",
        description:
          "Quotes a swap between two coins on Base across 0x, 1inch, Uniswap and Zerion and returns the best price " +
          `with the market read, for the caller's own wallet to sign. Paid: ${cfg.priceUsdc} USDC per job on Base via ` +
          `x402 at ${cfg.resource}. Send the request here first to get the exact job body and payment details.`,
        tags: ["swap", "dex", "aggregator", "base", "x402", "trading"],
        examples: ["swap 25 USDC to AERO", "swap 0.01 ETH for USDC", '{"sell":"USDC","buy":"AERO","amount":"25"}'],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["application/json", "text/plain"],
      },
    ],
  };
}

const SWAP_TEXT = /(?:swap|sell|trade|convert)?\s*(\d+(?:\.\d+)?)\s+(\S+)\s+(?:to|for|into)\s+(\S+)/i;

/** "swap 25 USDC to AERO" -> { sell, buy, amount }, or null. */
export function parseSwapText(text) {
  const m = String(text || "").match(SWAP_TEXT);
  return m ? { amount: m[1], sell: m[2], buy: m[3] } : null;
}

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Answer one A2A JSON-RPC request (pure: no network, nothing charged). */
export function handleA2A(cfg, body) {
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(body?.id, -32600, "Invalid Request");
  }
  const { id, method, params } = body;
  if (method === "tasks/get" || method === "tasks/cancel") {
    return rpcError(id, -32001, "Task not found: this agent answers with messages, not tasks");
  }
  if (method !== "message/send") return rpcError(id, -32601, `Method not found: ${method} (use message/send)`);
  const msg = params?.message;
  if (!msg || !Array.isArray(msg.parts))
    return rpcError(id, -32602, "Invalid params: params.message.parts is required");

  const data = msg.parts.find((p) => p?.kind === "data" && p.data && typeof p.data === "object")?.data;
  const text = msg.parts
    .filter((p) => p?.kind === "text")
    .map((p) => p.text)
    .join(" ");
  const ask = data || parseSwapText(text);
  const reply = (parts) => ({
    jsonrpc: "2.0",
    id,
    result: {
      kind: "message",
      role: "agent",
      messageId: randomUUID(),
      ...(msg.contextId ? { contextId: msg.contextId } : {}),
      parts,
    },
  });

  if (!ask) {
    return reply([
      {
        kind: "text",
        text: 'Tell me the swap, for example "swap 25 USDC to AERO", or send a data part { sell, buy, amount, taker }.',
      },
    ]);
  }
  const job = prepareJob(cfg, ask);
  if (job.error) return reply([{ kind: "text", text: `Can't quote that: ${job.error}.` }]);
  return reply([
    { kind: "text", text: job.text },
    { kind: "data", data: { hire: job.hire, payment: job.payment } },
  ]);
}

/**
 * Shared by A2A and MCP: check a requested job against the Base coin list and describe how to hire it.
 * -> { error } or { text, hire: { method, url, body }, payment }. Nothing is charged or executed.
 */
export function prepareJob(cfg, ask) {
  const parsed = parseJob(ask || {});
  if (parsed.error) return { error: parsed.error };
  const j = parsed.input;
  const taker = j.taker ? { taker: j.taker } : {};
  const body =
    j.mode === "swap"
      ? { sell: j.sell.symbol, buy: j.buy.symbol, amount: j.amount, ...taker }
      : { asset: j.asset, amountUsd: j.amountUsd, ...taker };
  const what =
    j.mode === "swap" ? `${j.amount} ${j.sell.symbol} to ${j.buy.symbol}` : `an ETH signal trade of $${j.amountUsd}`;
  return {
    text:
      `Ready to quote ${what} on Base. It is a paid job: POST the body below to ${cfg.resource} with an x402 ` +
      `X-PAYMENT header for ${cfg.priceUsdc} USDC on Base (pay to ${cfg.payTo}). Add "taker" (your wallet) to get ` +
      "a signable transaction.",
    hire: { method: "POST", url: cfg.resource, body },
    payment: paymentRequirements(cfg),
  };
}

/** Express handlers. */
export function a2aRoutes(cfg) {
  return {
    card(_req, res) {
      res.json(agentCard(cfg));
    },
    rpc(req, res) {
      res.json(handleA2A(cfg, req.body));
    },
  };
}
