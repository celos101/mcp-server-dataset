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

server.tool(
  "query_logs",
  "Search Scalyr/DataSet logs with automatic pagination. Returns matching log events with their timestamps, messages, and parsed attributes. The filter uses Scalyr query syntax, e.g. '$serverHost == \"myserver\" level == \"ERROR\"'.",
  {
    filter: z.string().describe("Scalyr filter expression, e.g. '$serverHost == \"myserver\" level == \"ERROR\"'"),
    startTime: z.string().describe("Start of time range. Relative (e.g. '60m', '24h', '7d') or absolute timestamp"),
    endTime: z.string().optional().describe("End of time range. Relative or absolute timestamp. Defaults to now"),
    maxCount: z.number().int().min(1).max(5000).default(500).describe("Maximum number of log events to return (default 500, max 5000)"),
    maxPages: z.number().int().min(1).max(50).default(10).describe("Maximum pagination requests to prevent runaway queries (default 10)"),
    priority: z.enum(["low", "medium", "high"]).default("low").describe("Scanning budget priority. 'low' is cheapest, 'high' scans more data"),
  },
  async ({ filter, startTime, endTime, maxCount, maxPages, priority }) => {
    try {
      const matches = await client.queryLogs(filter, startTime, maxCount, maxPages, priority, endTime);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ matchCount: matches.length, matches }, null, 2),
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
  "count",
  "Count the number of log events matching a filter. Uses Scalyr's numericQuery endpoint. Note: this uses text matching internally, so counts may be slightly inflated compared to exact field matching.",
  {
    filter: z.string().describe("Scalyr filter expression"),
    startTime: z.string().describe("Start of time range. Relative (e.g. '60m', '24h', '7d') or absolute timestamp"),
    endTime: z.string().optional().describe("End of time range. Defaults to now"),
  },
  async ({ filter, startTime, endTime }) => {
    try {
      const count = await client.count(filter, startTime, endTime);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ count }),
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
  "facets",
  "Get the distribution of values for a specific field across matching log events. Useful for understanding what values a field takes and how frequently.",
  {
    filter: z.string().describe("Scalyr filter expression"),
    field: z.string().describe("Field name to get value distribution for, e.g. 'level', 'status', '$serverHost'"),
    startTime: z.string().describe("Start of time range. Relative (e.g. '60m', '24h', '7d') or absolute timestamp"),
    endTime: z.string().optional().describe("End of time range. Defaults to now"),
    maxCount: z.number().int().min(1).max(1000).default(50).describe("Maximum number of distinct values to return (default 50)"),
  },
  async ({ filter, field, startTime, endTime, maxCount }) => {
    try {
      const result = await client.facets(filter, field, startTime, maxCount, endTime);
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
          text: `Error querying facets: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
);

server.tool(
  "power_query",
  "Run a Scalyr PowerQuery expression. PowerQueries support aggregation, grouping, filtering and other advanced operations. Example: '$serverHost == \"bank-cron\" level == \"ERROR\" | group count() by status'.",
  {
    query: z.string().describe("PowerQuery expression"),
    startTime: z.string().describe("Start of time range. Relative (e.g. '60m', '24h', '7d') or absolute timestamp"),
    endTime: z.string().optional().describe("End of time range. Defaults to now"),
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
  "get_file",
  "Retrieve a configuration file stored in Scalyr/DataSet. Common paths include '/scalyr/alerts' for alert configurations.",
  {
    path: z.string().describe("File path in Scalyr, e.g. '/scalyr/alerts'"),
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
