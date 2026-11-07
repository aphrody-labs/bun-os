# @aphrody/playwright-mcp

Playwright Browser MCP server for Bun OS: headless and visual web automation, snapshot, screenshot, evaluation and accessibility testing over MCP stdio and JSON-RPC.

## Tools

| Tool | Description |
| :--- | :--- |
| `browser_navigate` | Navigate active browser to target URL |
| `browser_snapshot` | Capture accessibility tree, DOM or markdown snapshot |
| `browser_screenshot` | Take page or selector screenshot (.png) |
| `browser_click` | Click elements using CSS/XPath or text locators |
| `browser_fill` | Fill inputs and textareas |
| `browser_type` | Type keyboard characters with realistic intervals |
| `browser_evaluate` | Execute JavaScript in page context |
| `browser_close` | Close browser session |

## Invocation

```bash
# Run stdio MCP server directly
bun run packages/playwright-mcp/src/mcp.ts

# Or via package bin
bunos-playwright-mcp
```
