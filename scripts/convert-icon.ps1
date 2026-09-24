Add-Type -AssemblyName System.Drawing

$PngPath = Join-Path $PSScriptRoot "..\wp desktop.png"
$IcoPath = Join-Path $PSScriptRoot "..\wp desktop.ico"

if (Test-Path $IcoPath) {
    Remove-Item $IcoPath -Force
}

$bitmap = [System.Drawing.Bitmap]::FromFile($PngPath)
# Resize to 256x256 to meet electron-builder requirements
$resized = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($resized)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($bitmap, 0, 0, 256, 256)
$g.Dispose()

$iconHandle = $resized.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)

$fileStream = New-Object System.IO.FileStream($IcoPath, [System.IO.FileMode]::OpenOrCreate)
$icon.Save($fileStream)
$fileStream.Close()

$bitmap.Dispose()
$resized.Dispose()
$icon.Dispose()

Write-Output "Successfully converted PNG to ICO at $IcoPath"
