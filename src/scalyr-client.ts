const DEFAULT_BASE_URL = "https://www.scalyr.com/api";

export interface LogMatch {
  timestamp: string;
  message: string;
  attributes: Record<string, unknown>;
  severity: number;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface PowerQueryResult {
  columns: Array<{ name: string }>;
  values: unknown[];
  matchingEvents: number;
}

interface QueryResponse {
  status: string;
  matches: Array<{
    timestamp: string;
    message: string;
    attributes: Record<string, unknown>;
    severity: number;
  }>;
  continuationToken?: string;
}

interface NumericQueryResponse {
  status: string;
  values: number[];
}

interface FacetQueryResponse {
  status: string;
  matchCount: number;
  values: FacetValue[];
}

interface PowerQueryResponse {
  status: string;
  columns: Array<{ name: string }>;
  values: unknown[];
  matchingEvents: number;
}

interface GetFileResponse {
  status: string;
  path: string;
  content: string;
  createDate: string;
  modDate: string;
  version: number;
}

export class ScalyrClient {
  private token: string;
  private baseUrl: string;

  constructor(token: string, baseUrl?: string) {
    this.token = token;
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private async request<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: this.token, ...body }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Scalyr API error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as T & { status: string; message?: string };
    if (data.status !== "success") {
      throw new Error(`Scalyr API returned status "${data.status}": ${data.message ?? "unknown error"}`);
    }

    return data;
  }

  async queryLogs(
    filter: string,
    startTime: string,
    maxCount: number = 500,
    maxPages: number = 10,
    priority: string = "low",
    endTime?: string,
  ): Promise<LogMatch[]> {
    const allMatches: LogMatch[] = [];
    let continuationToken: string | undefined;
    let pages = 0;

    while (pages < maxPages) {
      const body: Record<string, unknown> = {
        queryType: "log",
        filter,
        startTime,
        maxCount: Math.min(maxCount - allMatches.length, 5000),
        priority,
      };
      if (endTime) body.endTime = endTime;
      if (continuationToken) body.continuationToken = continuationToken;

      const data = await this.request<QueryResponse>("/query", body);

      for (const match of data.matches) {
        allMatches.push({
          timestamp: match.timestamp,
          message: match.message,
          attributes: match.attributes,
          severity: match.severity,
        });
      }

      pages++;

      if (!data.continuationToken || data.matches.length === 0 || allMatches.length >= maxCount) {
        break;
      }

      continuationToken = data.continuationToken;
    }

    return allMatches.slice(0, maxCount);
  }

  async count(
    filter: string,
    startTime: string,
    endTime?: string,
  ): Promise<number> {
    const body: Record<string, unknown> = {
      filter,
      function: "count",
      startTime,
      buckets: 1,
    };
    if (endTime) body.endTime = endTime;

    const data = await this.request<NumericQueryResponse>("/numericQuery", body);
    return data.values[0] ?? 0;
  }

  async facets(
    filter: string,
    field: string,
    startTime: string,
    maxCount: number = 50,
    endTime?: string,
  ): Promise<{ matchCount: number; values: FacetValue[] }> {
    const body: Record<string, unknown> = {
      filter,
      field,
      startTime,
      maxCount,
    };
    if (endTime) body.endTime = endTime;

    const data = await this.request<FacetQueryResponse>("/facetQuery", body);
    return { matchCount: data.matchCount, values: data.values };
  }

  async powerQuery(
    query: string,
    startTime: string,
    endTime?: string,
  ): Promise<PowerQueryResult> {
    const body: Record<string, unknown> = {
      query,
      startTime,
    };
    if (endTime) body.endTime = endTime;

    const data = await this.request<PowerQueryResponse>("/powerQuery", body);
    return {
      columns: data.columns,
      values: data.values,
      matchingEvents: data.matchingEvents,
    };
  }

  async getFile(path: string): Promise<string> {
    const data = await this.request<GetFileResponse>("/getFile", { path });
    return data.content;
  }
}
