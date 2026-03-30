#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ScalyrClient } from "./scalyr-client.js";

const token = process.env.SCALYR_API_READ_KEY;
if (!token) {
  console.error("SCALYR_API_READ_KEY environment variable is required");
  process.exit(1);
}

const client = new ScalyrClient(token, process.env.SCALYR_API_BASE_URL);

const server = new McpServer({
  name: "mcp-server-dataset",
  version: "1.0.0",
});

const READ_ONLY_HINTS = {
  readOnlyHint: true as const,
  destructiveHint: false as const,
  openWorldHint: true as const,
};

server.tool(
  "scalyr_query_logs",
  `Search Scalyr/DataSet logs with automatic pagination. Returns matching log events with timestamps, messages, and parsed attributes.

Recommended workflow: use scalyr_facets or scalyr_count first to understand the data volume, then use this tool with a targeted filter and small maxCount.

Filter syntax examples:
  - $serverHost == "myserver" level == "ERROR"
  - $serverHost == "bank-cron" (level == "ERROR" || level == "CRITICAL")
  - $logfile == "/var/log/app.log" status >= 500

Tips:
  - Use a narrow time range and specific filters to avoid scanning too much data.
  - The API scans forward from startTime — if most logs are INFO, errors near the end of the range may not be reached with low priority. Use priority "high" or a narrower time window.
  - Start with maxCount 20-50 to preview results before requesting more.`,
  {
    filter: z.string().describe('Scalyr filter expression, e.g. \'$serverHost == "myserver" level == "ERROR"\''),
    startTime: z.string().describe("Start of time range. Relative (e.g. '60m', '24h', '7d') or absolute timestamp"),
    endTime: z.string().optional().describe("End of time range. Defaults to now"),
    maxCount: z.number().int().min(1).max(5000).default(100).describe("Maximum log events to return. Start small (20-50) to preview, increase if needed. Default 100, max 5000"),
    maxPages: z.number().int().min(1).max(50).default(10).describe("Maximum pagination requests (default 10). Increase only if you need a large result set"),
    priority: z.enum(["low", "medium", "high"]).default("low").describe("Scanning budget. 'low' is cheapest but may miss events in large time ranges. Use 'high' for thorough searches"),
  },
  {
    ...READ_ONLY_HINTS,
  },
  async ({ filter, startTime, endTime, maxCount, maxPages, priority }) => {
    try {
      const matches = await client.queryLogs(filter, startTime, maxCount, maxPages, priority, endTime);

      const truncated = matches.length >= maxCount;
      const summary = `Found ${matches.length} log event(s)${truncated ? ` (limited to maxCount=${maxCount}, there may be more)` : ""}.`;

      const formatted = matches.map((m) => {
        const ts = new Date(Number(m.timestamp) / 1e6).toISOString();
        const attrs = Object.entries(m.attributes)
          .filter(([k]) => !k.startsWith("__"))
          .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
          .join("\n");
        return `[${ts}] ${m.message}${attrs ? "\n" + attrs : ""}`;
      });

      return {
        content: [{
          type: "text" as const,
          text: `${summary}\n\n${formatted.join("\n\n")}`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error querying logs: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
);

server.tool(
  "scalyr_count",
  `Count log events matching a filter. Fast way to check data volume before querying full logs.

Note: uses Scalyr's numericQuery which does text matching, so counts may be slightly higher than exact field matching. For precise counts, use scalyr_power_query.`,
  {
    filter: z.string().describe("Scalyr filter expression"),
    startTime: z.string().describe("Start of time range. Relative (e.g. '60m', '24h', '7d') or absolute timestamp"),
    endTime: z.string().optional().describe("End of time range. Defaults to now"),
  },
  {
    ...READ_ONLY_HINTS,
  },
  async ({ filter, startTime, endTime }) => {
    try {
      const count = await client.count(filter, startTime, endTime);
      return {
        content: [{
          type: "text" as const,
          text: `${count} matching event(s) for filter: ${filter}`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error counting events: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
);

server.tool(
  "scalyr_facets",
  `Get the value distribution for a field across matching logs. Great first step to understand what's in your logs before querying details.

Example: use field "level" to see how many ERROR vs INFO vs WARNING events exist, or "$serverHost" to see which servers are logging.`,
  {
    filter: z.string().describe("Scalyr filter expression"),
    field: z.string().describe("Field name, e.g. 'level', 'status', '$serverHost', '$logfile'"),
    startTime: z.string().describe("Start of time range. Relative (e.g. '60m', '24h', '7d') or absolute timestamp"),
    endTime: z.string().optional().describe("End of time range. Defaults to now"),
    maxCount: z.number().int().min(1).max(1000).default(50).describe("Maximum distinct values to return (default 50)"),
  },
  {
    ...READ_ONLY_HINTS,
  },
  async ({ filter, field, startTime, endTime, maxCount }) => {
    try {
      const result = await client.facets(filter, field, startTime, maxCount, endTime);

      const lines = result.values.map((v) => `  ${v.value}: ${v.count}`);
      return {
        content: [{
          type: "text" as const,
          text: `${result.matchCount} total event(s), field "${field}" distribution:\n${lines.join("\n")}`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error querying facets: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
);

server.tool(
  "scalyr_power_query",
  `Run a Scalyr PowerQuery expression for advanced aggregation, grouping, and filtering. Use this for analytics-style queries.

Examples:
  - $serverHost == "bank-cron" level == "ERROR" | group count() by status
  - $logfile == "/var/log/app.log" | group count(), avg(duration) by endpoint | sort -count
  - level == "ERROR" | columns timestamp, message, $serverHost`,
  {
    query: z.string().describe("PowerQuery expression including filter and pipe stages"),
    startTime: z.string().describe("Start of time range. Relative (e.g. '60m', '24h', '7d') or absolute timestamp"),
    endTime: z.string().optional().describe("End of time range. Defaults to now"),
  },
  {
    ...READ_ONLY_HINTS,
  },
  async ({ query, startTime, endTime }) => {
    try {
      const result = await client.powerQuery(query, startTime, endTime);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error running power query: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
);

server.tool(
  "scalyr_get_file",
  "Retrieve a configuration file stored in Scalyr/DataSet. Common paths: '/scalyr/alerts' (alert configs), '/scalyr/searches' (saved searches).",
  {
    path: z.string().describe("File path in Scalyr, e.g. '/scalyr/alerts'"),
  },
  {
    ...READ_ONLY_HINTS,
  },
  async ({ path }) => {
    try {
      const content = await client.getFile(path);
      return {
        content: [{
          type: "text" as const,
          text: content,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error getting file: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Scalyr/DataSet MCP server started");
