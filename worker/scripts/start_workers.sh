#!/bin/bash
#
# Start 1 dispatcher + N workers using tmux
# Each worker runs in its own window (no pane splitting issues)
#
# Usage:
#   ./scripts/start_workers.sh          # Default: 20 workers
#   ./scripts/start_workers.sh 10       # Custom: 10 workers
#   ./scripts/start_workers.sh stop     # Stop all
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(dirname "$SCRIPT_DIR")"
SESSION_NAME="survey-workers"
NUM_WORKERS="${1:-20}"

cd "$WORKER_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_err() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check for stop command
if [ "$1" = "stop" ]; then
    echo_info "Stopping all workers..."
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null || echo_warn "No session to stop"
    exit 0
fi

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo_err "tmux is not installed. Install with: brew install tmux"
    exit 1
fi

# Check if session already exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo_warn "Session '$SESSION_NAME' already exists."
    echo_info "To attach: tmux attach -t $SESSION_NAME"
    echo_info "To stop:   $0 stop"
    exit 1
fi

# Setup venv
setup_venv() {
    if [ -d "venv" ]; then
        echo_info "Using existing venv"
    else
        echo_info "Creating venv..."
        python3 -m venv venv
        source venv/bin/activate
        pip install -r requirements.txt
        deactivate
    fi
}

setup_venv

# Activation command for each window
ACTIVATE_CMD="cd $WORKER_DIR && source venv/bin/activate"

echo_info "Starting tmux session: $SESSION_NAME"
echo_info "  - 1 dispatcher"
echo_info "  - $NUM_WORKERS workers"

# Create session with dispatcher in first window
tmux new-session -d -s "$SESSION_NAME" -n "dispatcher"
tmux send-keys -t "$SESSION_NAME:dispatcher" "$ACTIVATE_CMD && python -m src.dispatcher" Enter

# Create each worker in its own window
for ((i=1; i<=NUM_WORKERS; i++)); do
    window_name="worker-$i"
    tmux new-window -t "$SESSION_NAME" -n "$window_name"
    tmux send-keys -t "$SESSION_NAME:$window_name" "$ACTIVATE_CMD && echo '=== Worker $i ===' && python main.py" Enter
done

# Create a status window
tmux new-window -t "$SESSION_NAME" -n "status"
tmux send-keys -t "$SESSION_NAME:status" "$ACTIVATE_CMD && watch -n 5 'echo \"=== RabbitMQ Queue ===\"; curl -s -u guest:guest http://localhost:15672/api/queues/%2F/survey_tasks 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); print(f\\\"Messages: {d.get(\\\\\"messages\\\\\",0)}, Consumers: {d.get(\\\\\"consumers\\\\\",0)}\\\")\" || echo \"RabbitMQ management not available\"'" Enter

# Select dispatcher window
tmux select-window -t "$SESSION_NAME:dispatcher"

echo ""
echo_info "Workers started! Total windows: $((NUM_WORKERS + 2))"
echo ""
echo "  Attach to session:  tmux attach -t $SESSION_NAME"
echo "  Stop all workers:   $0 stop"
echo ""
echo "  Windows:"
echo "    0: dispatcher     - Task dispatcher (DB → RabbitMQ)"
echo "    1-$NUM_WORKERS: worker-N  - Workers"
echo "    $((NUM_WORKERS + 1)): status       - Queue status monitor"
echo ""
echo "  Tmux shortcuts:"
echo "    Ctrl+b w       - Window list (select with arrows)"
echo "    Ctrl+b n       - Next window"
echo "    Ctrl+b p       - Previous window"
echo "    Ctrl+b d       - Detach (workers keep running)"
echo "    Ctrl+b [       - Scroll mode (q to exit)"
echo ""

# Optionally attach immediately
read -p "Attach to session now? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    tmux attach -t "$SESSION_NAME"
fi
