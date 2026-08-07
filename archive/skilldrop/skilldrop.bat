@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM  Script: skilldrop.bat
REM  Purpose: Ensure PySide6 is available, then run skilldrop.py
REM  located in the same directory as this script.
REM ============================================================

REM Directory of this script (works regardless of caller's CWD)
set "_SCRIPT_DIR=%~dp0"

REM ------------------------------------------------------------
REM  Step 1: Check if PySide6 is installed
REM ------------------------------------------------------------
python -c "import PySide6" >NUL 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] PySide6 is already installed.
    goto :ok
)

echo [WARN] PySide6 is not installed.

REM ------------------------------------------------------------
REM  Step 2: Ask the user whether to install PySide6
REM ------------------------------------------------------------
set "_ANSWER="
set /p "_ANSWER=Do you want to install PySide6 now? (y/N): "

if /i "%_ANSWER%"=="y" (
    echo Installing PySide6...
    pip install PySide6
    if errorlevel 1 (
        echo ERROR: Failed to install PySide6. 1>&2
        exit /b 1
    )
    echo [OK] PySide6 installed.
    goto :ok
)

echo PySide6 is required to run skilldrop.py. Exiting.
exit /b 1

:ok
REM ------------------------------------------------------------
REM  Step 3: Run skilldrop.py from the script's directory
REM ------------------------------------------------------------
if not exist "%_SCRIPT_DIR%skilldrop.py" (
    echo ERROR: skilldrop.py not found in "%_SCRIPT_DIR%". 1>&2
    exit /b 1
)

python "%_SCRIPT_DIR%skilldrop.py"
exit /b %ERRORLEVEL%