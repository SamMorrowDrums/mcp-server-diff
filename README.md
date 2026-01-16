# MCP Conformance Action

A reusable GitHub Actions workflow for testing [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server conformance between versions. This action detects behavioral changes in your MCP server by comparing the current branch against a base reference, helping you catch unintended regressions and document intentional API changes.

## Overview

MCP servers expose tools, resources, and prompts to AI assistants. As these servers evolve, it's critical to understand how changes affect their external behavior. This action automates conformance testing by:

1. Building your MCP server from both the current branch and a baseline (merge-base, tag, or specified ref)
2. Sending identical MCP protocol requests to both versions
3. Comparing responses and generating a detailed diff report
4. Surfacing results directly in GitHub's Job Summary

The action is **language-agnostic** at its core—it executes whatever install, build, and start commands you provide. Optional setup flags for common runtimes (Go, Node.js, Python, Rust, .NET) reduce boilerplate.

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
    uses: SamMorrowDrums/mcp-conformance-action/.github/workflows/conformance.yml@v1
    with:
      install_command: "npm ci"
      build_command: "npm run build"
      start_command: "node dist/stdio.js"
      setup_node: true
```

## Language Examples

### Go

```yaml
jobs:
  conformance:
    uses: SamMorrowDrums/mcp-conformance-action/.github/workflows/conformance.yml@v1
    with:
      install_command: "go mod download"
      build_command: "go build -o bin/server ./cmd/stdio"
      start_command: "./bin/server"
      setup_go: true
      go_version_file: "go.mod"
```

### Python

```yaml
jobs:
  conformance:
    uses: SamMorrowDrums/mcp-conformance-action/.github/workflows/conformance.yml@v1
    with:
      install_command: "pip install -e ."
      start_command: "python -m my_mcp_server"
      setup_python: true
      python_version: "3.11"
```

### TypeScript / Node.js

```yaml
jobs:
  conformance:
    uses: SamMorrowDrums/mcp-conformance-action/.github/workflows/conformance.yml@v1
    with:
      install_command: "npm ci"
      build_command: "npm run build"
      start_command: "node dist/stdio.js"
      setup_node: true
      node_version: "20"
```

### Rust

```yaml
jobs:
  conformance:
    uses: SamMorrowDrums/mcp-conformance-action/.github/workflows/conformance.yml@v1
    with:
      install_command: "cargo fetch"
      build_command: "cargo build --release"
      start_command: "./target/release/my-mcp-server"
      setup_rust: true
      rust_toolchain: "stable"
```

### C# / .NET

```yaml
jobs:
  conformance:
    uses: SamMorrowDrums/mcp-conformance-action/.github/workflows/conformance.yml@v1
    with:
      install_command: "dotnet restore"
      build_command: "dotnet build -c Release"
      start_command: "dotnet run --no-build -c Release"
      setup_dotnet: true
      dotnet_version: "8.0.x"
```

### Custom Runtime Setup

For languages without built-in setup support, configure your environment before invoking the action:

```yaml
jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up custom runtime
        run: |
          # Your setup commands here

      - uses: SamMorrowDrums/mcp-conformance-action@v1
        with:
          install_command: "my-package-manager install"
          start_command: "my-server --stdio"
```

## Inputs Reference

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
| `server_timeout` | Timeout in seconds to wait for server response | `10` |
| `working_directory` | Working directory for all commands | `.` |
| `env_vars` | Environment variables as newline-separated `KEY=VALUE` pairs | `""` |

Either `start_command` (for stdio) or `server_url` (for HTTP) must be provided.

### Comparison Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `compare_ref` | Git ref to compare against. Auto-detects merge-base on PRs or previous tag on tag pushes if not specified. | `""` |

### Runtime Setup (Optional)

These flags invoke the corresponding `actions/setup-*` action. If disabled, you must configure the runtime yourself.

| Input | Description | Default |
|-------|-------------|---------|
| `setup_go` | Set up Go using `actions/setup-go` | `false` |
| `go_version_file` | File to read Go version from | `go.mod` |
| `setup_node` | Set up Node.js using `actions/setup-node` | `false` |
| `node_version` | Node.js version | `20` |
| `setup_python` | Set up Python using `actions/setup-python` | `false` |
| `python_version` | Python version | `3.11` |
| `setup_rust` | Set up Rust using `dtolnay/rust-toolchain` | `false` |
| `rust_toolchain` | Rust toolchain | `stable` |
| `setup_dotnet` | Set up .NET using `actions/setup-dotnet` | `false` |
| `dotnet_version` | .NET SDK version | `8.0.x` |

### Multiple Configurations

| Input | Description | Default |
|-------|-------------|---------|
| `configurations` | JSON array of test configurations for testing multiple transports or modes | `""` |

## How It Works

### Execution Flow

1. **Checkout**: Clones the repository with full history (`fetch-depth: 0`)
2. **Runtime Setup**: Configures language runtime if any `setup_*` flag is enabled
3. **Baseline Detection**: Determines the comparison ref:
   - For pull requests: merge-base with target branch
   - For tag pushes: previous tag (e.g., `v1.1.0` compares against `v1.0.0`)
   - Explicit: uses `compare_ref` if provided
4. **Build Baseline**: Creates a git worktree at the baseline ref and builds the server
5. **Build Current**: Builds the server from the current branch
6. **Conformance Testing**: Sends MCP protocol requests to both servers:
   - `initialize` - Server capabilities and metadata
   - `tools/list` - Available tools and their schemas
   - `resources/list` - Available resources
   - `prompts/list` - Available prompts
7. **Report Generation**: Produces a Markdown report with diffs, uploaded as an artifact and displayed in Job Summary

### What Gets Compared

The action compares JSON responses from both server versions for each MCP method. Differences appear as unified diffs in the report. Common expected differences include:

- New tools, resources, or prompts added
- Schema changes (new parameters, updated descriptions)
- Capability changes (new features enabled)
- Version string updates

## Transport Support

### stdio Transport

The default transport communicates with your server via stdin/stdout using JSON-RPC:

```yaml
with:
  start_command: "node dist/stdio.js"
  transport: "stdio"
```

### Streamable HTTP Transport

For servers exposing an HTTP endpoint:

```yaml
with:
  start_command: "node dist/http.js"
  transport: "streamable-http"
  server_url: "http://localhost:3000/mcp"
```

The action will:
1. Start the server using `start_command`
2. Poll the endpoint until it responds (up to `server_timeout` seconds)
3. Send MCP requests via HTTP POST
4. Terminate the server after tests complete

For pre-deployed servers, omit `start_command`:

```yaml
with:
  install_command: "true"  # No-op
  transport: "streamable-http"
  server_url: "https://mcp.example.com/api"
```

## Testing Multiple Configurations

Test different transports, flags, or environment configurations in a single workflow run:

```yaml
with:
  install_command: "npm ci"
  build_command: "npm run build"
  setup_node: true
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
      },
      {
        "name": "debug-mode",
        "transport": "stdio",
        "start_command": "node dist/stdio.js",
        "env_vars": "DEBUG=mcp:*"
      }
    ]
```

Each configuration object supports:

| Field | Description | Required |
|-------|-------------|----------|
| `name` | Identifier for this configuration (appears in report) | Yes |
| `transport` | `stdio` or `streamable-http` | No (default: `stdio`) |
| `start_command` | Server start command | Yes (unless using external server) |
| `server_url` | URL for HTTP transport | Required if transport is `streamable-http` |
| `env_vars` | Additional environment variables | No |

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
with:
  compare_ref: "v1.0.0"           # Compare against a tag
  compare_ref: "main"             # Compare against a branch
  compare_ref: "abc123def"        # Compare against a commit SHA
```

## Artifacts and Reports

The action produces:

1. **Job Summary**: Inline Markdown report in the GitHub Actions UI showing test results and diffs
2. **Artifact**: `conformance-report` artifact containing `CONFORMANCE_REPORT.md` for download or further processing

## Recommended Workflow Configuration

```yaml
name: Conformance Test

on:
  workflow_dispatch:  # Manual trigger for debugging
  pull_request:
    branches: [main]
  push:
    branches: [main]
    tags: ['v*']

permissions:
  contents: read

jobs:
  conformance:
    uses: SamMorrowDrums/mcp-conformance-action/.github/workflows/conformance.yml@v1
    with:
      install_command: "npm ci"
      build_command: "npm run build"
      setup_node: true
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

This configuration:
- Runs on every PR to catch regressions before merge
- Runs on pushes to main to validate merged changes
- Runs on version tags to compare releases
- Supports manual triggering for debugging
- Tests both stdio and HTTP transports

## Troubleshooting

### Server fails to start

- Check that `start_command` works locally
- Increase `server_timeout` for slow-starting servers
- Verify all dependencies are installed by `install_command`

### Missing baseline

- Ensure `fetch-depth: 0` if using the composite action directly
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
