# MCP Server Diff

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-MCP%20Server%20Diff-blue?logo=github)](https://github.com/marketplace/actions/mcp-server-diff)
[![npm version](https://img.shields.io/npm/v/mcp-server-diff)](https://www.npmjs.com/package/mcp-server-diff)
[![GitHub release](https://img.shields.io/github/v/release/SamMorrowDrums/mcp-server-diff)](https://github.com/SamMorrowDrums/mcp-server-diff/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Diff [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server **public interfaces**. Available as both a CLI tool and GitHub Action.

## CLI Usage

Compare any two MCP servers directly from your terminal:

```bash
# Compare two local servers
npx mcp-server-diff -b "python -m mcp_server" -t "node dist/stdio.js"

# Compare local vs remote HTTP server
npx mcp-server-diff -b "go run ./cmd/server stdio" -t "https://mcp.example.com/api"

# Compare with different output formats
npx mcp-server-diff -b "..." -t "..." -o diff      # Raw diff output
npx mcp-server-diff -b "..." -t "..." -o json      # JSON with full details
npx mcp-server-diff -b "..." -t "..." -o markdown  # Formatted report
npx mcp-server-diff -b "..." -t "..." -o summary   # One-line summary (default)

# Use config file for multiple comparisons
npx mcp-server-diff -c servers.json -o diff
```

### Config File Format

```json
{
  "base": {
    "name": "python-server",
    "transport": "stdio",
    "start_command": "python -m mcp_server"
  },
  "targets": [
    {
      "name": "typescript-server",
      "transport": "stdio",
      "start_command": "node dist/stdio.js"
    },
    {
      "name": "remote-server",
      "transport": "streamable-http",
      "server_url": "https://mcp.example.com/api"
    }
  ]
}
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-b, --base` | Base server command (stdio) or URL (http) |
| `-t, --target` | Target server command (stdio) or URL (http) |
| `-c, --config` | Config file with base and targets |
| `-o, --output` | Output format: `diff`, `json`, `markdown`, `summary` |
| `-v, --verbose` | Verbose output |
| `-q, --quiet` | Quiet mode (suppress progress, only output result) |

---

## GitHub Action

A GitHub Action for diffing MCP server public interfaces between versions. Compares the current branch against a baseline to surface any changes to your server's exposed tools, resources, prompts, and capabilities.

### Overview

MCP servers expose a **public interface** to AI assistants: tools (with their input schemas), resources, prompts, and server capabilities. As your server evolves, changes to this interface are worth tracking. This action automates public interface comparison by:

1. Building your MCP server from both the current branch and a baseline (merge-base, tag, or specified ref)
2. Querying both versions for their complete public interface (tools, resources, prompts, capabilities)
3. Generating a diff report showing exactly what changed
4. Surfacing results directly in GitHub's Job Summary

This is **not** about testing internal logic or correctness—it's about visibility into what your server _advertises_ to clients.

### Quick Start

Create `.github/workflows/mcp-diff.yml` in your repository:

```yaml
name: MCP Server Diff

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
    tags: ['v*']

permissions:
  contents: read

jobs:
  mcp-diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: SamMorrowDrums/mcp-server-diff@v2
        with:
          setup_node: true
          install_command: npm ci
          build_command: npm run build
          start_command: node dist/stdio.js
```

## Language Examples

### Node.js / TypeScript

```yaml
- uses: SamMorrowDrums/mcp-server-diff@v2
  with:
    setup_node: true
    node_version: '22'
    install_command: npm ci
    build_command: npm run build
    start_command: node dist/stdio.js
```

### Python

```yaml
- uses: SamMorrowDrums/mcp-server-diff@v2
  with:
    setup_python: true
    python_version: '3.12'
    install_command: pip install -e .
    start_command: python -m my_mcp_server
```

### Go

```yaml
- uses: SamMorrowDrums/mcp-server-diff@v2
  with:
    setup_go: true
    install_command: go mod download
    build_command: go build -o bin/server ./cmd/stdio
    start_command: ./bin/server
```

### Rust

```yaml
- uses: SamMorrowDrums/mcp-server-diff@v2
  with:
    setup_rust: true
    install_command: cargo fetch
    build_command: cargo build --release
    start_command: ./target/release/my-mcp-server
```

### C# / .NET

```yaml
- uses: SamMorrowDrums/mcp-server-diff@v2
  with:
    setup_dotnet: true
    dotnet_version: '9.0.x'
    install_command: dotnet restore
    build_command: dotnet build -c Release
    start_command: dotnet run --no-build -c Release
```

### Custom Setup

If you need more control over environment setup (caching, specific registries, etc.), do your own setup before calling the action:

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0

  - uses: actions/setup-node@v4
    with:
      node-version: '22'
      cache: 'npm'
      registry-url: 'https://npm.pkg.github.com'

  - uses: SamMorrowDrums/mcp-server-diff@v2
    with:
      install_command: npm ci
      build_command: npm run build
      start_command: node dist/stdio.js
```

## Testing Multiple Transports

Test both stdio and HTTP transports in a single run using the `configurations` input:

```yaml
- uses: SamMorrowDrums/mcp-server-diff@v2
  with:
    setup_node: true
    install_command: npm ci
    build_command: npm run build
    configurations: |
      [
        {
          "name": "stdio",
          "transport": "stdio",
          "start_command": "node dist/stdio.js"
        },
        {
          "name": "streamable-http",
          "transport": "streamable-http",
          "start_command": "node dist/http.js",
          "server_url": "http://localhost:3000/mcp"
        }
      ]
```

## Inputs Reference

### Language Setup (Optional)

| Input | Description | Default |
|-------|-------------|---------|
| `setup_node` | Set up Node.js environment | `false` |
| `node_version` | Node.js version | `20` |
| `setup_python` | Set up Python environment | `false` |
| `python_version` | Python version | `3.11` |
| `setup_go` | Set up Go environment | `false` |
| `go_version` | Go version (reads from go.mod if empty) | `""` |
| `setup_rust` | Set up Rust environment | `false` |
| `rust_toolchain` | Rust toolchain | `stable` |
| `setup_dotnet` | Set up .NET environment | `false` |
| `dotnet_version` | .NET version | `8.0.x` |

### Required Inputs

| Input | Description |
|-------|-------------|
| `install_command` | Command to install dependencies (e.g., `npm ci`, `pip install -e .`, `go mod download`) |

### Server Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `build_command` | Command to build the server. Optional for interpreted languages. | `""` |
| `start_command` | Command to start the server for stdio transport | `""` |
| `transport` | Transport type: `stdio` or `streamable-http` | `stdio` |
| `server_url` | Server URL for HTTP transport (e.g., `http://localhost:3000/mcp`) | `""` |
| `configurations` | JSON array of test configurations for testing multiple transports | `""` |
| `server_timeout` | Timeout in seconds to wait for server response | `10` |
| `env_vars` | Environment variables as newline-separated `KEY=VALUE` pairs | `""` |

Either `start_command` (for stdio) or `server_url` (for HTTP) must be provided, unless using `configurations`.

### Comparison Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `compare_ref` | Git ref to compare against. Auto-detects merge-base on PRs or previous tag on tag pushes if not specified. | `""` |
| `fail_on_diff` | Fail the action if API changes are detected. Useful for release validation workflows. | `false` |
| `fail_on_error` | Fail the action if probe errors occur (connection failures, etc.) | `true` |

### Configuration Object Schema

When using `configurations`, each object supports:

| Field | Description | Required |
|-------|-------------|----------|
| `name` | Identifier for this configuration (appears in report) | Yes |
| `transport` | `stdio` or `streamable-http` | No (default: `stdio`) |
| `start_command` | Server start command (stdio: spawns process, HTTP: starts server in background) | Yes for stdio, optional for HTTP |
| `server_url` | URL for HTTP transport | Required for `streamable-http` |
| `startup_wait_ms` | Milliseconds to wait for HTTP server to start (when using `start_command`) | No (default: 2000) |
| `pre_test_command` | Command to run before probing (alternative to `start_command` for HTTP) | No |
| `pre_test_wait_ms` | Milliseconds to wait after `pre_test_command` | No |
| `post_test_command` | Command to run after probing (cleanup, used with `pre_test_command`) | No |
| `headers` | HTTP headers for this configuration | No |
| `env_vars` | Additional environment variables | No |
| `custom_messages` | Config-specific custom messages | No |

## How It Works

### Execution Flow

1. **Baseline Detection**: Determines the comparison ref:
   - For pull requests: merge-base with target branch
   - For tag pushes: previous tag (e.g., `v1.1.0` compares against `v1.0.0`)
   - Explicit: uses `compare_ref` if provided
2. **Build Baseline**: Creates a git worktree at the baseline ref and builds the server
3. **Build Current**: Builds the server from the current branch
4. **Conformance Testing**: Sends MCP protocol requests to both servers:
   - `initialize` - Server capabilities and metadata
   - `tools/list` - Available tools and their schemas
   - `resources/list` - Available resources
   - `prompts/list` - Available prompts
5. **Report Generation**: Produces a Markdown report with diffs, uploaded as an artifact and displayed in Job Summary

### What Gets Compared

The action queries the **public interface** of both server versions and compares the responses:

| Method | What It Reveals |
|--------|----------------|
| `initialize` | Server name, version, capabilities |
| `tools/list` | Available tools and their JSON schemas |
| `resources/list` | Exposed resources |
| `prompts/list` | Available prompts |

Differences appear as unified diffs in the report. Common changes include:

- New tools, resources, or prompts added
- Schema changes (new parameters, updated descriptions)
- Capability changes (new features enabled)
- Version string updates

## Transport Support

### stdio Transport

The default transport communicates with your server via stdin/stdout using JSON-RPC. For stdio, each configuration spawns a fresh server process:

```yaml
- uses: SamMorrowDrums/mcp-server-diff@v2
  with:
    setup_node: true
    install_command: npm ci
    build_command: npm run build
    start_command: node dist/stdio.js
```

### Streamable HTTP Transport

For HTTP servers, you typically want to **start the server once** and test multiple configurations against it. Use `start_command` at the configuration level—the action spawns the server, waits for startup, probes it, then terminates it after that configuration completes:

```yaml
configurations: |
  [{
    "name": "http-server",
    "transport": "streamable-http",
    "start_command": "node dist/http.js",
    "server_url": "http://localhost:3000/mcp",
    "startup_wait_ms": 2000
  }]
```

**Per-configuration server lifecycle**: If your use case requires a fresh server instance per configuration (e.g., testing different flags or environment variables), include `start_command` in each configuration—each will get its own server process started and stopped.

**Shared server for multiple configurations**: If you want one HTTP server to handle multiple test configurations, use `pre_test_command`/`post_test_command` on the first/last configuration, or start the server in a prior workflow step:

```yaml
configurations: |
  [
    {
      "name": "config-a",
      "transport": "streamable-http",
      "server_url": "http://localhost:3000/mcp",
      "pre_test_command": "node dist/http.js &",
      "pre_test_wait_ms": 2000
    },
    {
      "name": "config-b",
      "transport": "streamable-http",
      "server_url": "http://localhost:3000/mcp"
    },
    {
      "name": "config-c",
      "transport": "streamable-http",
      "server_url": "http://localhost:3000/mcp",
      "post_test_command": "pkill -f 'node dist/http.js' || true"
    }
  ]
```

**Pre-deployed servers**: For already-running servers (staging, production), omit lifecycle commands entirely:

```yaml
- uses: SamMorrowDrums/mcp-server-diff@v2
  with:
    install_command: 'true'
    transport: streamable-http
    server_url: https://mcp.example.com/api
```

## Version Comparison Strategies

### Pull Requests

On pull requests, the action automatically compares against the merge-base with the target branch. This shows exactly what changes the PR introduces.

### Tag Releases

When triggered by a tag push matching `v*`, the action finds the previous tag and compares against it:

```yaml
on:
  push:
    tags: ['v*']

# v1.2.0 will automatically compare against v1.1.0
```

### Explicit Baseline

Specify any git ref to compare against:

```yaml
- uses: SamMorrowDrums/mcp-server-diff@v2
  with:
    setup_node: true
    install_command: npm ci
    build_command: npm run build
    start_command: node dist/stdio.js
    compare_ref: v1.0.0
```

### Failing on Changes (Release Validation)

For release workflows where you want to ensure no API changes, use `fail_on_diff`:

```yaml
- uses: SamMorrowDrums/mcp-server-diff@v2
  with:
    setup_node: true
    install_command: npm ci
    build_command: npm run build
    start_command: node dist/stdio.js
    compare_ref: v1.0.0
    fail_on_diff: true  # Action fails if any API changes are detected
```

## Artifacts and Reports

The action produces:

1. **Job Summary**: Inline Markdown report in the GitHub Actions UI showing test results and diffs
2. **Artifact**: `mcp-diff-report` artifact containing `MCP_DIFF_REPORT.md` for download or further processing

## Example Output

### No Changes Detected

When the MCP server's public interface hasn't changed between branches:

```
📊 Comparison:
  Current: HEAD
  Compare: abc1234 (v1.0.0)

🧪 Running diff...

📊 Phase 3: Comparing results...
📋 Configuration stdio: ✅ No changes

✅ No API Changes - All configurations match the baseline.
```

### Changes Detected

When changes are detected, the action shows a semantic diff with clear paths to each change:

```
📋 Configuration stdio: 3 change(s) found
```

The generated report shows exactly what changed using path notation:

```diff
--- base/tools.json
+++ branch/tools.json

+ tools[new_tool]: {"name": "new_tool", "description": "A newly added tool", ...}
- tools[old_tool].inputSchema.properties.name.description: "Old description"
+ tools[old_tool].inputSchema.properties.name.description: "Updated description"
- tools[calculator].inputSchema.properties.precision.type: "string"  
+ tools[calculator].inputSchema.properties.precision.type: "number"
```

```diff
--- base/resources.json
+++ branch/resources.json

+ resources[config://settings]: {"uri": "config://settings", "name": "Settings", ...}
```

Each line shows:
- `+` for additions (new tools, resources, or changed values)
- `-` for removals (deleted items or previous values)
- Full path to the change: `tools[tool_name].inputSchema.properties.param.type`

This makes it easy to see exactly what changed without wading through entire JSON dumps

## Recommended Workflow

```yaml
name: MCP Server Diff

on:
  workflow_dispatch:
  pull_request:
    branches: [main]
  push:
    branches: [main]
    tags: ['v*']

permissions:
  contents: read

jobs:
  mcp-diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: SamMorrowDrums/mcp-server-diff@v2
        with:
          setup_node: true
          install_command: npm ci
          build_command: npm run build
          configurations: |
            [
              {
                "name": "stdio",
                "transport": "stdio",
                "start_command": "node dist/stdio.js"
              },
              {
                "name": "streamable-http",
                "transport": "streamable-http",
                "start_command": "node dist/http.js",
                "server_url": "http://localhost:3000/mcp"
              }
            ]
```

## Troubleshooting

### Server fails to start

- Check that `start_command` works locally
- Increase `server_timeout` for slow-starting servers
- Verify all dependencies are installed by `install_command`

### Missing baseline

- Ensure `fetch-depth: 0` in your checkout step
- For new repositories, the first run may fail (no baseline exists)

### HTTP transport connection refused

- Verify `server_url` matches your server's listen address
- Ensure the server binds to `0.0.0.0` or `127.0.0.1`, not just `localhost` on some systems
- Check firewall or container networking if running in Docker

## License

MIT License. See [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Related Resources

- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [MCP Go SDK](https://github.com/modelcontextprotocol/go-sdk)

### Example Configurations

Working examples of this action in various languages:

| Language | Repository | Workflow |
|----------|------------|----------|
| TypeScript | [mcp-typescript-starter](https://github.com/SamMorrowDrums/mcp-typescript-starter) | [mcp-diff.yml](https://github.com/SamMorrowDrums/mcp-typescript-starter/blob/main/.github/workflows/mcp-diff.yml) |
| Python | [mcp-python-starter](https://github.com/SamMorrowDrums/mcp-python-starter) | [mcp-diff.yml](https://github.com/SamMorrowDrums/mcp-python-starter/blob/main/.github/workflows/mcp-diff.yml) |
| Go | [mcp-go-starter](https://github.com/SamMorrowDrums/mcp-go-starter) | [mcp-diff.yml](https://github.com/SamMorrowDrums/mcp-go-starter/blob/main/.github/workflows/mcp-diff.yml) |
| Rust | [mcp-rust-starter](https://github.com/SamMorrowDrums/mcp-rust-starter) | [mcp-diff.yml](https://github.com/SamMorrowDrums/mcp-rust-starter/blob/main/.github/workflows/mcp-diff.yml) |
| C# | [mcp-csharp-starter](https://github.com/SamMorrowDrums/mcp-csharp-starter) | [mcp-diff.yml](https://github.com/SamMorrowDrums/mcp-csharp-starter/blob/main/.github/workflows/mcp-diff.yml) |

For a production example, see [github-mcp-server](https://github.com/github/github-mcp-server).
