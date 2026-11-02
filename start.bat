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

rem ---- 2) 依次探测解释器（只需能跑标准库服务；重跑数据才需要 pdfplumber） ----
set "PYCMD="
call :try "py -3.12"
if not defined PYCMD call :try "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PYCMD call :try "python"
if not defined PYCMD goto nopython

echo [ok] 使用解释器：%PYCMD%
%PYCMD% -c "import pdfplumber" >nul 2>&1
if errorlevel 1 (
  echo [warn] 未安装 pdfplumber：仅浏览结果不受影响；
  echo        需要重跑数据时再执行 py -3.12 -m pip install -r requirements.txt
  echo.
)
set "UI_OK="
where node >nul 2>&1
if errorlevel 1 (
  echo [warn] 未检测到 Node.js：仅 API 与数据可用，界面需要 Node 20+
) else (
  set "UI_OK=1"
  if not exist "webapp\node_modules" (
    echo [i] 首次运行，正在安装前端依赖...
    pushd webapp
    call npm install
    if errorlevel 1 set "UI_OK="
    popd
  )
  if not exist "webapp\.next\BUILD_ID" (
    echo [i] 正在构建前端...
    pushd webapp
    call npm run build
    if errorlevel 1 set "UI_OK="
    popd
  ) else (
    echo [i] 已存在构建产物；如需重建请删除 webapp\.next
  )
  if defined UI_OK (
    start "Spec2Test UI" cmd /c "cd /d %~dp0webapp && npm run start"
    echo [ok] 界面：http://127.0.0.1:3000/   API：http://127.0.0.1:8000/api/health
    start "" http://127.0.0.1:3000/
  ) else (
    echo [warn] 前端依赖安装或构建失败，已跳过界面启动
  )
)
echo.
%PYCMD% scripts\serve.py
echo.
echo 服务已停止。
pause
exit /b 0

:running
echo [i] 已在运行，请打开 http://127.0.0.1:3000/
echo.
pause
exit /b 0

:nopython
echo [1/3] 未检测到可用的 Python（建议 3.12，最低 3.9）。
echo [2/3] 安装 Python：https://www.python.org/downloads/  安装时勾选 Add to PATH。
echo [3/3] 浏览结果无需额外依赖；重跑数据再执行 py -3.12 -m pip install -r requirements.txt
echo.
pause
exit /b 1

:try
set "RAW=%~1"
echo %RAW% | findstr /I /E ".exe" >nul
if errorlevel 1 (set "CAND=%RAW%") else (set "CAND="%RAW%"")
%CAND% -c "import sys; raise SystemExit(0 if sys.version_info >= (3,9) else 1)" >nul 2>&1
if errorlevel 1 goto :eof
set "PYCMD=%CAND%"
goto :eof
