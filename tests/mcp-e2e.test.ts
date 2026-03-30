import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Server } from "node:net";

type Handler = (body: Record<string, unknown>, res: ServerResponse) => void;

function createMockScalyrApi() {
  const defaultHandlers = new Map<string, Handler>();

  defaultHandlers.set("/query", (_body, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "success",
      matches: [
        {
          timestamp: "1700000000000000000",
          message: "Test error occurred",
          attributes: { level: "ERROR", $serverHost: "web-01", status: "500" },
          severity: 3,
        },
        {
          timestamp: "1700000001000000000",
          message: "Another error",
          attributes: { level: "ERROR", $serverHost: "web-02", status: "503" },
          severity: 3,
        },
      ],
    }));
  });

  defaultHandlers.set("/numericQuery", (_body, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success", values: [142] }));
  });

  defaultHandlers.set("/facetQuery", (_body, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "success",
      matchCount: 500,
      values: [
        { value: "ERROR", count: 200 },
        { value: "WARN", count: 150 },
        { value: "INFO", count: 150 },
      ],
    }));
  });

  defaultHandlers.set("/powerQuery", (_body, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "success",
      columns: [{ name: "status" }, { name: "count" }],
      values: [["500", 50], ["200", 1000]],
      matchingEvents: 1050,
    }));
  });

  defaultHandlers.set("/getFile", (_body, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "success",
      path: "/scalyr/alerts",
      content: '{"alerts": [{"trigger": "error_rate > 10"}]}',
      createDate: "2024-01-01T00:00:00Z",
      modDate: "2024-06-15T12:00:00Z",
      version: 3,
    }));
  });

  const handlers = new Map<string, Handler>(defaultHandlers);

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: "Invalid JSON" }));
        return;
      }

      const handler = handlers.get(req.url ?? "");
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: `Unknown endpoint: ${req.url}` }));
        return;
      }

      if (!parsed.token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: "Missing token" }));
        return;
      }

      handler(parsed, res);
    });
  });

  return {
    server,
    start: (): Promise<number> => new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        resolve((server.address() as AddressInfo).port);
      });
    }),
    stop: (): Promise<void> => new Promise((resolve) => {
      server.close(() => resolve());
    }),
    setHandler: (endpoint: string, handler: Handler) => {
      handlers.set(endpoint, handler);
    },
    resetHandlers: () => {
      handlers.clear();
      for (const [k, v] of defaultHandlers) {
        handlers.set(k, v);
      }
    },
  };
}

describe("MCP Server E2E", () => {
  let mockApi: ReturnType<typeof createMockScalyrApi>;
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    mockApi = createMockScalyrApi();
    const mockPort = await mockApi.start();

    transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: {
        ...process.env,
        SCALYR_API_READ_KEY: "test-api-token",
        SCALYR_API_BASE_URL: `http://127.0.0.1:${mockPort}`,
      },
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterEach(() => {
    mockApi.resetHandlers();
  });

  afterAll(async () => {
    await client?.close();
    await mockApi?.stop();
  });

  describe("tool discovery", () => {
    it("lists all 5 tools", async () => {
      const { tools } = await client.listTools();
      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        "scalyr_count",
        "scalyr_facets",
        "scalyr_get_file",
        "scalyr_power_query",
        "scalyr_query_logs",
      ]);
    });

    it("scalyr_query_logs has correct schema", async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "scalyr_query_logs")!;
      expect(tool.inputSchema.properties).toHaveProperty("filter");
      expect(tool.inputSchema.properties).toHaveProperty("startTime");
      expect(tool.inputSchema.properties).toHaveProperty("endTime");
      expect(tool.inputSchema.properties).toHaveProperty("maxCount");
      expect(tool.inputSchema.properties).toHaveProperty("maxPages");
      expect(tool.inputSchema.properties).toHaveProperty("priority");
      expect(tool.inputSchema.required).toContain("filter");
      expect(tool.inputSchema.required).toContain("startTime");
    });

    it("scalyr_count has correct schema", async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "scalyr_count")!;
      expect(tool.inputSchema.required).toContain("filter");
      expect(tool.inputSchema.required).toContain("startTime");
    });

    it("scalyr_facets has correct schema", async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "scalyr_facets")!;
      expect(tool.inputSchema.required).toContain("filter");
      expect(tool.inputSchema.required).toContain("field");
      expect(tool.inputSchema.required).toContain("startTime");
    });

    it("scalyr_power_query has correct schema", async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "scalyr_power_query")!;
      expect(tool.inputSchema.required).toContain("query");
      expect(tool.inputSchema.required).toContain("startTime");
    });

    it("scalyr_get_file has correct schema", async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "scalyr_get_file")!;
      expect(tool.inputSchema.required).toContain("path");
    });
  });

  describe("scalyr_query_logs", () => {
    it("returns formatted log events", async () => {
      const result = await client.callTool({
        name: "scalyr_query_logs",
        arguments: { filter: 'level == "ERROR"', startTime: "1h", maxCount: 100 },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Found 2 log event(s)");
      expect(text).toContain("Test error occurred");
      expect(text).toContain("Another error");
      expect(text).toContain('level: "ERROR"');
    });

    it("filters out __internal attributes", async () => {
      mockApi.setHandler("/query", (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "success",
          matches: [{
            timestamp: "1700000000000000000",
            message: "test",
            attributes: { level: "INFO", __internal: "hidden" },
            severity: 0,
          }],
        }));
      });

      const result = await client.callTool({
        name: "scalyr_query_logs",
        arguments: { filter: "*", startTime: "1h" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('level: "INFO"');
      expect(text).not.toContain("__internal");
    });

    it("indicates truncation when results hit maxCount", async () => {
      mockApi.setHandler("/query", (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "success",
          matches: [
            { timestamp: "1000", message: "log 1", attributes: {}, severity: 0 },
            { timestamp: "2000", message: "log 2", attributes: {}, severity: 0 },
          ],
          continuationToken: "more",
        }));
      });

      const result = await client.callTool({
        name: "scalyr_query_logs",
        arguments: { filter: "*", startTime: "1h", maxCount: 2, maxPages: 1 },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("limited to maxCount=2");
      expect(text).toContain("there may be more");
    });

    it("handles pagination across multiple pages", async () => {
      let callCount = 0;
      mockApi.setHandler("/query", (_body, res) => {
        callCount++;
        res.writeHead(200, { "Content-Type": "application/json" });
        if (callCount === 1) {
          res.end(JSON.stringify({
            status: "success",
            matches: [{ timestamp: "1000", message: "page 1", attributes: {}, severity: 0 }],
            continuationToken: "next-page",
          }));
        } else {
          res.end(JSON.stringify({
            status: "success",
            matches: [{ timestamp: "2000", message: "page 2", attributes: {}, severity: 0 }],
          }));
        }
      });

      const result = await client.callTool({
        name: "scalyr_query_logs",
        arguments: { filter: "*", startTime: "1h", maxCount: 100, maxPages: 10 },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Found 2 log event(s)");
      expect(text).toContain("page 1");
      expect(text).toContain("page 2");
      expect(callCount).toBe(2);
    });
  });

  describe("scalyr_count", () => {
    it("returns count of matching events", async () => {
      const result = await client.callTool({
        name: "scalyr_count",
        arguments: { filter: 'level == "ERROR"', startTime: "24h" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("142");
      expect(text).toContain("matching event(s)");
    });

    it("includes filter in response message", async () => {
      const result = await client.callTool({
        name: "scalyr_count",
        arguments: { filter: '$serverHost == "web-01"', startTime: "1h" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('$serverHost == "web-01"');
    });
  });

  describe("scalyr_facets", () => {
    it("returns field distribution", async () => {
      const result = await client.callTool({
        name: "scalyr_facets",
        arguments: { filter: "*", field: "level", startTime: "24h" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("500 total event(s)");
      expect(text).toContain('field "level" distribution');
      expect(text).toContain("ERROR: 200");
      expect(text).toContain("WARN: 150");
      expect(text).toContain("INFO: 150");
    });
  });

  describe("scalyr_power_query", () => {
    it("returns structured JSON results", async () => {
      const result = await client.callTool({
        name: "scalyr_power_query",
        arguments: { query: "* | group count() by status", startTime: "24h" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.columns).toEqual([{ name: "status" }, { name: "count" }]);
      expect(parsed.values).toEqual([["500", 50], ["200", 1000]]);
      expect(parsed.matchingEvents).toBe(1050);
    });
  });

  describe("scalyr_get_file", () => {
    it("returns file content", async () => {
      const result = await client.callTool({
        name: "scalyr_get_file",
        arguments: { path: "/scalyr/alerts" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("alerts");
      expect(text).toContain("error_rate > 10");
    });
  });

  describe("error handling", () => {
    it("returns isError on API error response", async () => {
      mockApi.setHandler("/numericQuery", (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: "Invalid filter syntax" }));
      });

      const result = await client.callTool({
        name: "scalyr_count",
        arguments: { filter: "bad[filter", startTime: "1h" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Error counting events");
      expect(text).toContain("Invalid filter syntax");
    });

    it("returns isError on HTTP error", async () => {
      mockApi.setHandler("/getFile", (_body, res) => {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      });

      const result = await client.callTool({
        name: "scalyr_get_file",
        arguments: { path: "/nonexistent" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Error getting file");
    });

    it("returns isError for query logs failures", async () => {
      mockApi.setHandler("/query", (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: "Query timed out" }));
      });

      const result = await client.callTool({
        name: "scalyr_query_logs",
        arguments: { filter: "*", startTime: "30d" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Error querying logs");
      expect(text).toContain("Query timed out");
    });

    it("returns isError for facets failures", async () => {
      mockApi.setHandler("/facetQuery", (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: "Unknown field" }));
      });

      const result = await client.callTool({
        name: "scalyr_facets",
        arguments: { filter: "*", field: "nonexistent", startTime: "1h" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Error querying facets");
    });

    it("returns isError for power query failures", async () => {
      mockApi.setHandler("/powerQuery", (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: "Parse error in query" }));
      });

      const result = await client.callTool({
        name: "scalyr_power_query",
        arguments: { query: "invalid ||| query", startTime: "1h" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Error running power query");
    });
  });
});
