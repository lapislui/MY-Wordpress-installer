@echo off
setlocal

cd /d "%~dp0"

for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "APP_VERSION=%%v"
set "DIST_DIR=%CD%\dist"
set "UNPACKED_DIR=%DIST_DIR%\win-unpacked"
set "ZIP_PATH=%DIST_DIR%\WP Desktop-%APP_VERSION%-portable.zip"

echo Packaging Windows installer and unpacked folder...
call npm run pack:win
if errorlevel 1 (
  echo Packaging failed.
  exit /b 1
)

if exist "%ZIP_PATH%" del /f /q "%ZIP_PATH%"

echo Creating portable zip...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%UNPACKED_DIR%\\*' -DestinationPath '%ZIP_PATH%' -CompressionLevel Optimal"
if errorlevel 1 (
  echo Zip creation failed.
  exit /b 1
)

echo.
echo Done.
echo Installer: %DIST_DIR%\WP Desktop-%APP_VERSION%.exe
echo Folder:    %UNPACKED_DIR%
echo Zip:       %ZIP_PATH%

endlocal
