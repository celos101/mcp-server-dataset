import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScalyrClient } from "../src/scalyr-client.js";

describe("ScalyrClient", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockResponse(data: unknown, status = 200) {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(data),
      json: async () => data,
    });
  }

  describe("constructor", () => {
    it("uses default base URL", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "success", values: [0] });
      await client.count("*", "1h");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.scalyr.com/api/numericQuery",
        expect.any(Object),
      );
    });

    it("accepts custom base URL", async () => {
      const client = new ScalyrClient("token", "https://custom.example.com/api");
      mockResponse({ status: "success", values: [0] });
      await client.count("*", "1h");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom.example.com/api/numericQuery",
        expect.any(Object),
      );
    });

    it("strips trailing slashes from base URL", async () => {
      const client = new ScalyrClient("token", "https://example.com/api///");
      mockResponse({ status: "success", values: [0] });
      await client.count("*", "1h");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/api/numericQuery",
        expect.any(Object),
      );
    });
  });

  describe("queryLogs", () => {
    it("returns matches from a single page", async () => {
      const client = new ScalyrClient("token");
      mockResponse({
        status: "success",
        matches: [
          { timestamp: "1000000000000000", message: "test log", attributes: { level: "ERROR" }, severity: 3 },
        ],
      });

      const result = await client.queryLogs('level == "ERROR"', "1h");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        timestamp: "1000000000000000",
        message: "test log",
        attributes: { level: "ERROR" },
        severity: 3,
      });
    });

    it("paginates across multiple pages", async () => {
      const client = new ScalyrClient("token");

      mockResponse({
        status: "success",
        matches: [{ timestamp: "1000", message: "log 1", attributes: {}, severity: 0 }],
        continuationToken: "page2token",
      });
      mockResponse({
        status: "success",
        matches: [{ timestamp: "2000", message: "log 2", attributes: {}, severity: 0 }],
      });

      const result = await client.queryLogs("*", "1h", 500, 10);
      expect(result).toHaveLength(2);
      expect(result[0].message).toBe("log 1");
      expect(result[1].message).toBe("log 2");

      const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondCallBody.continuationToken).toBe("page2token");
    });

    it("stops when maxCount reached", async () => {
      const client = new ScalyrClient("token");

      mockResponse({
        status: "success",
        matches: [
          { timestamp: "1000", message: "log 1", attributes: {}, severity: 0 },
          { timestamp: "2000", message: "log 2", attributes: {}, severity: 0 },
          { timestamp: "3000", message: "log 3", attributes: {}, severity: 0 },
        ],
        continuationToken: "more",
      });

      const result = await client.queryLogs("*", "1h", 2, 10);
      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("respects maxPages limit", async () => {
      const client = new ScalyrClient("token");

      mockResponse({
        status: "success",
        matches: [{ timestamp: "1000", message: "log 1", attributes: {}, severity: 0 }],
        continuationToken: "page2",
      });
      mockResponse({
        status: "success",
        matches: [{ timestamp: "2000", message: "log 2", attributes: {}, severity: 0 }],
        continuationToken: "page3",
      });

      const result = await client.queryLogs("*", "1h", 500, 2);
      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("stops on empty matches", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "success", matches: [] });

      const result = await client.queryLogs("*", "1h");
      expect(result).toHaveLength(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("includes endTime and priority in request", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "success", matches: [] });

      await client.queryLogs("*", "1h", 100, 10, "high", "30m");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.priority).toBe("high");
      expect(body.endTime).toBe("30m");
      expect(body.startTime).toBe("1h");
      expect(body.filter).toBe("*");
      expect(body.queryType).toBe("log");
    });

    it("sends token in request body", async () => {
      const client = new ScalyrClient("my-secret-token");
      mockResponse({ status: "success", matches: [] });

      await client.queryLogs("*", "1h");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.token).toBe("my-secret-token");
    });

    it("adjusts per-page maxCount to not exceed target", async () => {
      const client = new ScalyrClient("token");

      mockResponse({
        status: "success",
        matches: [
          { timestamp: "1000", message: "log 1", attributes: {}, severity: 0 },
          { timestamp: "2000", message: "log 2", attributes: {}, severity: 0 },
        ],
        continuationToken: "next",
      });
      mockResponse({
        status: "success",
        matches: [{ timestamp: "3000", message: "log 3", attributes: {}, severity: 0 }],
      });

      await client.queryLogs("*", "1h", 3, 10);

      const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(firstBody.maxCount).toBe(3);

      const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondBody.maxCount).toBe(1); // 3 - 2 already fetched
    });
  });

  describe("count", () => {
    it("returns count value", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "success", values: [42] });

      const result = await client.count('level == "ERROR"', "24h");
      expect(result).toBe(42);
    });

    it("returns 0 when no values", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "success", values: [] });

      const result = await client.count("*", "1h");
      expect(result).toBe(0);
    });

    it("sends correct request body", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "success", values: [10] });

      await client.count("*", "24h", "1h");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.filter).toBe("*");
      expect(body.function).toBe("count");
      expect(body.startTime).toBe("24h");
      expect(body.endTime).toBe("1h");
      expect(body.buckets).toBe(1);
    });

    it("omits endTime when not provided", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "success", values: [10] });

      await client.count("*", "24h");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty("endTime");
    });
  });

  describe("facets", () => {
    it("returns match count and values", async () => {
      const client = new ScalyrClient("token");
      mockResponse({
        status: "success",
        matchCount: 100,
        values: [
          { value: "ERROR", count: 50 },
          { value: "WARN", count: 30 },
          { value: "INFO", count: 20 },
        ],
      });

      const result = await client.facets("*", "level", "24h");
      expect(result.matchCount).toBe(100);
      expect(result.values).toHaveLength(3);
      expect(result.values[0]).toEqual({ value: "ERROR", count: 50 });
    });

    it("sends correct request body with optional params", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "success", matchCount: 0, values: [] });

      await client.facets("*", "level", "24h", 100, "1h");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.field).toBe("level");
      expect(body.maxCount).toBe(100);
      expect(body.endTime).toBe("1h");
    });
  });

  describe("powerQuery", () => {
    it("returns columns, values, and matchingEvents", async () => {
      const client = new ScalyrClient("token");
      mockResponse({
        status: "success",
        columns: [{ name: "status" }, { name: "count" }],
        values: [["200", 100], ["500", 5]],
        matchingEvents: 105,
      });

      const result = await client.powerQuery("* | group count() by status", "24h");
      expect(result.columns).toEqual([{ name: "status" }, { name: "count" }]);
      expect(result.values).toEqual([["200", 100], ["500", 5]]);
      expect(result.matchingEvents).toBe(105);
    });

    it("includes endTime when provided", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "success", columns: [], values: [], matchingEvents: 0 });

      await client.powerQuery("*", "24h", "1h");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.endTime).toBe("1h");
      expect(body.query).toBe("*");
      expect(body.startTime).toBe("24h");
    });
  });

  describe("getFile", () => {
    it("returns file content", async () => {
      const client = new ScalyrClient("token");
      mockResponse({
        status: "success",
        path: "/scalyr/alerts",
        content: '{"alerts": []}',
        createDate: "2024-01-01",
        modDate: "2024-01-02",
        version: 1,
      });

      const result = await client.getFile("/scalyr/alerts");
      expect(result).toBe('{"alerts": []}');
    });

    it("sends correct request body", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "success", path: "/test", content: "", createDate: "", modDate: "", version: 0 });

      await client.getFile("/scalyr/searches");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.path).toBe("/scalyr/searches");
      expect(body.token).toBe("token");
    });
  });

  describe("error handling", () => {
    it("throws on HTTP error", async () => {
      const client = new ScalyrClient("token");
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      await expect(client.count("*", "1h")).rejects.toThrow(
        "Scalyr API error (401): Unauthorized",
      );
    });

    it("throws on API error status with message", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "error", message: "Invalid filter" });

      await expect(client.count("bad filter", "1h")).rejects.toThrow(
        'Scalyr API returned status "error": Invalid filter',
      );
    });

    it("throws with 'unknown error' when no message", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "error" });

      await expect(client.count("*", "1h")).rejects.toThrow(
        'Scalyr API returned status "error": unknown error',
      );
    });

    it("throws on non-success API status", async () => {
      const client = new ScalyrClient("token");
      mockResponse({ status: "failed", message: "Something went wrong" });

      await expect(client.count("*", "1h")).rejects.toThrow(
        'Scalyr API returned status "failed": Something went wrong',
      );
    });
  });
});
