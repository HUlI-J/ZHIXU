@echo off
cd /d "%~dp0"
echo Starting Zhixu prototype...
echo Open http://127.0.0.1:8765/
python prototype\server.py
pause
