#!/bin/bash

# Codo Hub - Run Backend and Frontend
# This script runs both the backend server and frontend dev server

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${BLUE}Starting Codo Hub...${NC}\n"

# Function to cleanup background processes on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down servers...${NC}"
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
    fi
    # Also kill any processes on port 3000 (in case backend didn't register properly)
    PORT_3000_PIDS=$(lsof -ti:3000 2>/dev/null)
    if [ ! -z "$PORT_3000_PIDS" ]; then
        echo "$PORT_3000_PIDS" | xargs kill -9 2>/dev/null
    fi
    exit
}

trap cleanup SIGINT SIGTERM

# Check and kill processes on port 3000
echo -e "${YELLOW}Checking port 3000...${NC}"
PORT_3000_PIDS=$(lsof -ti:3000 2>/dev/null)
if [ ! -z "$PORT_3000_PIDS" ]; then
    echo -e "${YELLOW}Port 3000 is in use. Killing existing processes...${NC}"
    echo "$PORT_3000_PIDS" | xargs kill -9 2>/dev/null
    sleep 1
fi

# Start Backend
echo -e "${GREEN}Starting Backend Server...${NC}"
cd backend
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Warning: venv not found. Please create it first:${NC}"
    echo "cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

source venv/bin/activate
python3 main.py &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to start and verify it's running
sleep 3
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${YELLOW}Backend failed to start. Check the error messages above.${NC}"
    exit 1
fi

# Verify backend is listening on port 3000
if ! lsof -ti:3000 >/dev/null 2>&1; then
    echo -e "${YELLOW}Warning: Backend may not be listening on port 3000.${NC}"
fi

# Start Frontend
echo -e "${GREEN}Starting Frontend Dev Server...${NC}"
cd frontend
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Warning: node_modules not found. Installing dependencies...${NC}"
    npm install
fi

npm run dev &
FRONTEND_PID=$!
cd ..

echo -e "\n${BLUE}✓ Backend running on http://localhost:3000 (PID: $BACKEND_PID)${NC}"
echo -e "${BLUE}✓ Frontend running (PID: $FRONTEND_PID)${NC}"
echo -e "\n${YELLOW}Press Ctrl+C to stop both servers${NC}\n"

# Wait for both processes
wait
