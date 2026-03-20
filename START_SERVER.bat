@echo off
title TimeTracker Backend
cd /d "%~dp0backend"
if not exist "node_modules\" (
    echo Installiere Abhaengigkeiten
    call npm install
)
echo Backend laeuft auf http://localhost:3847
node server.js
pause
