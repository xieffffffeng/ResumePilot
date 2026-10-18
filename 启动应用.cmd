@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
start "" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
endlocal