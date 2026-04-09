<#
.SYNOPSIS
  Crea los accesos directos de KawaiiGPT en el Escritorio y junto a este script.
.DESCRIPTION
  - Acceso directo "KawaiiGPT" → abre el lanzador que compila y ejecuta siempre la version actual
  - Acceso directo "KawaiiGPT Dev" → alineado al mismo lanzador de version actual
  - Acceso directo opcional "KawaiiGPT Hot Reload Dev" → entorno de desarrollo (npm run dev)
  El ícono kawaii (resources\icon.ico) se asigna automáticamente a ambos.
#>

$Root    = Split-Path $PSScriptRoot -Parent
$ExePath = Join-Path $Root "dist\win-unpacked\KawaiiGPT.exe"
$BatPath = Join-Path $Root "Abrir KawaiiGPT.bat"
$IcoPath = Join-Path $Root "resources\icon.ico"
$Desktop = [Environment]::GetFolderPath("Desktop")
$WShell  = New-Object -ComObject WScript.Shell

# ── Crea/actualiza lanzador .bat de version actual ──────────────────────────
$batContent = @"
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
"@
Set-Content -Path $BatPath -Value $batContent -Encoding ASCII
Write-Host "Lanzador .bat actualizado: $BatPath" -ForegroundColor Green

# ── Acceso directo: App actual (recomendado) ─────────────────────────────────
if (Test-Path $BatPath) {
    $lnk = $WShell.CreateShortcut("$Desktop\KawaiiGPT.lnk")
    $lnk.TargetPath       = $BatPath
    $lnk.WorkingDirectory = $Root
    $lnk.IconLocation     = "$IcoPath,0"
    $lnk.Description      = "Tu companera kawaii de IA (version actual)"
    $lnk.WindowStyle      = 1
    $lnk.Save()
    Write-Host "Acceso directo creado: $Desktop\KawaiiGPT.lnk" -ForegroundColor Green
}

# ── Acceso directo opcional: App empaquetada ─────────────────────────────────
if (Test-Path $ExePath) {
    $packLnk = $WShell.CreateShortcut("$Desktop\KawaiiGPT Empaquetada.lnk")
    $packLnk.TargetPath       = $ExePath
    $packLnk.WorkingDirectory = Split-Path $ExePath
    $packLnk.IconLocation     = "$IcoPath,0"
    $packLnk.Description      = "KawaiiGPT empaquetada (puede quedar desactualizada)"
    $packLnk.WindowStyle      = 1
    $packLnk.Save()
    Write-Host "Acceso directo empaquetado creado: $Desktop\KawaiiGPT Empaquetada.lnk" -ForegroundColor Green
} else {
    Write-Host "No se encontro ejecutable empaquetado en: $ExePath" -ForegroundColor Yellow
    Write-Host "Si lo necesitas, ejecuta: npm run package" -ForegroundColor Yellow
}

# ── Acceso directo: Dev alineado a version actual ────────────────────────────
$devLnk = $WShell.CreateShortcut("$Desktop\KawaiiGPT Dev.lnk")
$devLnk.TargetPath       = $BatPath
$devLnk.Arguments        = ""
$devLnk.WorkingDirectory = $Root
$devLnk.IconLocation     = "$IcoPath,0"
$devLnk.Description      = "KawaiiGPT Dev (alineado a version actual)"
$devLnk.WindowStyle      = 1
$devLnk.Save()
Write-Host "Acceso directo dev-alineado creado: $Desktop\KawaiiGPT Dev.lnk" -ForegroundColor Green

# ── Acceso directo opcional: Hot Reload Dev ──────────────────────────────────
$hotLnk = $WShell.CreateShortcut("$Desktop\KawaiiGPT Hot Reload Dev.lnk")
$hotLnk.TargetPath       = "cmd.exe"
$hotLnk.Arguments        = "/k `"cd /d `"$Root`" && npm run dev`""
$hotLnk.WorkingDirectory = $Root
$hotLnk.IconLocation     = "$IcoPath,0"
$hotLnk.Description      = "KawaiiGPT desarrollo con hot reload (entorno separado)"
$hotLnk.WindowStyle      = 1
$hotLnk.Save()
Write-Host "Acceso directo hot-reload creado: $Desktop\KawaiiGPT Hot Reload Dev.lnk" -ForegroundColor Green

Write-Host ""
Write-Host "Todo listo! Busca KawaiiGPT en tu escritorio." -ForegroundColor Cyan
