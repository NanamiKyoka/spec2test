@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Spec2Test 结果浏览 · 一键启动
echo ============================================
echo.

rem ---- 1. 端口已占用则直接提示（不报错） ----
netstat -ano 2>nul | findstr /C:":8000" | findstr /C:"LISTENING" >nul
if not errorlevel 1 goto running

rem ---- 2. 依次探测解释器（要求能 import pdfplumber） ----
set "PYCMD="
call :try "py -3.12"
if not defined PYCMD call :try "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PYCMD call :try "python"
if not defined PYCMD goto nopython

echo [ok] 使用解释器：%PYCMD%
echo [ok] 启动后自动打开 http://127.0.0.1:8000/web/
echo      关闭本窗口即停止服务（Ctrl+C 亦可）
echo.
%PYCMD% scripts\serve.py
echo.
echo 服务已停止。
pause
exit /b 0

:running
echo [i] 已在运行，请打开 http://127.0.0.1:8000/web/
echo.
pause
exit /b 0

:nopython
echo [1/3] 未检测到可用的 Python 3.12（要求能 import pdfplumber）。
echo [2/3] 安装 Python 3.12：https://www.python.org/downloads/  安装时勾选 Add to PATH。
echo [3/3] 装好依赖后重试：py -3.12 -m pip install -r requirements.txt
echo.
pause
exit /b 1

:try
set "CAND=%~1"
%CAND% -c "import pdfplumber" >nul 2>&1
if errorlevel 1 goto :eof
echo %CAND% | findstr /I /E ".exe" >nul
if errorlevel 1 (set "PYCMD=%CAND%") else (set "PYCMD="%CAND%"")
goto :eof
