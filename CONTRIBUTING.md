# Contributing to MCP Conformance Action

Thank you for your interest in contributing! This document provides guidelines for contributing to the MCP Conformance Action.

## How to Contribute

### Reporting Bugs

1. Check existing issues to avoid duplicates
2. Use the bug report template
3. Include:
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, language runtime versions)
   - Workflow configuration

### Suggesting Features

1. Open a feature request issue
2. Describe the use case
3. Explain how it benefits MCP server developers

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Test thoroughly
5. Submit a PR with a clear description

## Development Setup

### Prerequisites

- Bash 4.0+
- jq
- Git

### Testing Locally

```bash
# Set required environment variables
export MCP_INSTALL_COMMAND="npm install"
export MCP_BUILD_COMMAND="npm run build"
export MCP_START_COMMAND="node dist/stdio.js"

# Run the conformance test
./scripts/conformance-test.sh
```

## Code Style

- Use shellcheck for bash scripts
- Add comments for complex logic
- Keep functions small and focused

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
