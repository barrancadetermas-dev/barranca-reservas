@echo off
echo ================================================
echo  MILA PMS - Instalador de actualizaciones
echo ================================================
echo.

set PROYECTO=C:\Users\barra\OneDrive\Escritorio\barranca-termas-pms
set ORIGEN=%~dp0

echo Origen:  %ORIGEN%
echo Destino: %PROYECTO%
echo.

xcopy /Y /S "%ORIGEN%js\*"      "%PROYECTO%\js\"
xcopy /Y    "%ORIGEN%css\*"     "%PROYECTO%\css\"
xcopy /Y    "%ORIGEN%public\*"  "%PROYECTO%\public\"
copy  /Y    "%ORIGEN%index.html" "%PROYECTO%\index.html"

echo.
echo ================================================
echo  Ahora abre una terminal en el proyecto y ejecuta:
echo.
echo  cd "%PROYECTO%"
echo  git add -A
echo  git commit -m "fix: rls avatar 14temas"
echo  git push
echo ================================================
pause
