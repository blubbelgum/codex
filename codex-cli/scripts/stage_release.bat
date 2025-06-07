@echo off
REM Windows batch file to stage a Codex CLI release
REM This calls the Node.js script which works cross-platform

echo Staging Codex CLI release for Windows...
node "%~dp0stage_release.js" %*

if %ERRORLEVEL% NEQ 0 (
    echo Failed to stage release. Check the error messages above.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Release staging completed successfully!
echo Check the output above for instructions on how to test and distribute the package.
pause 