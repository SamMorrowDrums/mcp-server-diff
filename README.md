# MCP Conformance Action

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-MCP%20Conformance%20Test-blue?logo=github)](https://github.com/marketplace/actions/mcp-conformance-test)
[![GitHub release](https://img.shields.io/github/v/release/SamMorrowDrums/mcp-conformance-action)](https://github.com/SamMorrowDrums/mcp-conformance-action/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A GitHub Action for detecting changes to [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server **public interfaces**. This action compares the current branch against a baseline to surface any changes to your server's exposed tools, resources, prompts, and capabilities—helping you catch unintended breaking changes and document intentional API evolution.

## Overview

MCP servers expose a **public interface** to AI assistants: tools (with their input schemas), resources, prompts, and server capabilities. As your server evolves, changes to this interface can break clients or alter expected behavior. This action automates public interface comparison by:

1. Building your MCP server from both the current branch and a baseline (merge-base, tag, or specified ref)
2. Querying both versions for their complete public interface (tools, resources, prompts, capabilities)
3. Generating a detailed diff report showing exactly what changed
4. Surfacing results directly in GitHub's Job Summary

This is **not** about testing internal logic or correctness—it's about visibility into what your server _advertises_ to clients.

## Quick Start

Create `.github/workflows/conformance.yml` in your repository:

```yaml
name: Conformance Test

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
    tags: ['v*']

permissions:
  contents: read

jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: SamMorrowDrums/mcp-conformance-action@v1
        with:
          setup_node: true
          install_command: npm ci
          build_command: npm run build
          start_command: node dist/stdio.js
```

## Language Examples

### Node.js / TypeScript

```yaml
- uses: SamMorrowDrums/mcp-conformance-action@v1
  with:
    setup_node: true
    node_version: '22'
    install_command: npm ci
    build_command: npm run build
    start_command: node dist/stdio.js
```

### Python

```yaml
- uses: SamMorrowDrums/mcp-conformance-action@v1
  with:
    setup_python: true
    python_version: '3.12'
    install_command: pip install -e .
    start_command: python -m my_mcp_server
```

### Go

```yaml
- uses: SamMorrowDrums/mcp-conformance-action@v1
  with:
    setup_go: true
    install_command: go mod download
    build_command: go build -o bin/server ./cmd/stdio
    start_command: ./bin/server
```

### Rust

```yaml
- uses: SamMorrowDrums/mcp-conformance-action@v1
  with:
    setup_rust: true
    install_command: cargo fetch
    build_command: cargo build --release
    start_command: ./target/release/my-mcp-server
```

### C# / .NET

```yaml
- uses: SamMorrowDrums/mcp-conformance-action@v1
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

  - uses: SamMorrowDrums/mcp-conformance-action@v1
    with:
      install_command: npm ci
      build_command: npm run build
      start_command: node dist/stdio.js
```

## Testing Multiple Transports

Test both stdio and HTTP transports in a single run using the `configurations` input:

```yaml
- uses: SamMorrowDrums/mcp-conformance-action@v1
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

The default transport communicates with your server via stdin/stdout using JSON-RPC:

```yaml
- uses: SamMorrowDrums/mcp-conformance-action@v1
  with:
    setup_node: true
    install_command: npm ci
    build_command: npm run build
    start_command: node dist/stdio.js
```

### Streamable HTTP Transport

For servers exposing an HTTP endpoint, the action can automatically manage the server lifecycle. Use `start_command` and the action will spawn your server, wait for it to start, probe it, then shut it down:

```yaml
- uses: SamMorrowDrums/mcp-conformance-action@v1
  with:
    setup_node: true
    install_command: npm ci
    build_command: npm run build
    configurations: |
      [{
        "name": "http-server",
        "transport": "streamable-http",
        "start_command": "node dist/http.js",
        "server_url": "http://localhost:3000/mcp",
        "startup_wait_ms": 2000
      }]
```

The action will:
1. Start the server using `start_command`
2. Wait `startup_wait_ms` (default: 2000ms) for the server to initialize
3. Send MCP requests via HTTP POST
4. Terminate the server after tests complete

For more control, you can use `pre_test_command` and `post_test_command` to manage server lifecycle yourself:

```yaml
configurations: |
  [{
    "name": "http-server",
    "transport": "streamable-http",
    "server_url": "http://localhost:3000/mcp",
    "pre_test_command": "node dist/http.js &",
    "pre_test_wait_ms": 2000,
    "post_test_command": "pkill -f 'node dist/http.js' || true"
  }]
```

For pre-deployed servers, omit both `start_command` and `pre_test_command`:

```yaml
- uses: SamMorrowDrums/mcp-conformance-action@v1
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
- uses: SamMorrowDrums/mcp-conformance-action@v1
  with:
    setup_node: true
    install_command: npm ci
    build_command: npm run build
    start_command: node dist/stdio.js
    compare_ref: v1.0.0
```

## Artifacts and Reports

The action produces:

1. **Job Summary**: Inline Markdown report in the GitHub Actions UI showing test results and diffs
2. **Artifact**: `conformance-report` artifact containing `CONFORMANCE_REPORT.md` for download or further processing

## Recommended Workflow

```yaml
name: Conformance Test

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
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: SamMorrowDrums/mcp-conformance-action@v1
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
