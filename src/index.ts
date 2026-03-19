import { GoogleDocsMcp } from "./google-docs";

export type Env = {
  MCP_OBJECT: DurableObjectNamespace<GoogleDocsMcp>;
  APPS_SCRIPT_CREATE_DOC_URL: string;
};

// Re-export DO classes so wrangler can find them
export { GoogleDocsMcp };

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/google-docs")) {
      return GoogleDocsMcp.serve("/google-docs").fetch(request, env, ctx);
    }

    // Add new MCP servers here:
    // if (url.pathname.startsWith("/something-else")) {
    //   return SomethingElseMcp.serve("/something-else").fetch(request, env, ctx);
    // }

    return new Response(
      "SEO Bros MCP Servers\n\nAvailable endpoints:\n  /google-docs - Create Google Docs",
      { headers: { "content-type": "text/plain" } }
    );
  },
};
