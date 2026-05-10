@echo off
echo ============================================
echo   ASCAR-E SLAM Server Launcher
echo ============================================
echo.

:: Kill anything already running on port 8001
echo [1/2] Clearing port 8001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8001 " ^| findstr "LISTENING"') do (
    echo      Killing PID %%a on port 8001
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Start the SLAM server
echo [2/2] Starting slam_server.py on port 8001...
echo.
uvicorn slam_server:app --host 0.0.0.0 --port 8001
