@echo off
setlocal
title Twizy PowerBox Tool GUI
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 goto :py

where python >nul 2>nul
if %errorlevel%==0 goto :python

echo Python is niet gevonden.
echo Installeer Python via https://www.python.org/downloads/
echo Vink tijdens installatie "Add Python to PATH" aan.
pause
exit /b 1

:py
start "" "http://localhost:8765"
py -m http.server 8765 --bind 127.0.0.1
goto :end

:python
start "" "http://localhost:8765"
python -m http.server 8765 --bind 127.0.0.1

:end
endlocal
