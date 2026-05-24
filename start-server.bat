@echo off
echo Starte Rennspiel-Server...
echo.
echo Oeffne im Browser: http://localhost:8080
echo.
echo Mit Strg+C beenden.
echo.
cd /d "%~dp0"
python -m http.server 8080
pause
