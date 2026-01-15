# MCP Conformance Action

A reusable GitHub Actions workflow for testing MCP (Model Context Protocol) server conformance between versions. This action helps you detect behavioral changes in your MCP server by comparing the current branch against the base branch.

## Features

- 📊 **Conformance Testing**: Compares MCP server responses between versions
- 🔄 **Version Comparison**: Tests against merge-base to show exactly what changed
- 📝 **Detailed Reports**: Generates markdown reports with diffs in GitHub Job Summary
- ⚡ **Language Agnostic**: Works with any MCP server (Go, Python, TypeScript, Rust, C#, etc.)
- 🎯 **Customizable**: Configure build/start commands, environment variables, and test configurations

## Quick Start

### Using the Reusable Workflow

Add this to your `.github/workflows/conformance.yml`:

```yaml
name: Conformance Test

on:
  pull_request:

permissions:
  contents: read

jobs:
  conformance:
    uses: sammorrowdrums/mcp-conformance-action/.github/workflows/conformance.yml@main
    with:
      install_command: "npm install"
      build_command: "npm run build"
      start_command: "node dist/stdio.js"
```

### Language-Specific Examples

#### Go
```yaml
jobs:
  conformance:
    uses: sammorrowdrums/mcp-conformance-action/.github/workflows/conformance.yml@main
    with:
      install_command: "go mod download"
      build_command: "go build -o bin/server ./cmd/stdio"
      start_command: "./bin/server"
      setup_go: true
```

#### Python
```yaml
jobs:
  conformance:
    uses: sammorrowdrums/mcp-conformance-action/.github/workflows/conformance.yml@main
    with:
      install_command: "pip install -e ."
      start_command: "python -m my_mcp_server"
      setup_python: true
```

#### TypeScript/Node.js
```yaml
jobs:
  conformance:
    uses: sammorrowdrums/mcp-conformance-action/.github/workflows/conformance.yml@main
    with:
      install_command: "npm install"
      build_command: "npm run build"
      start_command: "node dist/stdio.js"
      setup_node: true
```

#### Rust
```yaml
jobs:
  conformance:
    uses: sammorrowdrums/mcp-conformance-action/.github/workflows/conformance.yml@main
    with:
      install_command: "cargo fetch"
      build_command: "cargo build --release"
      start_command: "./target/release/my-mcp-server"
      setup_rust: true
```

#### C# / .NET
```yaml
jobs:
  conformance:
    uses: sammorrowdrums/mcp-conformance-action/.github/workflows/conformance.yml@main
    with:
      install_command: "dotnet restore"
      build_command: "dotnet build -c Release"
      start_command: "dotnet run --no-build -c Release"
      setup_dotnet: true
```

#### Other Languages (Manual Setup)

For languages not directly supported, you can set up the environment manually in your workflow before calling the conformance action:

```yaml
jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      # Your custom setup steps
      - name: Set up my runtime
        run: |
          # Install your language/runtime here
          
      - name: Run conformance test
        uses: sammorrowdrums/mcp-conformance-action@v1
        with:
          install_command: "my-install-command"
          start_command: "my-start-command"
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `compare_ref` | Git ref to compare against (auto-detects merge-base or previous tag if not set) | No | `""` |
| `install_command` | Command to install dependencies | Yes | - |
| `build_command` | Command to build the server (optional for interpreted languages) | No | `""` |
| `start_command` | Command to start the MCP server (stdio transport) | No* | `""` |
| `transport` | Transport type: `stdio` or `http` | No | `stdio` |
| `server_url` | Server URL for HTTP transport (e.g., `http://localhost:3000/mcp`) | No* | `""` |
| `health_endpoint` | Health check endpoint for HTTP servers | No | `/health` |
| `configurations` | JSON array of test configurations (for multiple configs) | No | `""` |
| `env_vars` | Environment variables (newline-separated KEY=VALUE pairs) | No | `""` |
| `working_directory` | Working directory for commands | No | `.` |
| `setup_go` | Set up Go environment | No | `false` |
| `go_version_file` | Go version file to use | No | `go.mod` |
| `setup_node` | Set up Node.js environment | No | `false` |
| `node_version` | Node.js version to use | No | `20` |
| `setup_python` | Set up Python environment | No | `false` |
| `python_version` | Python version to use | No | `3.11` |
| `setup_rust` | Set up Rust environment | No | `false` |
| `rust_toolchain` | Rust toolchain to use | No | `stable` |
| `setup_dotnet` | Set up .NET environment | No | `false` |
| `dotnet_version` | .NET version to use | No | `8.0.x` |

*Either `start_command` (for stdio) or `server_url` (for http) is required.

## How It Works

1. **Checkout**: Fetches full git history to access merge-base
2. **Setup**: Configures the appropriate language runtime
3. **Build Both Versions**: 
   - Creates a worktree at the merge-base commit
   - Builds the server from both the base and current branch
4. **Run Conformance Tests**: 
   - Sends MCP protocol messages to both server versions
   - Compares responses (initialize, tools/list, resources/list, prompts/list)
5. **Generate Report**: 
   - Creates a detailed markdown report with diffs
   - Displays results in GitHub Job Summary

## Output Report

The conformance test generates a report showing:

- ✅ Tests that passed (identical responses)
- ⚠️ Tests with differences (behavioral changes detected)
- Detailed diffs for any changed responses
- Timing comparison between versions

## Recommended Triggers

For best results, configure the workflow to run on:

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
    tags: ['v*']
```

This ensures you catch changes:
- Before merging (PR reviews)
- After merging (validation)  
- On releases (version comparison)

## Comparing Tags / Releases

When triggered by a tag push, the action **automatically detects the previous tag** and compares against it. This is perfect for release validation:

```yaml
# Automatically compares v1.1.0 against v1.0.0
on:
  push:
    tags: ['v*']
```

You can also explicitly specify what to compare against using `compare_ref`:

```yaml
jobs:
  conformance:
    uses: sammorrowdrums/mcp-conformance-action/.github/workflows/conformance.yml@main
    with:
      compare_ref: 'v1.0.0'  # Compare against specific version
      install_command: "npm install"
      build_command: "npm run build"
      start_command: "node dist/stdio.js"
```

The `compare_ref` input accepts any valid git ref:
- Tags: `v1.0.0`, `release-2024-01`
- Branches: `main`, `develop`
- Commit SHAs: `abc123`

## HTTP Transport

For servers that expose an HTTP endpoint instead of stdio:

```yaml
jobs:
  conformance:
    uses: sammorrowdrums/mcp-conformance-action/.github/workflows/conformance.yml@main
    with:
      install_command: "npm install"
      build_command: "npm run build"
      start_command: "node dist/http-server.js"  # Starts HTTP server
      transport: "http"
      server_url: "http://localhost:3000/mcp"
      health_endpoint: "/health"
      setup_node: true
```

The action will:
1. Start your server using `start_command`
2. Wait for the health endpoint to respond
3. Send MCP requests via HTTP POST
4. Stop the server after tests complete

For external/remote servers (already running), omit `start_command`:

```yaml
jobs:
  conformance:
    uses: sammorrowdrums/mcp-conformance-action/.github/workflows/conformance.yml@main
    with:
      install_command: "echo 'no install needed'"
      transport: "http"
      server_url: "https://my-mcp-server.example.com/mcp"
```

## Multiple Configurations

Test your server with different configurations (e.g., stdio vs HTTP, different flags):

```yaml
jobs:
  conformance:
    uses: sammorrowdrums/mcp-conformance-action/.github/workflows/conformance.yml@main
    with:
      install_command: "npm install"
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
            "name": "http",
            "transport": "http",
            "start_command": "node dist/http.js",
            "server_url": "http://localhost:3000/mcp",
            "health_endpoint": "/health"
          },
          {
            "name": "stdio-debug",
            "transport": "stdio",
            "start_command": "node dist/stdio.js --debug",
            "env_vars": "DEBUG=true"
          }
        ]
```

Each configuration in the array can have:
- `name` (required): Identifier for this config
- `transport`: `stdio` or `http` (default: `stdio`)
- `start_command`: Command to start the server
- `server_url`: URL for HTTP transport
- `health_endpoint`: Health check path for HTTP (default: `/health`)
- `env_vars`: Additional environment variables

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
