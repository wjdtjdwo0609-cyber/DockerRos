@echo off
REM Windows launcher for the OPC UA <-> WebSocket adapter.
REM First run creates a venv and installs asyncua + websockets.
chcp 65001 > nul
cd /d "%~dp0"

set VENV=%~dp0web\opcua_venv

where python > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found on PATH.
    echo Install Python 3.10+ from https://python.org and check "Add to PATH".
    pause
    exit /b 1
)

if not exist "%VENV%\Scripts\python.exe" (
    echo First run: creating Python venv at %VENV%
    python -m venv "%VENV%"
    if errorlevel 1 (
        echo [ERROR] venv creation failed. Check Python installation.
        pause
        exit /b 1
    )
    "%VENV%\Scripts\python.exe" -m pip install --quiet --upgrade pip
    "%VENV%\Scripts\python.exe" -m pip install --quiet asyncua websockets
)

echo OPC UA -^> WS adapter
echo   OPC UA  : opc.tcp://127.0.0.1:4840/smartfactory/server/
echo   WebSock : ws://127.0.0.1:9091
echo   Ctrl+C to stop.
echo.

"%VENV%\Scripts\python.exe" "%~dp0web\opcua_ws_adapter.py"

pause
