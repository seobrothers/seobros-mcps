import { GoogleDocsMcp } from "./google-docs";
import { handleMissiveRequest } from "./missive";

export type Env = {
  MCP_OBJECT: DurableObjectNamespace<GoogleDocsMcp>;
  APPS_SCRIPT_CREATE_DOC_URL: string;
  MISSIVE_API_KEY: string;
};

// Re-export DO classes so wrangler can find them
export { GoogleDocsMcp };

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/google-docs")) {
      return GoogleDocsMcp.serve("/google-docs").fetch(request, env, ctx);
    }

    if (url.pathname.startsWith("/missive")) {
      return handleMissiveRequest(request);
    }

    return new Response(
      "SEO Bros MCP Servers\n\nAvailable endpoints:\n  /google-docs - Create Google Docs\n  /missive - Manage Missive inbox",
      { headers: { "content-type": "text/plain" } }
    );
  },
};
