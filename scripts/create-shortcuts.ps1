<#
.SYNOPSIS
  Crea los accesos directos de KawaiiGPT en el Escritorio y junto a este script.
.DESCRIPTION
  - Acceso directo "KawaiiGPT" → abre directamente dist\win-unpacked\KawaiiGPT.exe
  - Acceso directo "KawaiiGPT Dev" → lanza la versión de desarrollo con npm run dev
  El ícono kawaii (resources\icon.ico) se asigna automáticamente a ambos.
#>

$Root    = Split-Path $PSScriptRoot -Parent
$ExePath = Join-Path $Root "dist\win-unpacked\KawaiiGPT.exe"
$IcoPath = Join-Path $Root "resources\icon.ico"
$Desktop = [Environment]::GetFolderPath("Desktop")
$WShell  = New-Object -ComObject WScript.Shell

# ── Acceso directo: App empaquetada ──────────────────────────────────────────
if (Test-Path $ExePath) {
    $lnk = $WShell.CreateShortcut("$Desktop\KawaiiGPT.lnk")
    $lnk.TargetPath       = $ExePath
    $lnk.WorkingDirectory = Split-Path $ExePath
    $lnk.IconLocation     = "$IcoPath,0"
    $lnk.Description      = "Tu companera kawaii de IA"
    $lnk.WindowStyle      = 1
    $lnk.Save()
    Write-Host "Acceso directo creado: $Desktop\KawaiiGPT.lnk" -ForegroundColor Green
} else {
    Write-Host "No se encontro el ejecutable en: $ExePath" -ForegroundColor Yellow
    Write-Host "Ejecuta primero: npm run package" -ForegroundColor Yellow
}

# ── Acceso directo: modo desarrollador ───────────────────────────────────────
$devTarget = "cmd.exe"
$devArgs   = "/k `"cd /d `"$Root`" && npm run dev`""

$devLnk = $WShell.CreateShortcut("$Desktop\KawaiiGPT Dev.lnk")
$devLnk.TargetPath       = $devTarget
$devLnk.Arguments        = $devArgs
$devLnk.WorkingDirectory = $Root
$devLnk.IconLocation     = "$IcoPath,0"
$devLnk.Description      = "KawaiiGPT - modo desarrollo"
$devLnk.WindowStyle      = 1
$devLnk.Save()
Write-Host "Acceso directo dev creado: $Desktop\KawaiiGPT Dev.lnk" -ForegroundColor Green

# ── Crea un .bat de inicio rapido junto al ejecutable ────────────────────────
if (Test-Path $ExePath) {
    $batContent = "@echo off" + [Environment]::NewLine + "start `"`" `"$ExePath`"" + [Environment]::NewLine
    Set-Content -Path (Join-Path $Root "Abrir KawaiiGPT.bat") -Value $batContent -Encoding ASCII
    Write-Host "Lanzador .bat creado: $Root\Abrir KawaiiGPT.bat" -ForegroundColor Green
}

Write-Host ""
Write-Host "Todo listo! Busca KawaiiGPT en tu escritorio." -ForegroundColor Cyan
