#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$PROJECT_ROOT/.logs"
PID_DIR="$PROJECT_ROOT/.pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

log() {
    echo -e "${GREEN}[start.sh]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[start.sh]${NC} $1"
}

error() {
    echo -e "${RED}[start.sh]${NC} $1"
}

check_port() {
    local port=$1
    local name=$2
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        error "$name is already running on port $port"
        return 1
    fi
    return 0
}

check_url() {
    local url=$1
    local name=$2
    if curl -sf "$url" >/dev/null 2>&1; then
        log "$name is reachable at $url"
        return 0
    else
        warn "$name is NOT reachable at $url"
        return 1
    fi
}

verify_configured_provider() {
    if ! curl -sf http://localhost:18792/health >/dev/null 2>&1; then
        warn "Backend not running, skipping provider verification"
        return 0
    fi

    local provider
    provider=$(curl -sf http://localhost:18792/api/settings/provider 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('provider',''))" 2>/dev/null)
    if [ -z "$provider" ]; then
        error "Could not resolve configured provider from backend settings"
        return 1
    fi

    local test_raw
    test_raw=$(curl -sf -X POST http://localhost:18792/api/settings/provider/test -H "Content-Type: application/json" -d "{\"provider\":\"$provider\"}" 2>/dev/null)
    if [ -z "$test_raw" ]; then
        error "Provider healthcheck request failed"
        return 1
    fi

    local test_ok
    local test_message
    test_ok=$(python3 -c "import json,sys; print('true' if json.loads(sys.argv[1]).get('ok') else 'false')" "$test_raw" 2>/dev/null)
    test_message=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('message',''))" "$test_raw" 2>/dev/null)

    if [ "$test_ok" = "true" ]; then
        log "Configured provider '$provider' healthy: $test_message"
        return 0
    fi

    error "Configured provider '$provider' failed healthcheck: $test_message"
    return 1
}

doctor() {
    log "Running system doctor..."
    echo ""

    local issues=0

    echo "=== Node.js ==="
    if command -v node &> /dev/null; then
        log "Node.js: $(node --version)"
    else
        error "Node.js is NOT installed"
        ((issues++))
    fi

    if command -v npm &> /dev/null; then
        log "npm: $(npm --version)"
    else
        error "npm is NOT installed"
        ((issues++))
    fi
    echo ""

    echo "=== Ports ==="
    check_port 18792 "Backend REST API" || ((issues++))
    check_port 18793 "WebSocket" || ((issues++))
    check_port 5173 "Frontend (Vite)" || ((issues++))
    echo ""

    echo "=== External Services ==="
    check_url "http://localhost:11434" "Ollama" || warn "Ollama not running (needed for LLM)"
    if curl -sf http://localhost:18792/health >/dev/null 2>&1; then
        verify_configured_provider || ((issues++))
    else
        warn "Backend not running; provider healthcheck will run on --start"
    fi
    echo ""

    echo "=== Code Check ==="
    if [ -d "$PROJECT_ROOT/node_modules" ]; then
        log "node_modules: installed (hoisted)"
    else
        warn "node_modules: NOT installed"
        ((issues++))
    fi

    if [ -d "$PROJECT_ROOT/packages/shared/dist" ]; then
        log "packages/shared: built"
    else
        warn "packages/shared: NOT built (run: npm run build)"
        ((issues++))
    fi
    echo ""

    echo "=== Config Profiles ==="
    for profile in kosmos vicks wedge; do
        if [ -f "$PROJECT_ROOT/config/profiles/$profile/PROFILE.md" ]; then
            log "Profile $profile: exists"
        else
            error "Profile $profile: MISSING"
            ((issues++))
        fi
    done
    echo ""

    echo "=== Database ==="
    DB_PATH="$HOME/.kosmos/kosmos.db"
    if [ -f "$DB_PATH" ]; then
        log "Database exists at $DB_PATH"
    else
        warn "Database will be created at $DB_PATH"
    fi
    echo ""

    if [ $issues -eq 0 ]; then
        log "Doctor check passed! Ready to start."
        return 0
    else
        error "Doctor found $issues issue(s). Attempting to fix..."
        fix_issues
        return $?
    fi
}

fix_issues() {
    local fixed=0

    echo ""
    echo "=== Auto-fixing issues ==="

    if [ ! -d "$PROJECT_ROOT/node_modules" ] || [ ! -d "$PROJECT_ROOT/apps/backend/node_modules" ] || [ ! -d "$PROJECT_ROOT/apps/frontend/node_modules" ]; then
        warn "Installing npm dependencies..."
        cd "$PROJECT_ROOT"
        npm install --workspaces 2>&1 | tail -5
        if [ $? -eq 0 ]; then
            log "Dependencies installed successfully"
            ((fixed++))
        else
            error "Failed to install dependencies"
        fi
    fi

    echo ""
    if [ $fixed -gt 0 ]; then
        log "Fixed $fixed issue(s)"
        return 0
    else
        error "Could not fix issues automatically"
        return 1
    fi
}

stop_services() {
    log "Stopping all services..."

    if [ -f "$PID_DIR/backend.pid" ]; then
        local backend_pid=$(cat "$PID_DIR/backend.pid")
        if kill -0 "$backend_pid" 2>/dev/null; then
            kill "$backend_pid" 2>/dev/null || true
            log "Backend (PID $backend_pid) stopped"
        fi
        rm -f "$PID_DIR/backend.pid"
    fi

    if [ -f "$PID_DIR/frontend.pid" ]; then
        local frontend_pid=$(cat "$PID_DIR/frontend.pid")
        if kill -0 "$frontend_pid" 2>/dev/null; then
            kill "$frontend_pid" 2>/dev/null || true
            log "Frontend (PID $frontend_pid) stopped"
        fi
        rm -f "$PID_DIR/frontend.pid"
    fi

    pkill -f "tsx watch src/index.ts" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true

    log "All services stopped"
}

start_backend() {
    log "Starting Backend..."
    cd "$PROJECT_ROOT/apps/backend"

    nohup npm run dev > "$LOG_DIR/backend.log" 2>&1 &
    local backend_pid=$!

    echo $backend_pid > "$PID_DIR/backend.pid"
    log "Backend started (PID: $backend_pid)"

    local max_wait=15
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if curl -sf http://localhost:18792/health >/dev/null 2>&1; then
            log "Backend is ready at http://localhost:18792"
            return 0
        fi
        sleep 1
        ((waited++))
    done

    error "Backend failed to start. Check $LOG_DIR/backend.log"
    return 1
}

start_frontend() {
    log "Starting Frontend..."
    cd "$PROJECT_ROOT/apps/frontend"

    nohup npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
    local frontend_pid=$!

    echo $frontend_pid > "$PID_DIR/frontend.pid"
    log "Frontend started (PID: $frontend_pid)"

    local max_wait=20
    local waited=0
    while [ $waited -lt $max_wait ]; do
        for port in 5173 5174 5175 18793 18794 18795; do
            if curl -sf http://localhost:$port >/dev/null 2>&1; then
                echo $port > "$PID_DIR/frontend.port"
                log "Frontend is ready at http://localhost:$port"
                return 0
            fi
        done
        sleep 1
        ((waited++))
    done

    error "Frontend failed to start. Check $LOG_DIR/frontend.log"
    return 1
}

start() {
    log "Starting Battlestation..."

    stop_services 2>/dev/null || true

    if ! doctor > /dev/null 2>&1; then
        if ! fix_issues; then
            warn "Could not fix all issues, trying to start anyway..."
        fi
    fi

    start_backend
    if ! verify_configured_provider; then
        error "Configured provider is unhealthy. Fix provider settings before running agents."
    fi
    start_frontend

    echo ""
    log "=== Battlestation is running ==="
    log "  Backend:  http://localhost:18792"
    log "  API Doc:  http://localhost:18792/docs"
    log "  WebSocket: ws://localhost:18793"
    local frontend_port=$(cat "$PID_DIR/frontend.port" 2>/dev/null || echo "5173")
    log "  Frontend: http://localhost:$frontend_port"
    log ""
    log "Logs: $LOG_DIR/"
    log "PIDs: $PID_DIR/"
}

status() {
    echo "=== Battlestation Status ==="

    echo ""
    echo "Backend:"
    if curl -sf http://localhost:18792/health >/dev/null 2>&1; then
        log "  REST API: running"
    else
        error "  REST API: not running"
    fi

    if [ -f "$PID_DIR/backend.pid" ]; then
        log "  PID: $(cat $PID_DIR/backend.pid)"
    fi

    echo ""
    echo "Frontend:"
    local frontend_port=""
    for port in 5173 5174 5175 18793 18794 18795; do
        if curl -sf http://localhost:$port >/dev/null 2>&1; then
            frontend_port=$port
            break
        fi
    done

    if [ -n "$frontend_port" ]; then
        log "  Vite: running at http://localhost:$frontend_port"
    else
        error "  Vite: not running"
    fi

    if [ -f "$PID_DIR/frontend.pid" ]; then
        log "  PID: $(cat $PID_DIR/frontend.pid)"
    fi

    echo ""
    echo "External:"
    check_url "http://localhost:11434" "  Ollama" || true
}

case "${1:-}" in
    --doctor|doctor)
        doctor
        ;;
    --start|start)
        start
        ;;
    --stop|stop)
        stop_services
        ;;
    --status|status)
        status
        ;;
    *)
        doctor
        ;;
esac
