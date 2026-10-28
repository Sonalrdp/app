@echo off

REM ============================================================================
REM Auto-detect standard Node.js installation paths if not already in PATH
REM ============================================================================
if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;%AppData%\npm;%PATH%"
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "PATH=C:\Program Files (x86)\nodejs;%AppData%\npm;%PATH%"
)
if exist "%LocalAppData%\Programs\nodejs\node.exe" (
    set "PATH=%LocalAppData%\Programs\nodejs;%AppData%\npm;%PATH%"
)

title CORTEX UPI GATEWAY - Unified 1-Port Sovereign Payment Gateway
cd /d "%~dp0"

cls
echo ============================================================================
echo   ⚡ CORTEX UPI PAYMENT GATEWAY — UNIFIED 1-PORT SYSTEM
echo   0%% Aggregator Fees - Direct Bank UPI - Pure Node.js
echo ============================================================================
echo.

REM ----------------------------------------------------------------------------
REM 1. Verify Prerequisites (Node.js and npm)
REM ----------------------------------------------------------------------------
echo [1/4] Checking prerequisites...

node -v >nul 2>&1
if errorlevel 1 goto NODE_MISSING

call npm -v >nul 2>&1
if errorlevel 1 goto NPM_MISSING

for /f "tokens=*" %%v in ('node -v') do set "NODE_VERSION=%%v"
for /f "tokens=*" %%v in ('call npm -v') do set "NPM_VERSION=%%v"

echo [OK]   Node.js version : %NODE_VERSION%
echo [OK]   npm version     : v%NPM_VERSION%
echo.
goto STEP_ENV

:NODE_MISSING
echo.
echo ============================================================================
echo [ERROR] Node.js is not found in PATH or standard installation directories.
echo ============================================================================
echo Cortex UPI Gateway requires Node.js v22.13.0 or higher.
echo Please download and install Node.js from: https://nodejs.org/
echo.
pause
exit /b 1

:NPM_MISSING
echo.
echo ============================================================================
echo [ERROR] npm is not found in PATH.
echo ============================================================================
pause
exit /b 1

REM ----------------------------------------------------------------------------
REM 2. Check and Prepare Environment Configuration (.env)
REM ----------------------------------------------------------------------------
:STEP_ENV
echo [2/4] Verifying environment configuration...
if exist .env goto ENV_FOUND
if exist .env.example goto CREATE_ENV
echo [WARN] Neither .env nor .env.example found. Please configure manually.
goto STEP_DIRS

:CREATE_ENV
echo [INFO] .env file not found. Generating default .env from .env.example...
copy .env.example .env >nul
echo [OK]   Created .env configuration file (pre-configured for port 5000).
goto STEP_DIRS

:ENV_FOUND
echo [OK]   .env configuration file detected.
goto STEP_DIRS

REM ----------------------------------------------------------------------------
REM 3. Prepare Required Directories
REM ----------------------------------------------------------------------------
:STEP_DIRS
echo.
echo [3/4] Ensuring runtime directories exist...
if not exist data mkdir data
echo [OK]   Runtime directories verified (data).
echo.

REM ----------------------------------------------------------------------------
REM 4. Verify Dependencies and Database
REM ----------------------------------------------------------------------------
echo [4/4] Verifying dependencies and database...
if not exist node_modules goto INSTALL_DEPS
if not exist data\gateway.sqlite goto SETUP_DB
echo [OK]   Dependencies and database ready.
goto START_GATEWAY

:INSTALL_DEPS
echo.
echo ============================================================================
echo [*] Installing gateway dependencies (express, cors, qrcode, dotenv)...
echo ============================================================================
call npm install
if errorlevel 1 (
    echo.
    echo [ERROR] 'npm install' failed.
    pause
    exit /b 1
)
echo [OK] Dependencies installed cleanly.
echo.

:SETUP_DB
echo [*] Initializing local SQLite database...
call npm run db:setup
if errorlevel 1 (
    echo.
    echo [ERROR] Database initialization failed.
    pause
    exit /b 1
)
echo [OK] Database ready (data\gateway.sqlite).
echo.

REM ----------------------------------------------------------------------------
REM Start Gateway on Single Unified Port (5000)
REM ----------------------------------------------------------------------------
:START_GATEWAY
echo ============================================================================
echo   STARTING CORTEX UPI GATEWAY ON 1 UNIFIED PORT (5000)...
echo ============================================================================
echo   * Buyer Storefront       : http://localhost:5000/
echo   * Merchant Admin Hub     : http://localhost:5000/admin
echo   * Buyer Hosted Checkout  : http://localhost:5000/checkout/:orderId
echo   * Universal SDK Script   : http://localhost:5000/youpi.js
echo   * External REST API      : http://localhost:5000/api/orders/create
echo   * Local Terminal DB CLI  : Run "npm run db:cli" in another terminal
echo ============================================================================
echo Press Ctrl+C at any time in this window to stop the server.
echo ============================================================================
echo.

call npm start

echo.
echo ----------------------------------------------------------------------------
echo Cortex UPI Gateway stopped.
echo ----------------------------------------------------------------------------
pause
exit /b 0
