# Contributing to MCP Server Diff

Thank you for your interest in contributing! This document provides guidelines for contributing to MCP Server Diff.

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

- Node.js 20+
- npm
- Git

### Building

```bash
# Install dependencies
npm ci

# Run tests
npm test

# Type check, lint, and format
npm run check

# Build the action
npm run build
```

### Testing Locally

To test the action locally, you can run the built action directly:

```bash
# Build the action
npm run build

# Set environment variables that mimic GitHub Actions inputs
export INPUT_INSTALL_COMMAND="npm ci"
export INPUT_BUILD_COMMAND="npm run build"
export INPUT_START_COMMAND="node dist/stdio.js"

# Run the action
node dist/index.js
```

## Code Style

- TypeScript with strict mode
- ESLint for linting
- Prettier for formatting
- Run `npm run check` before submitting PRs

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
