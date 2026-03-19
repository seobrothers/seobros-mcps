import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./index";

export class GoogleDocsMcp extends McpAgent {
  server = new McpServer({
    name: "SEO Brothers - Google Docs",
    version: "0.0.1",
  });

  async init() {
    this.server.tool(
      "create_google_doc",
      "Create a Google Doc from HTML content in the SEO Brothers shared drive. " +
        "The doc will be viewable by anyone with the link and editable by @seobrothers.co members.",
      {
        title: z.string().describe("Title for the Google Doc"),
        html: z
          .string()
          .describe(
            "HTML content for the document body. Supports standard HTML formatting: " +
              "headings, paragraphs, lists, tables, bold, italic, links, etc."
          ),
      },
      async ({ title, html }) => {
        const scriptUrl = (this.env as Env).APPS_SCRIPT_CREATE_DOC_URL;
        if (!scriptUrl) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: APPS_SCRIPT_CREATE_DOC_URL is not configured.",
              },
            ],
            isError: true,
          };
        }

        const response = await fetch(scriptUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, html }),
        });

        const result = (await response.json()) as {
          success: boolean;
          docUrl?: string;
          docId?: string;
          title?: string;
          error?: string;
        };

        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to create doc: ${result.error}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Created "${result.title}"\n\nURL: ${result.docUrl}\nDoc ID: ${result.docId}`,
            },
          ],
        };
      }
    );
  }
}
