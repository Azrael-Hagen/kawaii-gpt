<#
.SYNOPSIS
  Crea los accesos directos de KawaiiGPT en el Escritorio y junto a este script.
.DESCRIPTION
  - Acceso directo "KawaiiGPT" → abre el ejecutable empaquetado dist\win-unpacked\KawaiiGPT.exe
  - Acceso directo "KawaiiGPT Dev" → entorno de desarrollo con npm run dev
  Solo se crean esos 2 accesos directos.
#>

$Root    = Split-Path $PSScriptRoot -Parent
$ExePath = Join-Path $Root "dist\win-unpacked\KawaiiGPT.exe"
$IcoPath = Join-Path $Root "resources\icon.ico"
$Desktop = [Environment]::GetFolderPath("Desktop")
$WShell  = New-Object -ComObject WScript.Shell

# Eliminar accesos anteriores que no se usarán.
$obsolete = @(
    "$Desktop\KawaiiGPT Hot Reload Dev.lnk",
    "$Desktop\KawaiiGPT Empaquetada.lnk"
)
foreach ($item in $obsolete) {
    if (Test-Path $item) {
        Remove-Item -Path $item -Force -ErrorAction SilentlyContinue
        Write-Host "Acceso obsoleto eliminado: $item" -ForegroundColor DarkYellow
    }
}

# ── Acceso directo: App empaquetada (EXE) ────────────────────────────────────
if (Test-Path $ExePath) {
    $lnk = $WShell.CreateShortcut("$Desktop\KawaiiGPT.lnk")
    $lnk.TargetPath       = $ExePath
    $lnk.WorkingDirectory = Split-Path $ExePath
    $lnk.IconLocation     = "$IcoPath,0"
    $lnk.Description      = "KawaiiGPT empaquetada (EXE)"
    $lnk.WindowStyle      = 1
    $lnk.Save()
    Write-Host "Acceso directo creado: $Desktop\KawaiiGPT.lnk" -ForegroundColor Green
} else {
    Write-Host "No se encontro ejecutable en: $ExePath" -ForegroundColor Yellow
    Write-Host "Ejecuta primero: npm run package" -ForegroundColor Yellow
}

# ── Acceso directo: Dev (npm run dev) ────────────────────────────────────────
$devLnk = $WShell.CreateShortcut("$Desktop\KawaiiGPT Dev.lnk")
$devLnk.TargetPath       = "cmd.exe"
$devLnk.Arguments        = "/k `"cd /d `"$Root`" && npm run dev`""
$devLnk.WorkingDirectory = $Root
$devLnk.IconLocation     = "$IcoPath,0"
$devLnk.Description      = "KawaiiGPT Dev (npm run dev)"
$devLnk.WindowStyle      = 1
$devLnk.Save()
Write-Host "Acceso directo dev creado: $Desktop\KawaiiGPT Dev.lnk" -ForegroundColor Green

Write-Host ""
Write-Host "Listo: 2 accesos directos creados (KawaiiGPT y KawaiiGPT Dev)." -ForegroundColor Cyan
