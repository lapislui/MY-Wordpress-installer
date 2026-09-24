$CacheDir = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
$7zFile = Get-ChildItem -Path $CacheDir -Filter "*.7z" | Select-Object -First 1

if (-not $7zFile) {
    Write-Error "No .7z winCodeSign file found in $CacheDir"
    exit 1
}

$DestDir = Join-Path $CacheDir "winCodeSign-2.6.0"
if (Test-Path $DestDir) {
    Remove-Item $DestDir -Recurse -Force
}

$7za = Join-Path $PSScriptRoot "..\node_modules\7zip-bin\win\x64\7za.exe"
if (-not (Test-Path $7za)) {
    Write-Error "7za.exe not found at $7za"
    exit 1
}

Write-Output "Extracting $($7zFile.FullName) to $DestDir (excluding darwin/)..."
& $7za x $7zFile.FullName "-o$DestDir" "-xr!darwin" -y

if ($LASTEXITCODE -eq 0) {
    Write-Output "Successfully extracted winCodeSign-2.6.0."
} else {
    Write-Error "Extraction failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}
