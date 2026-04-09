@echo off
setlocal

cd /d "%~dp0"

echo [KawaiiGPT] Limpiando compilado previo...
if exist "out" rmdir /s /q "out"

echo [KawaiiGPT] Compilando version actual...
call npm run build
if errorlevel 1 (
  echo [KawaiiGPT] Error en la compilacion. Revisa la consola.
  pause
  exit /b 1
)

echo [KawaiiGPT] Iniciando app actual...
call ".\node_modules\.bin\electron.cmd" .

endlocal
