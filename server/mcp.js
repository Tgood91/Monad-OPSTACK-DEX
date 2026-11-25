// MCP (Model Context Protocol) server for Bushido-Trades, over Streamable HTTP at POST /mcp.
//
// Two free tools, nothing charged or executed here:
//   prepare_swap_job  checks a swap against the Base coin list and returns the exact paid job (POST body for
//                     /api/agent/job) and its x402 payment (0.01 USDC on Base). The caller's own wallet pays and signs.
//   list_base_coins   the coins the agent can trade on Base (src/dex/chains.js), optionally filtered.
// Responses are plain JSON (no SSE stream); notifications get 202 with no body; GET /mcp answers 405.
import { AGENT_NAME, AGENT_DESCRIPTION } from "./agent-job.js";
import { prepareJob } from "./a2a.js";
import { CHAINS } from "../src/dex/chains.js";

export const MCP_PATH = "/mcp";
export const MCP_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]; // newest first

const TOOLS = [
  {
    name: "prepare_swap_job",
    title: "Prepare a Bushido-Trades swap job",
    description:
      "Checks a swap between two coins on Base (symbols or addresses from the Base list) and returns the exact " +
      "paid job to send: the POST body for the Bushido-Trades x402 endpoint and the payment it needs (0.01 USDC " +
      "on Base). The paid job quotes 0x, 1inch, Uniswap and Zerion and returns the best price with the market read. " +
      "Nothing is charged by this tool.",
    inputSchema: {
      type: "object",
      properties: {
        sell: { type: "string", description: "Coin to sell, e.g. USDC" },
        buy: { type: "string", description: "Coin to buy, e.g. AERO" },
        amount: { type: "string", description: "Amount of the coin sold, e.g. 25" },
        taker: { type: "string", description: "Optional 0x wallet; the paid job then returns a signable transaction" },
      },
      required: ["sell", "buy", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "list_base_coins",
    title: "List the coins Bushido-Trades trades on Base",
    description:
      "Returns the verified Base coin list (symbol, address, decimals), optionally filtered by a search term.",
    inputSchema: {
      type: "object",
      properties: { search: { type: "string", description: "Optional filter on symbol or address" } },
      additionalProperties: false,
    },
  },
];

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const toolText = (text, structuredContent, isError = false) => ({
  content: [{ type: "text", text }],
  ...(structuredContent ? { structuredContent } : {}),
  ...(isError ? { isError: true } : {}),
});

function callTool(cfg, name, args = {}) {
  if (name === "prepare_swap_job") {
    const job = prepareJob(cfg, { sell: args.sell, buy: args.buy, amount: args.amount, taker: args.taker });
    if (job.error) return toolText(`Can't prepare that job: ${job.error}.`, null, true);
    return toolText(job.text, { hire: job.hire, payment: job.payment });
  }
  if (name === "list_base_coins") {
    const q = String(args.search || "")
      .trim()
      .toLowerCase();
    const coins = CHAINS.base.tokens
      .filter((t) => !q || t.symbol.toLowerCase().includes(q) || t.address.toLowerCase() === q)
      .map((t) => ({ symbol: t.symbol, address: t.address, decimals: t.decimals }));
    return toolText(`${coins.length} coin(s) on Base: ${coins.map((c) => c.symbol).join(", ")}`, { coins });
  }
  return null;
}

/** Answer one MCP JSON-RPC message. Returns a response object, or null for a notification (no reply). */
export function handleMcp(cfg, msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Invalid Request");
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // notification, e.g. notifications/initialized
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return ok(id, {
        protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "bushido-trades", title: AGENT_NAME, version: "1.0.0" },
        instructions: `${AGENT_DESCRIPTION} Use prepare_swap_job to get the exact paid job; pay it via x402 at ${cfg.resource}.`,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const r = callTool(cfg, params?.name, params?.arguments);
      return r ? ok(id, r) : fail(id, -32602, `Unknown tool: ${params?.name}`);
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

/** Express handlers for POST and GET /mcp. */
export function mcpRoutes(cfg) {
  return {
    post(req, res) {
      const body = req.body;
      if (Array.isArray(body)) {
        const out = body.map((m) => handleMcp(cfg, m)).filter(Boolean);
        return out.length ? res.json(out) : res.status(202).end();
      }
      const r = handleMcp(cfg, body);
      return r ? res.json(r) : res.status(202).end();
    },
    get(_req, res) {
      res.status(405).set("Allow", "POST").json({ error: "This MCP server answers POST only (no SSE stream)." });
    },
  };
}
