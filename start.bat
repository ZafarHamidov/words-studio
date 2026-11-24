@echo off
cd /d "%~dp0"
echo ========================================
echo   English Words Flashcard App
echo ========================================
echo.
echo Installing dependencies...
python -m pip install -r requirements.txt --quiet
if %errorlevel% neq 0 (
    echo ERROR: pip install failed. Make sure Python is installed.
    pause
    exit /b 1
)
echo.
echo Starting app at http://localhost:5000
echo Press Ctrl+C to stop.
echo.
python app.py
pause
