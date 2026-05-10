Write-Host "Starting QuantumAI Trading Bot..." -ForegroundColor Cyan

# Check for Python and node
if (!(Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Python is not installed or not in PATH." -ForegroundColor Red
    exit
}

if (!(Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Node.js/npm is not installed or not in PATH." -ForegroundColor Red
    exit
}

# Install dependencies if node_modules don't exist
if (!(Test-Path "node_modules")) {
    Write-Host "Installing root dependencies..."
    npm install
}

if (!(Test-Path "frontend/node_modules")) {
    Write-Host "Installing frontend dependencies..."
    cd frontend
    npm install
    cd ..
}

# Start backend and frontend concurrently
npm run dev
