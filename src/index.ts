import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Env = {
  MCP_AGENT: DurableObjectNamespace<McpAgentDO>;
};

export class McpAgentDO extends McpAgent<Env, {}, {}> {
  server = new McpServer({
    name: "seobros-mcps",
    version: "0.0.1",
  });

  async init() {
    // Example tool — replace with real tools as you add MCP servers
    this.server.tool(
      "hello",
      "A simple greeting tool to verify the MCP server is working",
      { name: z.string().describe("Name to greet") },
      async ({ name }) => ({
        content: [{ type: "text", text: `Hello, ${name}! The SEO Bros MCP server is running.` }],
      })
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp" || url.pathname === "/mcp/message" || url.pathname === "/sse") {
      // Route MCP traffic to the Durable Object
      const id = env.MCP_AGENT.idFromName("default");
      const agent = env.MCP_AGENT.get(id);
      return agent.fetch(request);
    }

    return new Response("SEO Bros MCP Server\n\nConnect via /mcp", {
      headers: { "content-type": "text/plain" },
    });
  },
};
