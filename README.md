# mcp-server-dataset

MCP (Model Context Protocol) server for the [Scalyr/DataSet](https://www.dataset.com/) log management API. Allows AI assistants like Claude to query logs, count events, analyze field distributions, run PowerQueries, and retrieve configuration files.

## Installation

```json
{
  "mcpServers": {
    "scalyr": {
      "command": "npx",
      "args": ["-y", "mcp-server-dataset"],
      "env": {
        "SCALYR_API_READ_KEY": "<your-api-token>"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SCALYR_API_READ_KEY` | Yes | Scalyr/DataSet API read token |
| `SCALYR_API_BASE_URL` | No | API base URL (default: `https://www.scalyr.com/api`). Set for DataSet EU or other regions. |

## Tools

### query_logs

Search logs with automatic pagination. Follows `continuationToken` internally so you get all matching results in one call.

**Parameters:**
- `filter` (string, required) — Scalyr filter expression, e.g. `$serverHost == "myserver" level == "ERROR"`
- `startTime` (string, required) — Relative (`60m`, `24h`, `7d`) or absolute timestamp
- `endTime` (string, optional) — End of time range, defaults to now
- `maxCount` (number, optional) — Max events to return (default 500, max 5000)
- `maxPages` (number, optional) — Max pagination requests (default 10, max 50)
- `priority` (string, optional) — Scanning budget: `low` (default), `medium`, `high`

### count

Count matching log events using Scalyr's numericQuery endpoint.

**Parameters:**
- `filter` (string, required) — Scalyr filter expression
- `startTime` (string, required) — Start of time range
- `endTime` (string, optional) — End of time range

### facets

Get the distribution of values for a specific field.

**Parameters:**
- `filter` (string, required) — Scalyr filter expression
- `field` (string, required) — Field name, e.g. `level`, `status`, `$serverHost`
- `startTime` (string, required) — Start of time range
- `endTime` (string, optional) — End of time range
- `maxCount` (number, optional) — Max distinct values (default 50)

### power_query

Run a Scalyr PowerQuery expression with aggregation, grouping, and filtering.

**Parameters:**
- `query` (string, required) — PowerQuery expression
- `startTime` (string, required) — Start of time range
- `endTime` (string, optional) — End of time range

### get_file

Retrieve a configuration file from Scalyr/DataSet.

**Parameters:**
- `path` (string, required) — File path, e.g. `/scalyr/alerts`

## License

MIT
