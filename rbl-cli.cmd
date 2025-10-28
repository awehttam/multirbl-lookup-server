@echo off
REM RBL CLI Wrapper for Windows
REM Executes rbl-cli.php with PHP

REM Find the directory where this script is located
set "SCRIPT_DIR=%~dp0"

REM Check if PHP is available
where php >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: PHP is not installed or not in PATH
    echo Please install PHP and add it to your system PATH
    exit /b 1
)

REM Execute the PHP script with all arguments passed through
php "%SCRIPT_DIR%rbl-cli.php" %*
