@echo off
rem The hand bridge on Windows, by a double click: installs what it needs the first time (Internet needed,
rem so before joining the table Wi-Fi), then reads the sensor until this window is closed.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js manque : installe la version 22 ou plus recente depuis https://nodejs.org, puis relance.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Premiere fois : installation, avec Internet...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo L'installation a echoue : il faut Internet la premiere fois. Relance une fois connecte.
    pause
    exit /b 1
  )
)

echo Pont du capteur de main. Laisse cette fenetre ouverte pendant la demo.
call npm start
pause
