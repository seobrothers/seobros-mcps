// Stateless MCP handler for Missive — no Durable Objects, no McpAgent, no agents framework.
// Handles JSON-RPC over HTTP with SSE-formatted responses.

// ---------------------------------------------------------------------------
// Missive API helper
// ---------------------------------------------------------------------------

async function missiveApi(
  apiKey: string,
  method: "GET" | "POST" | "DELETE" | "PATCH",
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = `https://missiveapp.com/api/v1${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const options: RequestInit = { method, headers };
  if (body && method !== "GET" && method !== "DELETE") {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Missive API error ${response.status}: ${errorText}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

// ---------------------------------------------------------------------------
// Tool result type
// ---------------------------------------------------------------------------

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Address field JSON Schema (reused in several tools)
// ---------------------------------------------------------------------------

const addressFieldSchema = {
  type: "object" as const,
  properties: {
    address: { type: "string" as const, description: "Email address" },
    name: { type: "string" as const, description: "Display name" },
  },
  required: ["address"],
};

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema format for tools/list)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  // 1. list_conversations
  {
    name: "list_conversations",
    description:
      "List conversations from a Missive mailbox or filter. You must provide at least one " +
      "mailbox/label/team filter (e.g. inbox, closed, assigned, shared_label, team_inbox, etc.). " +
      "Returns a paginated list of conversations with subjects, participants, and timestamps.",
    inputSchema: {
      type: "object" as const,
      properties: {
        inbox: { type: "boolean" as const, description: "Show conversations in your personal inbox" },
        closed: { type: "boolean" as const, description: "Show closed conversations" },
        assigned: { type: "boolean" as const, description: "Show conversations assigned to you" },
        snoozed: { type: "boolean" as const, description: "Show snoozed conversations" },
        flagged: { type: "boolean" as const, description: "Show flagged conversations" },
        trashed: { type: "boolean" as const, description: "Show trashed conversations" },
        junked: { type: "boolean" as const, description: "Show junked/spam conversations" },
        drafts: { type: "boolean" as const, description: "Show draft conversations" },
        all: { type: "boolean" as const, description: "Show all conversations (inbox + closed)" },
        shared_label: { type: "string" as const, description: "Filter by shared label ID" },
        team_inbox: { type: "string" as const, description: "Show inbox conversations for a team (team ID)" },
        team_closed: { type: "string" as const, description: "Show closed conversations for a team (team ID)" },
        team_all: { type: "string" as const, description: "Show all conversations for a team (team ID)" },
        organization: { type: "string" as const, description: "Filter by organization ID" },
        email: { type: "string" as const, description: "Filter conversations involving this email address" },
        domain: { type: "string" as const, description: "Filter conversations involving this email domain" },
        limit: { type: "number" as const, description: "Number of conversations to return (default 25, max 50)" },
        until: {
          type: "number" as const,
          description: "Unix timestamp for pagination — return conversations last active before this time",
        },
      },
      required: [],
    },
  },

  // 2. get_conversation
  {
    name: "get_conversation",
    description:
      "Get full details of a single Missive conversation by its ID, including subject, " +
      "participants, labels, assignees, team, and organization info.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conversation_id: { type: "string" as const, description: "The ID of the conversation to retrieve" },
      },
      required: ["conversation_id"],
    },
  },

  // 3. list_conversation_messages
  {
    name: "list_conversation_messages",
    description:
      "List messages within a Missive conversation. Returns message bodies, senders, " +
      "recipients, and timestamps. Use this to read email threads.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conversation_id: {
          type: "string" as const,
          description: "The ID of the conversation whose messages to list",
        },
        limit: { type: "number" as const, description: "Number of messages to return (max 10)" },
        until: {
          type: "number" as const,
          description: "Unix timestamp for pagination — return messages delivered before this time",
        },
      },
      required: ["conversation_id"],
    },
  },

  // 4. get_message
  {
    name: "get_message",
    description: "Get the full details and body of a single Missive message by its ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message_id: { type: "string" as const, description: "The ID of the message to retrieve" },
      },
      required: ["message_id"],
    },
  },

  // 5. create_draft
  {
    name: "create_draft",
    description:
      "Create a new email draft in Missive. Can also send it immediately by setting send=true. " +
      "To reply to an existing conversation, provide the conversation ID. " +
      "IMPORTANT: The body should use <div> tags for paragraphs, with <div><br></div> for " +
      "spacing between paragraphs. Do NOT use <p> tags.",
    inputSchema: {
      type: "object" as const,
      properties: {
        subject: { type: "string" as const, description: "Email subject line" },
        body: {
          type: "string" as const,
          description:
            "HTML body of the email. Use <div> tags for paragraphs and <div><br></div> " +
            "for paragraph spacing. Do NOT use <p> tags.",
        },
        from_field: { ...addressFieldSchema, description: "Sender address and name" },
        to_fields: {
          type: "array" as const,
          items: addressFieldSchema,
          description: "Array of recipient addresses",
        },
        cc_fields: {
          type: "array" as const,
          items: addressFieldSchema,
          description: "Array of CC addresses",
        },
        bcc_fields: {
          type: "array" as const,
          items: addressFieldSchema,
          description: "Array of BCC addresses",
        },
        conversation: {
          type: "string" as const,
          description: "Conversation ID to reply to. If provided, the draft is added to that conversation.",
        },
        send: {
          type: "boolean" as const,
          description: "Set to true to send the email immediately instead of saving as draft",
        },
        close: {
          type: "boolean" as const,
          description: "Set to true to close the conversation after sending",
        },
        add_shared_labels: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Array of shared label IDs to add to the conversation",
        },
        remove_shared_labels: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Array of shared label IDs to remove from the conversation",
        },
      },
      required: ["body"],
    },
  },

  // 6. send_reply
  {
    name: "send_reply",
    description:
      "Send a reply to an existing Missive conversation. This is a convenience tool that " +
      "creates a draft with send=true for the given conversation. " +
      "IMPORTANT: The body should use <div> tags for paragraphs, with <div><br></div> for " +
      "spacing between paragraphs. Do NOT use <p> tags.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conversation_id: { type: "string" as const, description: "The ID of the conversation to reply to" },
        body: {
          type: "string" as const,
          description:
            "HTML body of the reply. Use <div> tags for paragraphs and <div><br></div> " +
            "for paragraph spacing. Do NOT use <p> tags.",
        },
        from_field: {
          ...addressFieldSchema,
          description: "Sender address and name (uses default if not provided)",
        },
        to_fields: {
          type: "array" as const,
          items: addressFieldSchema,
          description: "Array of recipient addresses (uses original sender if not provided)",
        },
        subject: {
          type: "string" as const,
          description: "Override the reply subject (usually not needed)",
        },
        cc_fields: {
          type: "array" as const,
          items: addressFieldSchema,
          description: "Array of CC addresses",
        },
        close_after: {
          type: "boolean" as const,
          description: "Close the conversation after sending the reply",
        },
      },
      required: ["conversation_id", "body"],
    },
  },

  // 7. create_post
  {
    name: "create_post",
    description:
      "Create a post (internal comment/action) in a Missive conversation. Use this to close, " +
      "reopen, assign, label, or add internal notes to a conversation. Posts are visible only " +
      "to team members, not to external contacts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conversation: { type: "string" as const, description: "The ID of the conversation to post to" },
        notification: {
          type: "object" as const,
          properties: {
            title: { type: "string" as const, description: "Notification title" },
            body: { type: "string" as const, description: "Notification body text" },
          },
          required: ["title", "body"],
          description: "Push notification to send to conversation members",
        },
        text: { type: "string" as const, description: "Plain text content for the post" },
        markdown: {
          type: "string" as const,
          description: "Markdown content for the post (takes precedence over text)",
        },
        username: {
          type: "string" as const,
          description: "Display name for the post author (for bot-style posts)",
        },
        close: { type: "boolean" as const, description: "Close the conversation" },
        reopen: { type: "boolean" as const, description: "Reopen the conversation" },
        add_to_inbox: {
          type: "boolean" as const,
          description: "Add the conversation to your personal inbox",
        },
        add_to_team_inbox: {
          type: "boolean" as const,
          description: "Add the conversation to a team inbox",
        },
        team: { type: "string" as const, description: "Team ID (for team inbox operations)" },
        force_team: {
          type: "boolean" as const,
          description: "Force the conversation into the team even if rules would prevent it",
        },
        add_assignees: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Array of user IDs to assign to the conversation",
        },
        add_shared_labels: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Array of shared label IDs to add",
        },
        remove_shared_labels: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Array of shared label IDs to remove",
        },
        conversation_color: {
          type: "string" as const,
          description:
            "Set the conversation color (e.g. 'red', 'blue', 'green', 'yellow', 'purple', 'pink')",
        },
      },
      required: ["conversation"],
    },
  },

  // 8. delete_draft
  {
    name: "delete_draft",
    description: "Delete an unsent draft from Missive. This permanently removes the draft.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draft_id: { type: "string" as const, description: "The ID of the draft to delete" },
      },
      required: ["draft_id"],
    },
  },

  // 9. list_shared_labels
  {
    name: "list_shared_labels",
    description:
      "List all shared labels in Missive. Shared labels are used to categorize and " +
      "organize conversations across the team. Returns label IDs (needed for filtering " +
      "conversations and adding/removing labels), names, and colors.",
    inputSchema: {
      type: "object" as const,
      properties: {
        organization: { type: "string" as const, description: "Filter labels by organization ID" },
        limit: { type: "number" as const, description: "Number of labels to return" },
        offset: { type: "number" as const, description: "Offset for pagination" },
      },
      required: [],
    },
  },

  // 10. list_teams
  {
    name: "list_teams",
    description:
      "List all teams in the Missive organization. Returns team IDs (needed for " +
      "team_inbox and team_closed filters) and names.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // 11. list_users
  {
    name: "list_users",
    description:
      "List all users (team members) in Missive. Returns user IDs (needed for " +
      "assigning conversations), names, and email addresses.",
    inputSchema: {
      type: "object" as const,
      properties: {
        organization: { type: "string" as const, description: "Filter users by organization ID" },
        limit: { type: "number" as const, description: "Number of users to return" },
        offset: { type: "number" as const, description: "Offset for pagination" },
      },
      required: [],
    },
  },

  // 12. list_organizations
  {
    name: "list_organizations",
    description:
      "List all organizations the user belongs to in Missive. Returns organization IDs " +
      "(needed for filtering other resources by organization) and names.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // 13. search_contacts
  {
    name: "search_contacts",
    description:
      "Search contacts in a Missive contact book. Use this to find email addresses, " +
      "phone numbers, and other contact details for people and companies.",
    inputSchema: {
      type: "object" as const,
      properties: {
        contact_book: {
          type: "string" as const,
          description:
            "The ID of the contact book to search in. Use list_organizations " +
            "to find available contact book IDs.",
        },
        search: {
          type: "string" as const,
          description: "Search query to filter contacts by name, email, etc.",
        },
        limit: { type: "number" as const, description: "Number of contacts to return" },
        offset: { type: "number" as const, description: "Offset for pagination" },
      },
      required: ["contact_book"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleToolCall(
  apiKey: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (toolName) {
    // -------------------------------------------------------------------
    // 1. list_conversations
    // -------------------------------------------------------------------
    case "list_conversations": {
      try {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(args)) {
          if (value !== undefined) {
            query.set(key, String(value));
          }
        }
        const qs = query.toString();
        const path = `/conversations${qs ? `?${qs}` : ""}`;
        const data = (await missiveApi(apiKey, "GET", path)) as {
          conversations?: Array<{
            id: string;
            subject?: string;
            latest_message_subject?: string;
            messages_count?: number;
            users?: Array<{ id: string; name?: string; email?: string }>;
            assignees?: Array<{ id: string; name?: string }>;
            shared_labels?: Array<{ id: string; name?: string; color?: string }>;
            color?: string;
            created_at?: number;
            updated_at?: number;
            closed?: boolean;
            snoozed?: boolean;
            flagged?: boolean;
            team?: { id: string; name?: string };
            organization?: { id: string; name?: string };
            [key: string]: unknown;
          }>;
        };

        const convos = data.conversations ?? [];
        if (convos.length === 0) {
          return {
            content: [{ type: "text", text: "No conversations found for the given filters." }],
          };
        }

        const lines = convos.map((c, i) => {
          const subject = c.subject || c.latest_message_subject || "(no subject)";
          const status: string[] = [];
          if (c.closed) status.push("closed");
          if (c.snoozed) status.push("snoozed");
          if (c.flagged) status.push("flagged");
          const statusStr = status.length > 0 ? ` [${status.join(", ")}]` : "";
          const labels =
            c.shared_labels && c.shared_labels.length > 0
              ? ` Labels: ${c.shared_labels.map((l) => l.name).join(", ")}`
              : "";
          const assignees =
            c.assignees && c.assignees.length > 0
              ? ` Assigned: ${c.assignees.map((a) => a.name || a.id).join(", ")}`
              : "";
          const team = c.team ? ` Team: ${c.team.name || c.team.id}` : "";
          const msgs =
            c.messages_count !== undefined ? ` (${c.messages_count} messages)` : "";
          const date = c.updated_at
            ? ` | ${new Date(c.updated_at * 1000).toISOString().slice(0, 16)}`
            : "";
          return `${i + 1}. ${subject}${statusStr}${msgs}${date}\n   ID: ${c.id}${team}${assignees}${labels}`;
        });

        return {
          content: [
            { type: "text", text: `Found ${convos.length} conversation(s):\n\n${lines.join("\n\n")}` },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing conversations: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 2. get_conversation
    // -------------------------------------------------------------------
    case "get_conversation": {
      try {
        const conversation_id = args.conversation_id as string;
        const data = (await missiveApi(
          apiKey,
          "GET",
          `/conversations/${conversation_id}`
        )) as {
          conversations?: Array<{
            id: string;
            subject?: string;
            latest_message_subject?: string;
            messages_count?: number;
            closed?: boolean;
            snoozed?: boolean;
            flagged?: boolean;
            color?: string;
            assignees?: Array<{ id: string; name?: string; email?: string }>;
            shared_labels?: Array<{ id: string; name?: string; color?: string }>;
            team?: { id: string; name?: string };
            organization?: { id: string; name?: string };
            created_at?: number;
            updated_at?: number;
            [key: string]: unknown;
          }>;
        };

        const c = data.conversations?.[0];
        if (!c) {
          return {
            content: [{ type: "text", text: `Conversation ${conversation_id} not found.` }],
            isError: true,
          };
        }

        const subject = c.subject || c.latest_message_subject || "(no subject)";
        const status: string[] = [];
        if (c.closed) status.push("closed");
        if (c.snoozed) status.push("snoozed");
        if (c.flagged) status.push("flagged");
        const lines: string[] = [
          `Subject: ${subject}`,
          `ID: ${c.id}`,
          `Status: ${status.length > 0 ? status.join(", ") : "open"}`,
        ];
        if (c.messages_count !== undefined) lines.push(`Messages: ${c.messages_count}`);
        if (c.team) lines.push(`Team: ${c.team.name || c.team.id}`);
        if (c.organization)
          lines.push(`Organization: ${c.organization.name || c.organization.id}`);
        if (c.assignees && c.assignees.length > 0)
          lines.push(
            `Assignees: ${c.assignees.map((a) => a.name || a.email || a.id).join(", ")}`
          );
        if (c.shared_labels && c.shared_labels.length > 0)
          lines.push(
            `Labels: ${c.shared_labels.map((l) => `${l.name}${l.color ? ` (${l.color})` : ""}`).join(", ")}`
          );
        if (c.color) lines.push(`Color: ${c.color}`);
        if (c.created_at)
          lines.push(`Created: ${new Date(c.created_at * 1000).toISOString().slice(0, 16)}`);
        if (c.updated_at)
          lines.push(`Updated: ${new Date(c.updated_at * 1000).toISOString().slice(0, 16)}`);

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting conversation: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 3. list_conversation_messages
    // -------------------------------------------------------------------
    case "list_conversation_messages": {
      try {
        const conversation_id = args.conversation_id as string;
        const limit = args.limit as number | undefined;
        const until = args.until as number | undefined;

        const query = new URLSearchParams();
        if (limit !== undefined) query.set("limit", String(limit));
        if (until !== undefined) query.set("until", String(until));
        const qs = query.toString();
        const path = `/conversations/${conversation_id}/messages${qs ? `?${qs}` : ""}`;
        const data = (await missiveApi(apiKey, "GET", path)) as {
          messages?: Array<{
            id: string;
            subject?: string;
            preview?: string;
            body?: string;
            from_field?: { address?: string; name?: string };
            to_fields?: Array<{ address?: string; name?: string }>;
            cc_fields?: Array<{ address?: string; name?: string }>;
            delivered_at?: number;
            created_at?: number;
            is_draft?: boolean;
            [key: string]: unknown;
          }>;
        };

        const messages = data.messages ?? [];
        if (messages.length === 0) {
          return {
            content: [{ type: "text", text: "No messages found in this conversation." }],
          };
        }

        const formatted = messages.map((m, i) => {
          const from = m.from_field
            ? `${m.from_field.name || ""} <${m.from_field.address || "unknown"}>`.trim()
            : "Unknown sender";
          const to =
            m.to_fields && m.to_fields.length > 0
              ? m.to_fields
                  .map((t) => `${t.name || ""} <${t.address || "unknown"}>`.trim())
                  .join(", ")
              : "";
          const cc =
            m.cc_fields && m.cc_fields.length > 0
              ? `CC: ${m.cc_fields.map((t) => `${t.name || ""} <${t.address || "unknown"}>`.trim()).join(", ")}`
              : "";
          const date = m.delivered_at
            ? new Date(m.delivered_at * 1000).toISOString().slice(0, 16)
            : m.created_at
              ? new Date(m.created_at * 1000).toISOString().slice(0, 16)
              : "";
          const draft = m.is_draft ? " [DRAFT]" : "";
          const subject = m.subject ? `Subject: ${m.subject}` : "";
          const body = m.body || m.preview || "(no body)";

          const parts = [`--- Message ${i + 1}${draft} ---`, `From: ${from}`];
          if (to) parts.push(`To: ${to}`);
          if (cc) parts.push(cc);
          if (subject) parts.push(subject);
          if (date) parts.push(`Date: ${date}`);
          parts.push(`ID: ${m.id}`);
          parts.push(""); // blank line before body
          parts.push(body);
          return parts.join("\n");
        });

        return {
          content: [
            {
              type: "text",
              text: `${messages.length} message(s) in conversation:\n\n${formatted.join("\n\n")}`,
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing messages: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 4. get_message
    // -------------------------------------------------------------------
    case "get_message": {
      try {
        const message_id = args.message_id as string;
        const data = (await missiveApi(apiKey, "GET", `/messages/${message_id}`)) as {
          messages?: Array<{
            id: string;
            subject?: string;
            body?: string;
            preview?: string;
            from_field?: { address?: string; name?: string };
            to_fields?: Array<{ address?: string; name?: string }>;
            cc_fields?: Array<{ address?: string; name?: string }>;
            bcc_fields?: Array<{ address?: string; name?: string }>;
            delivered_at?: number;
            created_at?: number;
            is_draft?: boolean;
            attachments?: Array<{ filename?: string; url?: string; content_type?: string }>;
            [key: string]: unknown;
          }>;
        };

        const m = data.messages?.[0];
        if (!m) {
          return {
            content: [{ type: "text", text: `Message ${message_id} not found.` }],
            isError: true,
          };
        }

        const from = m.from_field
          ? `${m.from_field.name || ""} <${m.from_field.address || "unknown"}>`.trim()
          : "Unknown sender";
        const to =
          m.to_fields && m.to_fields.length > 0
            ? m.to_fields
                .map((t) => `${t.name || ""} <${t.address || "unknown"}>`.trim())
                .join(", ")
            : "";
        const cc =
          m.cc_fields && m.cc_fields.length > 0
            ? m.cc_fields
                .map((t) => `${t.name || ""} <${t.address || "unknown"}>`.trim())
                .join(", ")
            : "";
        const bcc =
          m.bcc_fields && m.bcc_fields.length > 0
            ? m.bcc_fields
                .map((t) => `${t.name || ""} <${t.address || "unknown"}>`.trim())
                .join(", ")
            : "";
        const date = m.delivered_at
          ? new Date(m.delivered_at * 1000).toISOString().slice(0, 16)
          : m.created_at
            ? new Date(m.created_at * 1000).toISOString().slice(0, 16)
            : "";
        const draft = m.is_draft ? " [DRAFT]" : "";

        const lines: string[] = [`Message${draft}`, `ID: ${m.id}`];
        if (m.subject) lines.push(`Subject: ${m.subject}`);
        lines.push(`From: ${from}`);
        if (to) lines.push(`To: ${to}`);
        if (cc) lines.push(`CC: ${cc}`);
        if (bcc) lines.push(`BCC: ${bcc}`);
        if (date) lines.push(`Date: ${date}`);
        if (m.attachments && m.attachments.length > 0) {
          lines.push(
            `Attachments: ${m.attachments.map((a) => a.filename || "unnamed").join(", ")}`
          );
        }
        lines.push("");
        lines.push(m.body || m.preview || "(no body)");

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting message: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 5. create_draft
    // -------------------------------------------------------------------
    case "create_draft": {
      try {
        const params = args as {
          subject?: string;
          body: string;
          from_field?: { address: string; name?: string };
          to_fields?: Array<{ address: string; name?: string }>;
          cc_fields?: Array<{ address: string; name?: string }>;
          bcc_fields?: Array<{ address: string; name?: string }>;
          conversation?: string;
          send?: boolean;
          close?: boolean;
          add_shared_labels?: string[];
          remove_shared_labels?: string[];
        };

        const payload: Record<string, unknown> = {
          drafts: {
            body: params.body,
            ...(params.subject && { subject: params.subject }),
            ...(params.from_field && { from_field: params.from_field }),
            ...(params.to_fields && { to_fields: params.to_fields }),
            ...(params.cc_fields && { cc_fields: params.cc_fields }),
            ...(params.bcc_fields && { bcc_fields: params.bcc_fields }),
            ...(params.conversation && { conversation: params.conversation }),
            ...(params.send !== undefined && { send: params.send }),
            ...(params.close !== undefined && { close: params.close }),
            ...(params.add_shared_labels && {
              add_shared_labels: params.add_shared_labels,
            }),
            ...(params.remove_shared_labels && {
              remove_shared_labels: params.remove_shared_labels,
            }),
          },
        };

        const data = (await missiveApi(apiKey, "POST", "/drafts", payload)) as {
          drafts?: {
            id?: string;
            subject?: string;
            conversation?: string;
            [key: string]: unknown;
          };
        };

        const draft = data.drafts;
        const action = params.send ? "Sent" : "Created draft";
        const subject = draft?.subject || params.subject || "(no subject)";
        const lines = [`${action}: ${subject}`];
        if (draft?.id) lines.push(`Draft ID: ${draft.id}`);
        if (draft?.conversation) lines.push(`Conversation ID: ${draft.conversation}`);
        if (params.to_fields)
          lines.push(
            `To: ${params.to_fields.map((t) => `${t.name || ""} <${t.address}>`.trim()).join(", ")}`
          );
        if (params.close) lines.push("Conversation will be closed.");

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating draft: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 6. send_reply
    // -------------------------------------------------------------------
    case "send_reply": {
      try {
        const params = args as {
          conversation_id: string;
          body: string;
          from_field?: { address: string; name?: string };
          to_fields?: Array<{ address: string; name?: string }>;
          subject?: string;
          cc_fields?: Array<{ address: string; name?: string }>;
          close_after?: boolean;
        };

        const payload: Record<string, unknown> = {
          drafts: {
            body: params.body,
            conversation: params.conversation_id,
            send: true,
            ...(params.subject && { subject: params.subject }),
            ...(params.from_field && { from_field: params.from_field }),
            ...(params.to_fields && { to_fields: params.to_fields }),
            ...(params.cc_fields && { cc_fields: params.cc_fields }),
            ...(params.close_after !== undefined && {
              close: params.close_after,
            }),
          },
        };

        const data = (await missiveApi(apiKey, "POST", "/drafts", payload)) as {
          drafts?: {
            id?: string;
            subject?: string;
            conversation?: string;
            [key: string]: unknown;
          };
        };

        const draft = data.drafts;
        const subject = draft?.subject || params.subject || "(reply)";
        const lines = [`Reply sent: ${subject}`];
        if (draft?.id) lines.push(`Message ID: ${draft.id}`);
        lines.push(`Conversation ID: ${params.conversation_id}`);
        if (params.to_fields)
          lines.push(
            `To: ${params.to_fields.map((t) => `${t.name || ""} <${t.address}>`.trim()).join(", ")}`
          );
        if (params.close_after) lines.push("Conversation will be closed.");

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error sending reply: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 7. create_post
    // -------------------------------------------------------------------
    case "create_post": {
      try {
        const params = args as {
          conversation: string;
          notification?: { title: string; body: string };
          text?: string;
          markdown?: string;
          username?: string;
          close?: boolean;
          reopen?: boolean;
          add_to_inbox?: boolean;
          add_to_team_inbox?: boolean;
          team?: string;
          force_team?: boolean;
          add_assignees?: string[];
          add_shared_labels?: string[];
          remove_shared_labels?: string[];
          conversation_color?: string;
        };

        const payload: Record<string, unknown> = {
          posts: {
            conversation: params.conversation,
            ...(params.notification && { notification: params.notification }),
            ...(params.text && { text: params.text }),
            ...(params.markdown && { markdown: params.markdown }),
            ...(params.username && { username: params.username }),
            ...(params.close !== undefined && { close: params.close }),
            ...(params.reopen !== undefined && { reopen: params.reopen }),
            ...(params.add_to_inbox !== undefined && {
              add_to_inbox: params.add_to_inbox,
            }),
            ...(params.add_to_team_inbox !== undefined && {
              add_to_team_inbox: params.add_to_team_inbox,
            }),
            ...(params.team && { team: params.team }),
            ...(params.force_team !== undefined && {
              force_team: params.force_team,
            }),
            ...(params.add_assignees && { add_assignees: params.add_assignees }),
            ...(params.add_shared_labels && {
              add_shared_labels: params.add_shared_labels,
            }),
            ...(params.remove_shared_labels && {
              remove_shared_labels: params.remove_shared_labels,
            }),
            ...(params.conversation_color && {
              conversation_color: params.conversation_color,
            }),
          },
        };

        const data = (await missiveApi(apiKey, "POST", "/posts", payload)) as {
          posts?: {
            id?: string;
            [key: string]: unknown;
          };
        };

        const actions: string[] = [];
        if (params.close) actions.push("closed");
        if (params.reopen) actions.push("reopened");
        if (params.add_to_inbox) actions.push("added to inbox");
        if (params.add_to_team_inbox) actions.push("added to team inbox");
        if (params.add_assignees)
          actions.push(`assigned to ${params.add_assignees.length} user(s)`);
        if (params.add_shared_labels)
          actions.push(`added ${params.add_shared_labels.length} label(s)`);
        if (params.remove_shared_labels)
          actions.push(`removed ${params.remove_shared_labels.length} label(s)`);
        if (params.conversation_color)
          actions.push(`color set to ${params.conversation_color}`);
        if (params.text || params.markdown) actions.push("note added");

        const summary = actions.length > 0 ? actions.join(", ") : "post created";

        const lines = [
          `Post created on conversation ${params.conversation}: ${summary}`,
        ];
        if (data.posts?.id) lines.push(`Post ID: ${data.posts.id}`);

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating post: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 8. delete_draft
    // -------------------------------------------------------------------
    case "delete_draft": {
      try {
        const draft_id = args.draft_id as string;
        await missiveApi(apiKey, "DELETE", `/drafts/${draft_id}`);
        return {
          content: [{ type: "text", text: `Draft ${draft_id} deleted successfully.` }],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting draft: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 9. list_shared_labels
    // -------------------------------------------------------------------
    case "list_shared_labels": {
      try {
        const params = args as {
          organization?: string;
          limit?: number;
          offset?: number;
        };

        const query = new URLSearchParams();
        if (params.organization) query.set("organization", params.organization);
        if (params.limit !== undefined) query.set("limit", String(params.limit));
        if (params.offset !== undefined) query.set("offset", String(params.offset));
        const qs = query.toString();
        const path = `/shared_labels${qs ? `?${qs}` : ""}`;
        const data = (await missiveApi(apiKey, "GET", path)) as {
          shared_labels?: Array<{
            id: string;
            name?: string;
            color?: string;
            organization?: { id: string; name?: string };
            parent?: string;
            visibility?: string;
            [key: string]: unknown;
          }>;
        };

        const labels = data.shared_labels ?? [];
        if (labels.length === 0) {
          return {
            content: [{ type: "text", text: "No shared labels found." }],
          };
        }

        const lines = labels.map((l, i) => {
          const color = l.color ? ` (${l.color})` : "";
          const org = l.organization
            ? ` | Org: ${l.organization.name || l.organization.id}`
            : "";
          const parent = l.parent ? ` | Parent: ${l.parent}` : "";
          return `${i + 1}. ${l.name || "unnamed"}${color}\n   ID: ${l.id}${org}${parent}`;
        });

        return {
          content: [
            { type: "text", text: `${labels.length} shared label(s):\n\n${lines.join("\n\n")}` },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing shared labels: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 10. list_teams
    // -------------------------------------------------------------------
    case "list_teams": {
      try {
        const data = (await missiveApi(apiKey, "GET", "/teams")) as {
          teams?: Array<{
            id: string;
            name?: string;
            organization?: { id: string; name?: string };
            [key: string]: unknown;
          }>;
        };

        const teams = data.teams ?? [];
        if (teams.length === 0) {
          return {
            content: [{ type: "text", text: "No teams found." }],
          };
        }

        const lines = teams.map((t, i) => {
          const org = t.organization
            ? ` | Org: ${t.organization.name || t.organization.id}`
            : "";
          return `${i + 1}. ${t.name || "unnamed"}\n   ID: ${t.id}${org}`;
        });

        return {
          content: [
            { type: "text", text: `${teams.length} team(s):\n\n${lines.join("\n\n")}` },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing teams: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 11. list_users
    // -------------------------------------------------------------------
    case "list_users": {
      try {
        const params = args as {
          organization?: string;
          limit?: number;
          offset?: number;
        };

        const query = new URLSearchParams();
        if (params.organization) query.set("organization", params.organization);
        if (params.limit !== undefined) query.set("limit", String(params.limit));
        if (params.offset !== undefined) query.set("offset", String(params.offset));
        const qs = query.toString();
        const path = `/users${qs ? `?${qs}` : ""}`;
        const data = (await missiveApi(apiKey, "GET", path)) as {
          users?: Array<{
            id: string;
            name?: string;
            email?: string;
            me?: boolean;
            avatar_url?: string;
            [key: string]: unknown;
          }>;
        };

        const users = data.users ?? [];
        if (users.length === 0) {
          return {
            content: [{ type: "text", text: "No users found." }],
          };
        }

        const lines = users.map((u, i) => {
          const email = u.email ? ` <${u.email}>` : "";
          const me = u.me ? " (you)" : "";
          return `${i + 1}. ${u.name || "unnamed"}${email}${me}\n   ID: ${u.id}`;
        });

        return {
          content: [
            { type: "text", text: `${users.length} user(s):\n\n${lines.join("\n\n")}` },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing users: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 12. list_organizations
    // -------------------------------------------------------------------
    case "list_organizations": {
      try {
        const data = (await missiveApi(apiKey, "GET", "/organizations")) as {
          organizations?: Array<{
            id: string;
            name?: string;
            [key: string]: unknown;
          }>;
        };

        const orgs = data.organizations ?? [];
        if (orgs.length === 0) {
          return {
            content: [{ type: "text", text: "No organizations found." }],
          };
        }

        const lines = orgs.map(
          (o, i) => `${i + 1}. ${o.name || "unnamed"}\n   ID: ${o.id}`
        );

        return {
          content: [
            { type: "text", text: `${orgs.length} organization(s):\n\n${lines.join("\n\n")}` },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing organizations: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // -------------------------------------------------------------------
    // 13. search_contacts
    // -------------------------------------------------------------------
    case "search_contacts": {
      try {
        const params = args as {
          contact_book: string;
          search?: string;
          limit?: number;
          offset?: number;
        };

        const query = new URLSearchParams();
        query.set("contact_book", params.contact_book);
        if (params.search) query.set("search", params.search);
        if (params.limit !== undefined) query.set("limit", String(params.limit));
        if (params.offset !== undefined) query.set("offset", String(params.offset));
        const path = `/contacts?${query.toString()}`;
        const data = (await missiveApi(apiKey, "GET", path)) as {
          contacts?: Array<{
            id: string;
            first_name?: string;
            last_name?: string;
            email_addresses?: Array<{ address?: string; label?: string }>;
            phone_numbers?: Array<{ number?: string; label?: string }>;
            company?: string;
            title?: string;
            notes?: string;
            [key: string]: unknown;
          }>;
        };

        const contacts = data.contacts ?? [];
        if (contacts.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: params.search
                  ? `No contacts found matching "${params.search}".`
                  : "No contacts found in this contact book.",
              },
            ],
          };
        }

        const lines = contacts.map((c, i) => {
          const name =
            [c.first_name, c.last_name].filter(Boolean).join(" ") || "unnamed";
          const emails =
            c.email_addresses && c.email_addresses.length > 0
              ? c.email_addresses
                  .map((e) => `${e.address}${e.label ? ` (${e.label})` : ""}`)
                  .join(", ")
              : "";
          const phones =
            c.phone_numbers && c.phone_numbers.length > 0
              ? c.phone_numbers
                  .map((p) => `${p.number}${p.label ? ` (${p.label})` : ""}`)
                  .join(", ")
              : "";
          const company = c.company ? ` | Company: ${c.company}` : "";
          const title = c.title ? ` | Title: ${c.title}` : "";

          const parts = [`${i + 1}. ${name}`, `   ID: ${c.id}`];
          if (emails) parts.push(`   Email: ${emails}`);
          if (phones) parts.push(`   Phone: ${phones}`);
          if (company || title) parts.push(`  ${company}${title}`.trim());
          return parts.join("\n");
        });

        return {
          content: [
            { type: "text", text: `${contacts.length} contact(s):\n\n${lines.join("\n\n")}` },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error searching contacts: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ---------------------------------------------------------------------------
// SSE response helper
// ---------------------------------------------------------------------------

function sseResponse(jsonRpcPayload: unknown): Response {
  const data = JSON.stringify(jsonRpcPayload);
  const body = `event: message\ndata: ${data}\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "mcp-session-id": "stateless",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, x-missive-api-key",
      "Access-Control-Expose-Headers": "mcp-session-id",
    },
  });
}

// ---------------------------------------------------------------------------
// CORS headers helper
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, x-missive-api-key",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

// ---------------------------------------------------------------------------
// Main exported handler
// ---------------------------------------------------------------------------

export async function handleMissiveRequest(request: Request): Promise<Response> {
  // 1. CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  // Only accept POST
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  // Read the API key from the request header
  const apiKey = request.headers.get("x-missive-api-key") || "";

  // Parse JSON-RPC body
  let body: { jsonrpc?: string; method?: string; id?: unknown; params?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return sseResponse({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  }

  const { method, id, params } = body;

  // 2. Route by JSON-RPC method
  switch (method) {
    // -----------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------
    case "initialize": {
      return sseResponse({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "SEO Brothers - Missive",
            version: "0.0.1",
          },
        },
      });
    }

    // -----------------------------------------------------------------
    // notifications/initialized (notification — no response body needed)
    // -----------------------------------------------------------------
    case "notifications/initialized": {
      return new Response(null, { status: 200, headers: CORS_HEADERS });
    }

    // -----------------------------------------------------------------
    // tools/list
    // -----------------------------------------------------------------
    case "tools/list": {
      return sseResponse({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOL_DEFINITIONS },
      });
    }

    // -----------------------------------------------------------------
    // tools/call
    // -----------------------------------------------------------------
    case "tools/call": {
      const toolName = (params?.name as string) || "";
      const toolArgs = (params?.arguments as Record<string, unknown>) || {};

      if (!apiKey) {
        return sseResponse({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: "Missive API key not provided. Pass it via the X-Missive-Api-Key header.",
              },
            ],
            isError: true,
          },
        });
      }

      const result = await handleToolCall(apiKey, toolName, toolArgs);
      return sseResponse({
        jsonrpc: "2.0",
        id,
        result,
      });
    }

    // -----------------------------------------------------------------
    // Unknown method
    // -----------------------------------------------------------------
    default: {
      return sseResponse({
        jsonrpc: "2.0",
        id: id ?? null,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
  }
}
