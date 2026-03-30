# MCP Server Manual Test Prompt

Start a new Claude Code session from the project root with `SCALYR_API_READ_KEY` set, then paste the prompt below.

**Note:** Step 6 requires an API key with "Read Configuration" permission. If your key only has log read access, that step will return a 403 — that's expected, not a bug.

---

I want a full health check of our logging infrastructure. For the last 24 hours:

1. How many total log events do we have? Use an empty string filter to match all events.
2. What's the breakdown by log level?
3. Which servers are logging the most?
4. Show me the 10 most recent ERROR logs with full details.
5. Run a power query to group error counts by tool_name: `level == "ERROR" | group count = count() by tool_name | sort -count | limit 5`
6. Pull the current alert configuration from /scalyr/alerts.

## Expected tool coverage

| Step | Tool used |
|------|-----------|
| 1 | `scalyr_count` |
| 2 | `scalyr_facets` (field: `level`) |
| 3 | `scalyr_facets` (field: `$serverHost`) |
| 4 | `scalyr_query_logs` |
| 5 | `scalyr_power_query` |
| 6 | `scalyr_get_file` |
