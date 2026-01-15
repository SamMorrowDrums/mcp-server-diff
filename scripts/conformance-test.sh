#!/bin/bash
set -e

# MCP Conformance Test Script
# A generic conformance test for comparing MCP server behavior between versions.
#
# Environment variables (required):
#   MCP_INSTALL_COMMAND - Command to install dependencies
#   MCP_BUILD_COMMAND   - Command to build the server
#   MCP_START_COMMAND   - Command to start the MCP server (stdio transport)
#
# Environment variables (optional):
#   MCP_SERVER_TIMEOUT  - Timeout in seconds for server response (default: 10)
#
# Output:
#   - Progress/status messages go to stderr (for visibility in CI)
#   - Final report summary goes to stdout (for piping/capture)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(pwd)"
REPORT_DIR="$PROJECT_DIR/conformance-report"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD")

# Configuration from environment
INSTALL_CMD="${MCP_INSTALL_COMMAND:-}"
BUILD_CMD="${MCP_BUILD_COMMAND:-}"
START_CMD="${MCP_START_COMMAND:-}"
SERVER_TIMEOUT="${MCP_SERVER_TIMEOUT:-10}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper to print to stderr
log() {
    echo -e "$@" >&2
}

log "${BLUE}=== MCP Server Conformance Test ===${NC}"
log "Current branch: $CURRENT_BRANCH"
log "Report directory: $REPORT_DIR"
log ""

# Validate required environment variables
if [ -z "$INSTALL_CMD" ] || [ -z "$BUILD_CMD" ] || [ -z "$START_CMD" ]; then
    log "${RED}Error: Required environment variables not set${NC}"
    log "  MCP_INSTALL_COMMAND: ${INSTALL_CMD:-<not set>}"
    log "  MCP_BUILD_COMMAND: ${BUILD_CMD:-<not set>}"
    log "  MCP_START_COMMAND: ${START_CMD:-<not set>}"
    exit 1
fi

log "Configuration:"
log "  Install: $INSTALL_CMD"
log "  Build:   $BUILD_CMD"
log "  Start:   $START_CMD"
log "  Timeout: ${SERVER_TIMEOUT}s"
log ""

# Find the common ancestor with origin/main (or main if origin not available)
if git rev-parse --verify origin/main >/dev/null 2>&1; then
    BASE_REF="origin/main"
elif git rev-parse --verify main >/dev/null 2>&1; then
    BASE_REF="main"
else
    BASE_REF=$(git rev-list --max-parents=0 HEAD | head -1)
fi

MERGE_BASE=$(git merge-base HEAD "$BASE_REF" 2>/dev/null || echo "$BASE_REF")
log "Comparing against merge-base: $MERGE_BASE"
log ""

# Create report directory
rm -rf "$REPORT_DIR"
mkdir -p "$REPORT_DIR"/{main,branch,diffs}

# MCP JSON-RPC messages
INIT_MSG='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"conformance-test","version":"1.0.0"}}}'
INITIALIZED_MSG='{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'
LIST_TOOLS_MSG='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
LIST_RESOURCES_MSG='{"jsonrpc":"2.0","id":3,"method":"resources/list","params":{}}'
LIST_PROMPTS_MSG='{"jsonrpc":"2.0","id":4,"method":"prompts/list","params":{}}'
LIST_RESOURCE_TEMPLATES_MSG='{"jsonrpc":"2.0","id":5,"method":"resources/templates/list","params":{}}'

# Function to normalize JSON for comparison
# Sorts all arrays (including nested ones) and formats consistently
normalize_json() {
    local file="$1"
    if [ -s "$file" ]; then
        jq -S '
            # Function to sort arrays recursively
            def deep_sort:
                if type == "array" then
                    [.[] | deep_sort] | sort_by(tostring)
                elif type == "object" then
                    to_entries | map(.value |= deep_sort) | from_entries
                else
                    .
                end;
            deep_sort
        ' "$file" 2>/dev/null > "${file}.tmp" && mv "${file}.tmp" "$file"
    fi
}

# Function to run MCP server and capture output
run_mcp_test() {
    local working_dir="$1"
    local name="$2"
    local output_prefix="$3"
    
    local start_time end_time duration
    start_time=$(date +%s.%N 2>/dev/null || date +%s)
    
    # Run the server with all list commands
    output=$(
        (
            echo "$INIT_MSG"
            echo "$INITIALIZED_MSG"
            sleep 0.1
            echo "$LIST_TOOLS_MSG"
            sleep 0.1
            echo "$LIST_RESOURCES_MSG"
            sleep 0.1
            echo "$LIST_PROMPTS_MSG"
            sleep 0.1
            echo "$LIST_RESOURCE_TEMPLATES_MSG"
            sleep 0.5
        ) | timeout "${SERVER_TIMEOUT}s" bash -c "cd '$working_dir' && $START_CMD" 2>/dev/null || true
    )
    
    end_time=$(date +%s.%N 2>/dev/null || date +%s)
    duration=$(echo "$end_time - $start_time" | bc 2>/dev/null || echo "0")
    
    # Parse and save each response by matching JSON-RPC id
    echo "$output" | while IFS= read -r line; do
        [ -z "$line" ] && continue
        id=$(echo "$line" | jq -r '.id // empty' 2>/dev/null)
        case "$id" in
            1) echo "$line" | jq -S '.' > "${output_prefix}_initialize.json" 2>/dev/null ;;
            2) echo "$line" | jq -S '.' > "${output_prefix}_tools.json" 2>/dev/null ;;
            3) echo "$line" | jq -S '.' > "${output_prefix}_resources.json" 2>/dev/null ;;
            4) echo "$line" | jq -S '.' > "${output_prefix}_prompts.json" 2>/dev/null ;;
            5) echo "$line" | jq -S '.' > "${output_prefix}_resource_templates.json" 2>/dev/null ;;
        esac
    done
    
    # Create empty files if not created
    touch "${output_prefix}_initialize.json" "${output_prefix}_tools.json" \
          "${output_prefix}_resources.json" "${output_prefix}_prompts.json" \
          "${output_prefix}_resource_templates.json"
    
    # Normalize all JSON files for consistent comparison
    for endpoint in initialize tools resources prompts resource_templates; do
        normalize_json "${output_prefix}_${endpoint}.json"
    done
    
    echo "$duration"
}

# Build and test both versions
log "${YELLOW}Building and testing both versions...${NC}"
log ""

# --- BUILD AND TEST CURRENT BRANCH ---
log "${BLUE}Building current branch ($CURRENT_BRANCH)...${NC}"

log "  Running install command..."
if ! eval "$INSTALL_CMD" >/dev/null 2>&1; then
    log "${RED}  Install failed!${NC}"
    exit 1
fi
log "${GREEN}  Install successful${NC}"

log "  Running build command..."
if ! eval "$BUILD_CMD" >/dev/null 2>&1; then
    log "${RED}  Build failed!${NC}"
    exit 1
fi
log "${GREEN}  Build successful${NC}"

mkdir -p "$REPORT_DIR/branch/default"
log "  Running conformance test..."
branch_time=$(run_mcp_test "$PROJECT_DIR" "branch" "$REPORT_DIR/branch/default/output")
log "${GREEN}  Test complete (${branch_time}s)${NC}"
log ""

# --- BUILD AND TEST BASE BRANCH ---
log "${BLUE}Building base branch (merge-base: $MERGE_BASE)...${NC}"

TEMP_WORKTREE=$(mktemp -d)
git worktree add --quiet "$TEMP_WORKTREE" "$MERGE_BASE" 2>/dev/null || {
    log "${YELLOW}  Could not create worktree, using checkout instead${NC}"
    git checkout --quiet "$MERGE_BASE"
    TEMP_WORKTREE=""
}

WORK_DIR="${TEMP_WORKTREE:-$PROJECT_DIR}"

log "  Running install command..."
if ! (cd "$WORK_DIR" && eval "$INSTALL_CMD") >/dev/null 2>&1; then
    log "${YELLOW}  Install warning (may be expected for older version)${NC}"
fi

log "  Running build command..."
if ! (cd "$WORK_DIR" && eval "$BUILD_CMD") >/dev/null 2>&1; then
    log "${YELLOW}  Build warning (may be expected for older version)${NC}"
fi

mkdir -p "$REPORT_DIR/main/default"
log "  Running conformance test..."
main_time=$(run_mcp_test "$WORK_DIR" "main" "$REPORT_DIR/main/default/output")
log "${GREEN}  Test complete (${main_time}s)${NC}"

# Cleanup worktree
if [ -n "$TEMP_WORKTREE" ]; then
    git worktree remove --force "$TEMP_WORKTREE" 2>/dev/null || true
else
    git checkout --quiet "$CURRENT_BRANCH" 2>/dev/null || git checkout --quiet -
fi
log ""

# --- GENERATE DIFFS ---
log "${YELLOW}Generating comparison report...${NC}"

mkdir -p "$REPORT_DIR/diffs/default"
has_diff=false
endpoints="initialize tools resources prompts resource_templates"

for endpoint in $endpoints; do
    main_file="$REPORT_DIR/main/default/output_${endpoint}.json"
    branch_file="$REPORT_DIR/branch/default/output_${endpoint}.json"
    diff_file="$REPORT_DIR/diffs/default/${endpoint}.diff"
    
    if ! diff -u "$main_file" "$branch_file" > "$diff_file" 2>/dev/null; then
        has_diff=true
        lines=$(wc -l < "$diff_file" | tr -d ' ')
        log "  ${YELLOW}${endpoint}: DIFF (${lines} lines)${NC}"
    else
        rm -f "$diff_file"
        log "  ${GREEN}${endpoint}: OK${NC}"
    fi
done
log ""

# --- GENERATE REPORT ---
REPORT_FILE="$REPORT_DIR/CONFORMANCE_REPORT.md"

time_diff=$(echo "$branch_time - $main_time" | bc 2>/dev/null || echo "0")
if (( $(echo "$time_diff > 0" | bc -l 2>/dev/null || echo "0") )); then
    delta_str="+${time_diff}s"
else
    delta_str="${time_diff}s"
fi

if [ "$has_diff" = true ]; then
    status_str="⚠️ DIFF"
    diff_count=1
    ok_count=0
else
    status_str="✅ OK"
    diff_count=0
    ok_count=1
fi

cat > "$REPORT_FILE" << EOF
# MCP Server Conformance Report

Generated: $(date)
Current Branch: $CURRENT_BRANCH
Compared Against: merge-base ($MERGE_BASE)

## Summary

| Test | Base Time | Branch Time | Δ Time | Status |
|------|-----------|-------------|--------|--------|
| default | ${main_time}s | ${branch_time}s | $delta_str | $status_str |

## Statistics

- **Tests Passed (no diff):** $ok_count
- **Tests with Differences:** $diff_count
- **Total Base Time:** ${main_time}s
- **Total Branch Time:** ${branch_time}s
- **Overall Time Delta:** $delta_str

## Detailed Diffs

EOF

if [ "$has_diff" = true ]; then
    echo "### default" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    
    for endpoint in $endpoints; do
        diff_file="$REPORT_DIR/diffs/default/${endpoint}.diff"
        if [ -f "$diff_file" ] && [ -s "$diff_file" ]; then
            echo "#### ${endpoint}" >> "$REPORT_FILE"
            echo '```diff' >> "$REPORT_FILE"
            cat "$diff_file" >> "$REPORT_FILE"
            echo '```' >> "$REPORT_FILE"
            echo "" >> "$REPORT_FILE"
        fi
    done
else
    echo "_No differences detected._" >> "$REPORT_FILE"
fi

log "${BLUE}=== Conformance Test Complete ===${NC}"
log ""
log "Report: ${GREEN}$REPORT_FILE${NC}"
log ""

# Output summary to stdout
echo "=== Conformance Test Summary ==="
echo "Tests passed: $ok_count"
echo "Tests with diffs: $diff_count"
echo "Total base time: ${main_time}s"
echo "Total branch time: ${branch_time}s"
echo "Time delta: $delta_str"

if [ $diff_count -gt 0 ]; then
    log ""
    log "${YELLOW}⚠️  Differences detected. Review the diffs in:${NC}"
    log "   $REPORT_DIR/diffs/"
    echo ""
    echo "RESULT: DIFFERENCES FOUND"
else
    echo ""
    echo "RESULT: ALL TESTS PASSED"
fi
