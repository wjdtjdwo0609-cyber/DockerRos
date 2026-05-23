@echo off
REM Windows launcher for the DockerRos web simulator.
REM Same role as "웹 시뮬.command" on macOS — serves web/ on port 8090
REM with no-cache headers, then auto-opens the browser.
chcp 65001 > nul
cd /d "%~dp0"

REM Sanity check: Python on PATH?
where python > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found on PATH.
    echo Install Python 3.10+ from https://python.org and check "Add to PATH".
    pause
    exit /b 1
)

echo Web Simulator: http://localhost:8090
echo Ctrl+C to stop.
echo.

REM Auto-open the browser ~2s after the server boots.
start "" /min cmd /c "timeout /t 2 /nobreak > nul && start http://localhost:8090"

REM Run the cross-platform server (web\serve.py).
python "%~dp0web\serve.py" 8090

pause
