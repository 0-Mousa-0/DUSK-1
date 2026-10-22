@echo off
title DUSK-1 Ground Station
cd /d "%~dp0"

rem ---- find a working Python 3 (the Microsoft Store "python" stub does not count)
set PY=
for %%P in (py python) do if not defined PY (%%P -c "import sys" >nul 2>nul && set PY=%%P)
if not defined PY for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set PY="%%D\python.exe"
if not defined PY (
  echo Python 3 is not installed. Get it from python.org and tick "Add python.exe to PATH".
  pause
  exit /b
)

echo.
echo   DUSK-1 Ground Station
echo   ---------------------
echo   1 = USB:   Ground OBC (UNO R4 WiFi) plugged into this laptop      [recommended]
echo   2 = Wi-Fi: this laptop is on DUSK1-GROUND, Ground OBC at 192.168.4.1
echo   3 = USB:   ground radio plugged straight into this laptop
echo   4 = Demo:  play back the recorded bench session (no hardware)
echo   5 = USB + public: like 1, and anyone can watch live, read-only, at 0-mousa-0.github.io/DUSK-1
echo.
set /p MODE=Choose 1, 2, 3, 4 or 5 and press Enter:

set SHARE=
if "%MODE%"=="5" set SHARE=--share
if "%MODE%"=="1" goto usb
if "%MODE%"=="3" goto usb
if "%MODE%"=="5" goto usb
if "%MODE%"=="4" goto replay

start "" cmd /c "timeout /t 2 >nul & start http://localhost:8080"
%PY% -m dusk1_ground --tcp 192.168.4.1:5760
goto end

:usb
%PY% -m pip install pyserial --quiet
echo.
echo   Serial ports on this laptop (the UNO R4 WiFi is "USB Serial Device", VID 2341):
%PY% -c "from serial.tools import list_ports; [print('   ', p.device, '-', p.description) for p in list_ports.comports()]"
echo.
echo   Close the Arduino IDE Serial Monitor first: it locks the port.
set /p PORT=Type the COM port (for example COM5) and press Enter:
set BAUD=115200
if "%MODE%"=="3" set BAUD=57600
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8080"
%PY% -m dusk1_ground --serial %PORT% --baud %BAUD% %SHARE%
goto end

:replay
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8080"
%PY% -m dusk1_ground --replay sample_data\bench_2026-10-21_raw.log --loop

:end
pause
