#!/bin/bash
set -e

# MCP Conformance Test Script
# A generic conformance test for comparing MCP server behavior between versions.
#
# Environment variables (required):
#   MCP_INSTALL_COMMAND - Command to install dependencies
#   MCP_START_COMMAND   - Command to start the MCP server (stdio transport)
#
# Environment variables (optional):
#   MCP_BUILD_COMMAND   - Command to build the server (optional for interpreted languages)
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
COMPARE_REF="${MCP_COMPARE_REF:-}"
GH_REF="${GITHUB_REF:-}"
TRANSPORT="${MCP_TRANSPORT:-stdio}"
SERVER_URL="${MCP_SERVER_URL:-}"
HEALTH_ENDPOINT="${MCP_HEALTH_ENDPOINT:-/health}"
CONFIGURATIONS="${MCP_CONFIGURATIONS:-}"

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
if [ -z "$INSTALL_CMD" ]; then
    log "${RED}Error: MCP_INSTALL_COMMAND not set${NC}"
    exit 1
fi

# Build configurations array
declare -a CONFIGS
if [ -n "$CONFIGURATIONS" ]; then
    # Parse JSON configurations
    config_count=$(echo "$CONFIGURATIONS" | jq -r 'length')
    for ((i=0; i<config_count; i++)); do
        CONFIGS+=("$(echo "$CONFIGURATIONS" | jq -c ".[$i]")")
    done
    log "Loaded $config_count configuration(s) from JSON"
else
    # Single default configuration from env vars
    if [ -z "$START_CMD" ] && [ -z "$SERVER_URL" ]; then
        log "${RED}Error: Either start_command (stdio) or server_url (http) is required${NC}"
        exit 1
    fi
    default_config=$(jq -n \
        --arg name "default" \
        --arg start_command "$START_CMD" \
        --arg transport "$TRANSPORT" \
        --arg server_url "$SERVER_URL" \
        --arg health_endpoint "$HEALTH_ENDPOINT" \
        '{name: $name, start_command: $start_command, transport: $transport, server_url: $server_url, health_endpoint: $health_endpoint}')
    CONFIGS+=("$default_config")
fi

log "Configuration:"
log "  Install: $INSTALL_CMD"
log "  Build:   ${BUILD_CMD:-<skipped>}"
log "  Timeout: ${SERVER_TIMEOUT}s"
log "  Test Configurations: ${#CONFIGS[@]}"
for config in "${CONFIGS[@]}"; do
    cfg_name=$(echo "$config" | jq -r '.name')
    cfg_transport=$(echo "$config" | jq -r '.transport // "stdio"')
    log "    - $cfg_name ($cfg_transport)"
done
log ""

# Determine what to compare against
# Priority: 1) Explicit compare_ref, 2) Auto-detect previous tag, 3) Merge-base with main
if [ -n "$COMPARE_REF" ]; then
    # Explicit reference provided
    MERGE_BASE="$COMPARE_REF"
    log "Using explicit compare ref: $MERGE_BASE"
elif [[ "$GH_REF" == refs/tags/* ]]; then
    # Tag push - try to find previous tag
    CURRENT_TAG="${GH_REF#refs/tags/}"
    log "Detected tag push: $CURRENT_TAG"
    
    # Get all tags sorted by version, find previous one
    PREVIOUS_TAG=$(git tag --sort=-v:refname | grep -A1 "^${CURRENT_TAG}$" | tail -1)
    
    if [ -n "$PREVIOUS_TAG" ] && [ "$PREVIOUS_TAG" != "$CURRENT_TAG" ]; then
        MERGE_BASE="$PREVIOUS_TAG"
        log "Auto-detected previous tag: $MERGE_BASE"
    else
        # No previous tag found, fall back to first commit
        MERGE_BASE=$(git rev-list --max-parents=0 HEAD | head -1)
        log "${YELLOW}No previous tag found, comparing against initial commit${NC}"
    fi
else
    # Default: find merge-base with main
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
        BASE_REF="origin/main"
    elif git rev-parse --verify main >/dev/null 2>&1; then
        BASE_REF="main"
    else
        BASE_REF=$(git rev-list --max-parents=0 HEAD | head -1)
    fi
    MERGE_BASE=$(git merge-base HEAD "$BASE_REF" 2>/dev/null || echo "$BASE_REF")
    log "Using merge-base with $BASE_REF: $MERGE_BASE"
fi
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

# Function to wait for HTTP server to be ready
wait_for_server() {
    local url="$1"
    local health="$2"
    local timeout="$3"
    local start_time=$(date +%s)
    
    while true; do
        if curl -sf "${url}${health}" >/dev/null 2>&1; then
            return 0
        fi
        
        local elapsed=$(($(date +%s) - start_time))
        if [ $elapsed -ge $timeout ]; then
            return 1
        fi
        sleep 0.5
    done
}

# Function to send MCP request via HTTP POST
send_http_request() {
    local url="$1"
    local message="$2"
    local timeout="$3"
    
    curl -sf -X POST "$url" \
        -H "Content-Type: application/json" \
        -d "$message" \
        --max-time "$timeout" 2>/dev/null || echo "{}"
}

# Function to run MCP server test via HTTP
run_mcp_test_http() {
    local working_dir="$1"
    local name="$2"
    local output_prefix="$3"
    local cfg_start_cmd="$4"
    local cfg_server_url="$5"
    local cfg_health="$6"
    local cfg_env="$7"
    
    local start_time end_time duration
    local server_pid=""
    
    start_time=$(date +%s.%N 2>/dev/null || date +%s)
    
    # Start server if start_command provided (otherwise assume external server)
    if [ -n "$cfg_start_cmd" ]; then
        log "    Starting HTTP server..."
        (
            cd "$working_dir"
            if [ -n "$cfg_env" ]; then
                export $cfg_env
            fi
            eval "$cfg_start_cmd" &
        ) &
        server_pid=$!
        
        # Wait for server to be ready
        if ! wait_for_server "$cfg_server_url" "$cfg_health" "$SERVER_TIMEOUT"; then
            log "    ${RED}Server failed to start${NC}"
            [ -n "$server_pid" ] && kill $server_pid 2>/dev/null
            return 1
        fi
        log "    ${GREEN}Server ready${NC}"
    fi
    
    # Initialize
    init_response=$(send_http_request "$cfg_server_url" "$INIT_MSG" "$SERVER_TIMEOUT")
    echo "$init_response" | jq -S '.' > "${output_prefix}_initialize.json" 2>/dev/null
    
    # Send initialized notification (no response expected)
    send_http_request "$cfg_server_url" "$INITIALIZED_MSG" "$SERVER_TIMEOUT" >/dev/null 2>&1
    
    # List tools
    tools_response=$(send_http_request "$cfg_server_url" "$LIST_TOOLS_MSG" "$SERVER_TIMEOUT")
    echo "$tools_response" | jq -S '.' > "${output_prefix}_tools.json" 2>/dev/null
    
    # List resources
    resources_response=$(send_http_request "$cfg_server_url" "$LIST_RESOURCES_MSG" "$SERVER_TIMEOUT")
    echo "$resources_response" | jq -S '.' > "${output_prefix}_resources.json" 2>/dev/null
    
    # List prompts
    prompts_response=$(send_http_request "$cfg_server_url" "$LIST_PROMPTS_MSG" "$SERVER_TIMEOUT")
    echo "$prompts_response" | jq -S '.' > "${output_prefix}_prompts.json" 2>/dev/null
    
    # List resource templates
    templates_response=$(send_http_request "$cfg_server_url" "$LIST_RESOURCE_TEMPLATES_MSG" "$SERVER_TIMEOUT")
    echo "$templates_response" | jq -S '.' > "${output_prefix}_resource_templates.json" 2>/dev/null
    
    # Stop server if we started it
    if [ -n "$server_pid" ]; then
        kill $server_pid 2>/dev/null || true
        wait $server_pid 2>/dev/null || true
    fi
    
    end_time=$(date +%s.%N 2>/dev/null || date +%s)
    duration=$(echo "$end_time - $start_time" | bc 2>/dev/null || echo "0")
    
    # Normalize all JSON files
    for endpoint in initialize tools resources prompts resource_templates; do
        normalize_json "${output_prefix}_${endpoint}.json"
    done
    
    echo "$duration"
}

# Function to run MCP server test via stdio
run_mcp_test_stdio() {
    local working_dir="$1"
    local name="$2"
    local output_prefix="$3"
    local cfg_start_cmd="$4"
    local cfg_env="$5"
    
    local start_time end_time duration
    start_time=$(date +%s.%N 2>/dev/null || date +%s)
    
    # Build the command with optional env vars
    local cmd="$cfg_start_cmd"
    if [ -n "$cfg_env" ]; then
        cmd="export $cfg_env && $cfg_start_cmd"
    fi
    
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
        ) | timeout "${SERVER_TIMEOUT}s" bash -c "cd '$working_dir' && $cmd" 2>/dev/null || true
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

# Function to run MCP test with config
run_mcp_test() {
    local working_dir="$1"
    local name="$2"
    local output_prefix="$3"
    local config="$4"
    
    local cfg_transport=$(echo "$config" | jq -r '.transport // "stdio"')
    local cfg_start_cmd=$(echo "$config" | jq -r '.start_command // empty')
    local cfg_server_url=$(echo "$config" | jq -r '.server_url // empty')
    local cfg_health=$(echo "$config" | jq -r '.health_endpoint // "/health"')
    local cfg_env=$(echo "$config" | jq -r '.env_vars // empty')
    
    if [ "$cfg_transport" = "http" ]; then
        run_mcp_test_http "$working_dir" "$name" "$output_prefix" "$cfg_start_cmd" "$cfg_server_url" "$cfg_health" "$cfg_env"
    else
        run_mcp_test_stdio "$working_dir" "$name" "$output_prefix" "$cfg_start_cmd" "$cfg_env"
    fi
}

# Build and test both versions
log "${YELLOW}Building and testing both versions...${NC}"
log ""

# Arrays to track timing and results per config
declare -A branch_times
declare -A main_times
declare -A config_diffs

# --- BUILD AND TEST CURRENT BRANCH ---
log "${BLUE}Building current branch ($CURRENT_BRANCH)...${NC}"

log "  Running install command..."
if ! eval "$INSTALL_CMD" >/dev/null 2>&1; then
    log "${RED}  Install failed!${NC}"
    exit 1
fi
log "${GREEN}  Install successful${NC}"

if [ -n "$BUILD_CMD" ]; then
    log "  Running build command..."
    if ! eval "$BUILD_CMD" >/dev/null 2>&1; then
        log "${RED}  Build failed!${NC}"
        exit 1
    fi
    log "${GREEN}  Build successful${NC}"
else
    log "  ${YELLOW}Build step skipped (no build command)${NC}"
fi

# Run tests for each configuration
for config in "${CONFIGS[@]}"; do
    cfg_name=$(echo "$config" | jq -r '.name')
    cfg_transport=$(echo "$config" | jq -r '.transport // "stdio"')
    
    mkdir -p "$REPORT_DIR/branch/$cfg_name"
    log "  Running conformance test: $cfg_name ($cfg_transport)..."
    branch_times[$cfg_name]=$(run_mcp_test "$PROJECT_DIR" "branch" "$REPORT_DIR/branch/$cfg_name/output" "$config")
    log "${GREEN}    Test complete (${branch_times[$cfg_name]}s)${NC}"
done
log ""

# --- BUILD AND TEST BASE BRANCH ---
log "${BLUE}Building base branch (compare ref: $MERGE_BASE)...${NC}"

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

if [ -n "$BUILD_CMD" ]; then
    log "  Running build command..."
    if ! (cd "$WORK_DIR" && eval "$BUILD_CMD") >/dev/null 2>&1; then
        log "${YELLOW}  Build warning (may be expected for older version)${NC}"
    fi
else
    log "  ${YELLOW}Build step skipped (no build command)${NC}"
fi

# Run tests for each configuration
for config in "${CONFIGS[@]}"; do
    cfg_name=$(echo "$config" | jq -r '.name')
    cfg_transport=$(echo "$config" | jq -r '.transport // "stdio"')
    
    mkdir -p "$REPORT_DIR/main/$cfg_name"
    log "  Running conformance test: $cfg_name ($cfg_transport)..."
    main_times[$cfg_name]=$(run_mcp_test "$WORK_DIR" "main" "$REPORT_DIR/main/$cfg_name/output" "$config")
    log "${GREEN}    Test complete (${main_times[$cfg_name]}s)${NC}"
done

# Cleanup worktree
if [ -n "$TEMP_WORKTREE" ]; then
    git worktree remove --force "$TEMP_WORKTREE" 2>/dev/null || true
else
    git checkout --quiet "$CURRENT_BRANCH" 2>/dev/null || git checkout --quiet -
fi
log ""

# --- GENERATE DIFFS ---
log "${YELLOW}Generating comparison report...${NC}"

total_diff_count=0
total_ok_count=0
endpoints="initialize tools resources prompts resource_templates"

for config in "${CONFIGS[@]}"; do
    cfg_name=$(echo "$config" | jq -r '.name')
    
    mkdir -p "$REPORT_DIR/diffs/$cfg_name"
    config_diffs[$cfg_name]=false
    
    log "  Configuration: $cfg_name"
    for endpoint in $endpoints; do
        main_file="$REPORT_DIR/main/$cfg_name/output_${endpoint}.json"
        branch_file="$REPORT_DIR/branch/$cfg_name/output_${endpoint}.json"
        diff_file="$REPORT_DIR/diffs/$cfg_name/${endpoint}.diff"
        
        if ! diff -u "$main_file" "$branch_file" > "$diff_file" 2>/dev/null; then
            config_diffs[$cfg_name]=true
            lines=$(wc -l < "$diff_file" | tr -d ' ')
            log "    ${YELLOW}${endpoint}: DIFF (${lines} lines)${NC}"
        else
            rm -f "$diff_file"
            log "    ${GREEN}${endpoint}: OK${NC}"
        fi
    done
    
    if [ "${config_diffs[$cfg_name]}" = true ]; then
        ((total_diff_count++))
    else
        ((total_ok_count++))
    fi
done
log ""

# --- GENERATE REPORT ---
REPORT_FILE="$REPORT_DIR/CONFORMANCE_REPORT.md"

# Calculate totals
total_branch_time=0
total_main_time=0

cat > "$REPORT_FILE" << EOF
# MCP Server Conformance Report

Generated: $(date)
Current Branch: $CURRENT_BRANCH
Compared Against: $MERGE_BASE

## Summary

| Configuration | Transport | Base Time | Branch Time | Δ Time | Status |
|---------------|-----------|-----------|-------------|--------|--------|
EOF

for config in "${CONFIGS[@]}"; do
    cfg_name=$(echo "$config" | jq -r '.name')
    cfg_transport=$(echo "$config" | jq -r '.transport // "stdio"')
    
    bt="${branch_times[$cfg_name]}"
    mt="${main_times[$cfg_name]}"
    
    time_diff=$(echo "$bt - $mt" | bc 2>/dev/null || echo "0")
    if (( $(echo "$time_diff > 0" | bc -l 2>/dev/null || echo "0") )); then
        delta_str="+${time_diff}s"
    else
        delta_str="${time_diff}s"
    fi
    
    if [ "${config_diffs[$cfg_name]}" = true ]; then
        status_str="⚠️ DIFF"
    else
        status_str="✅ OK"
    fi
    
    echo "| $cfg_name | $cfg_transport | ${mt}s | ${bt}s | $delta_str | $status_str |" >> "$REPORT_FILE"
    
    total_branch_time=$(echo "$total_branch_time + $bt" | bc 2>/dev/null || echo "0")
    total_main_time=$(echo "$total_main_time + $mt" | bc 2>/dev/null || echo "0")
done

total_time_diff=$(echo "$total_branch_time - $total_main_time" | bc 2>/dev/null || echo "0")
if (( $(echo "$total_time_diff > 0" | bc -l 2>/dev/null || echo "0") )); then
    total_delta_str="+${total_time_diff}s"
else
    total_delta_str="${total_time_diff}s"
fi

cat >> "$REPORT_FILE" << EOF

## Statistics

- **Configurations Tested:** ${#CONFIGS[@]}
- **Tests Passed (no diff):** $total_ok_count
- **Tests with Differences:** $total_diff_count
- **Total Base Time:** ${total_main_time}s
- **Total Branch Time:** ${total_branch_time}s
- **Overall Time Delta:** $total_delta_str

## Detailed Diffs

EOF

if [ $total_diff_count -gt 0 ]; then
    for config in "${CONFIGS[@]}"; do
        cfg_name=$(echo "$config" | jq -r '.name')
        
        if [ "${config_diffs[$cfg_name]}" = true ]; then
            echo "### $cfg_name" >> "$REPORT_FILE"
            echo "" >> "$REPORT_FILE"
            
            for endpoint in $endpoints; do
                diff_file="$REPORT_DIR/diffs/$cfg_name/${endpoint}.diff"
                if [ -f "$diff_file" ] && [ -s "$diff_file" ]; then
                    echo "#### ${endpoint}" >> "$REPORT_FILE"
                    echo '```diff' >> "$REPORT_FILE"
                    cat "$diff_file" >> "$REPORT_FILE"
                    echo '```' >> "$REPORT_FILE"
                    echo "" >> "$REPORT_FILE"
                fi
            done
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
echo "Configurations tested: ${#CONFIGS[@]}"
echo "Tests passed: $total_ok_count"
echo "Tests with diffs: $total_diff_count"
echo "Total base time: ${total_main_time}s"
echo "Total branch time: ${total_branch_time}s"
echo "Time delta: $total_delta_str"

if [ $total_diff_count -gt 0 ]; then
    log ""
    log "${YELLOW}⚠️  Differences detected. Review the diffs in:${NC}"
    log "   $REPORT_DIR/diffs/"
    echo ""
    echo "RESULT: DIFFERENCES FOUND"
else
    echo ""
    echo "RESULT: ALL TESTS PASSED"
fi
