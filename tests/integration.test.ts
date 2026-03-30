/**
 * Integration tests that hit the real Scalyr/DataSet API.
 *
 * These tests are SKIPPED unless SCALYR_API_READ_KEY is set.
 * Optionally set SCALYR_API_BASE_URL if you use a non-default endpoint.
 *
 * Run:
 *   SCALYR_API_READ_KEY=your-key npm test -- tests/integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const API_KEY = process.env.SCALYR_API_READ_KEY;

const describeIntegration = API_KEY ? describe : describe.skip;

describeIntegration("Integration — live Scalyr API", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      SCALYR_API_READ_KEY: API_KEY!,
    };
    if (process.env.SCALYR_API_BASE_URL) {
      env.SCALYR_API_BASE_URL = process.env.SCALYR_API_BASE_URL;
    }

    transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env,
    });

    client = new Client({ name: "integration-test", version: "1.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it("connects and lists all 5 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "scalyr_count",
      "scalyr_facets",
      "scalyr_get_file",
      "scalyr_power_query",
      "scalyr_query_logs",
    ]);
  });

  it("scalyr_count — counts events in the last hour", async () => {
    const result = await client.callTool({
      name: "scalyr_count",
      arguments: { filter: "*", startTime: "1h" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    // Should contain a number followed by "matching event(s)"
    expect(text).toMatch(/\d+ matching event\(s\)/);
    console.log("  scalyr_count:", text);
  });

  it("scalyr_query_logs — fetches actual log events", async () => {
    const result = await client.callTool({
      name: "scalyr_query_logs",
      arguments: { filter: "*", startTime: "1h", maxCount: 5 },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/Found \d+ log event/);
    console.log("  scalyr_query_logs:", text.slice(0, 200), "...");
  });

  it("scalyr_facets — gets field distribution for a real field", async () => {
    const result = await client.callTool({
      name: "scalyr_facets",
      arguments: { filter: "*", field: "$serverHost", startTime: "24h", maxCount: 10 },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/total event\(s\)/);
    expect(text).toContain("$serverHost");
    console.log("  scalyr_facets:", text);
  });

  it("scalyr_power_query — runs an aggregation query", async () => {
    const result = await client.callTool({
      name: "scalyr_power_query",
      arguments: {
        query: "* | group count() by $serverHost | sort -count | limit 5",
        startTime: "24h",
      },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty("columns");
    expect(parsed).toHaveProperty("values");
    expect(parsed).toHaveProperty("matchingEvents");
    expect(Array.isArray(parsed.columns)).toBe(true);
    console.log("  scalyr_power_query:", JSON.stringify(parsed, null, 2).slice(0, 300), "...");
  });

  it("scalyr_get_file — retrieves /scalyr/alerts", async () => {
    const result = await client.callTool({
      name: "scalyr_get_file",
      arguments: { path: "/scalyr/alerts" },
    });

    // This may legitimately error if no alerts file exists, so just verify
    // we get a response in the expected shape
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);

    if (result.isError) {
      console.log("  scalyr_get_file: (error, may be expected)", text);
    } else {
      console.log("  scalyr_get_file:", text.slice(0, 200), "...");
    }
  });

  it("handles bad filter gracefully", async () => {
    const result = await client.callTool({
      name: "scalyr_count",
      arguments: { filter: "))) invalid [[[ filter", startTime: "1h" },
    });

    // Scalyr should reject this — the MCP server should surface the error
    // without crashing
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(typeof text).toBe("string");
    console.log("  bad filter response:", text);
  });
});
