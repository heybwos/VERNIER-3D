@echo off
title Vernier 3D
cd /d "%~dp0software"

set "PY="
python --version >nul 2>nul && set "PY=python"
if not defined PY py --version >nul 2>nul && set "PY=py"
if not defined PY (
  echo No encontre Python. Instalalo desde https://www.python.org/downloads/
  echo Marca la casilla "Add python.exe to PATH" y vuelve a abrir este archivo.
  pause
  exit /b 1
)

echo Revisando dependencias...
%PY% -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
  echo No se pudieron instalar las dependencias. La primera vez se necesita internet.
  pause
  exit /b 1
)

echo Abriendo la app. Deja esta ventana abierta mientras la uses.
%PY% servidor.py --serial auto --abrir
pause
