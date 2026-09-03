@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Meet Assistant
cd /d "%~dp0"

echo.
echo   Meet Assistant
echo   ====================================
echo.

:: ── 1. Verificar Node.js ──────────────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   Node.js no esta instalado. Descargando...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi' -OutFile '%TEMP%\nodejs.msi' -UseBasicParsing"
    if exist "%TEMP%\nodejs.msi" (
        echo   Instalando Node.js...
        msiexec /i "%TEMP%\nodejs.msi" /passive /norestart
        set "PATH=%PATH%;C:\Program Files\nodejs"
        echo   OK - Node.js instalado.
    ) else (
        echo   ERROR - No se pudo descargar Node.js.
        echo   Descargalo en: https://nodejs.org
        pause
        exit /b 1
    )
) else (
    for /f "tokens=*" %%v in ('node -v 2^>nul') do echo   OK - Node.js %%v
)

:: ── 2. Verificar Voicemeeter Banana ──────────────────────────────────────────
echo.
echo   Verificando Voicemeeter Banana...

set "VM_PATH_1=C:\Program Files (x86)\VB\Voicemeeter\voicemeeterpro.exe"
set "VM_PATH_2=C:\Program Files\VB\Voicemeeter\voicemeeterpro.exe"
set "VM_FOUND=0"

if exist "!VM_PATH_1!" set "VM_FOUND=1"
if exist "!VM_PATH_2!" set "VM_FOUND=1"

if "!VM_FOUND!"=="0" (
    echo   Voicemeeter Banana no esta instalado.
    echo.
    echo   Voicemeeter es necesario para:
    echo   - Escuchar la reunion CON tus audifonos
    echo   - Que Meet Assistant capture solo a los demas participantes
    echo   - Tu voz NO sea capturada por el asistente
    echo.
    choice /C SN /N /M "   Instalar Voicemeeter Banana ahora? (S/N): "
    if !errorlevel! equ 1 (
        echo.
        echo   Descargando Voicemeeter Banana...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://download.vb-audio.com/Download_CABLE/VoicemeeterProSetup_v2103.zip' -OutFile '%TEMP%\voicemeeter.zip' -UseBasicParsing"
        
        if exist "%TEMP%\voicemeeter.zip" (
            echo   Extrayendo...
            powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%TEMP%\voicemeeter.zip' -DestinationPath '%TEMP%\voicemeeter' -Force"
            
            if exist "%TEMP%\voicemeeter\VoicemeeterProSetup.exe" (
                echo   Instalando Voicemeeter Banana...
                echo   IMPORTANTE: Acepta el instalador cuando aparezca.
                "%TEMP%\voicemeeter\VoicemeeterProSetup.exe" /S
                timeout /t 5 /nobreak >nul
                echo.
                echo   Voicemeeter instalado.
                set "VM_FOUND=1"
            ) else (
                echo   No se pudo extraer. Abriendo descarga manual...
                start "" "https://vb-audio.com/Voicemeeter/banana.htm"
            )
        ) else (
            echo   No se pudo descargar. Abriendo pagina oficial...
            start "" "https://vb-audio.com/Voicemeeter/banana.htm"
            echo.
            echo   1. Descarga e instala Voicemeeter Banana
            echo   2. Reinicia el equipo
            echo   3. Vuelve a abrir Meet Assistant
            pause
            exit /b 0
        )
    )
)

if "!VM_FOUND!"=="1" (
    echo   OK - Voicemeeter Banana detectado.
    
    :: Abrir Voicemeeter si no esta corriendo
    tasklist /FI "IMAGENAME eq voicemeeterpro.exe" 2>nul | find /I "voicemeeterpro.exe" >nul
    if !errorlevel! neq 0 (
        echo   Iniciando Voicemeeter Banana...
        if exist "!VM_PATH_1!" start "" "!VM_PATH_1!"
        if exist "!VM_PATH_2!" start "" "!VM_PATH_2!"
        timeout /t 3 /nobreak >nul
    ) else (
        echo   OK - Voicemeeter ya esta corriendo.
    )
    
    :: Mostrar instrucciones de configuracion si es primera vez
    if not exist "%~dp0voicemeeter_configured.flag" (
        echo.
        echo   ============================================
        echo   CONFIGURACION DE VOICEMEETER (solo una vez)
        echo   ============================================
        echo.
        echo   En Voicemeeter Banana que acaba de abrir:
        echo.
        echo   1. HARDWARE INPUT 1  -^> selecciona tu microfono
        echo.  
        echo   2. HARDWARE OUT A1   -^> selecciona tus audifonos
        echo      (esto hace que escuches la reunion)
        echo.
        echo   3. En Zoom/Meet/Teams:
        echo      - Salida de audio: "VoiceMeeter Input"
        echo      - Microfono:       "VoiceMeeter Output" (opcional)
        echo.
        echo   4. En Meet Assistant (boton de audifonos):
        echo      - Selecciona "VoiceMeeter Output" como entrada
        echo      - Asi solo captura lo que dicen los demas
        echo.
        echo   ============================================
        echo.
        pause
        :: Create flag so we don't show this again
        echo configured > "%~dp0voicemeeter_configured.flag"
    )
)

:: ── 3. Verificar VB-Cable (complemento de Voicemeeter) ───────────────────────
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = Get-WmiObject Win32_SoundDevice | Where-Object {$_.Name -match 'VB-Audio|CABLE'}; if ($d) { Write-Host ('   OK - ' + $d[0].Name + ' detectado') } else { Write-Host '   INFO - VB-Cable no detectado (Voicemeeter es suficiente)' }"

:: ── 4. Instalar dependencias npm ─────────────────────────────────────────────
echo.
if not exist "node_modules\" (
    echo   Instalando dependencias, puede tardar 2 minutos...
    call npm install
    if !errorlevel! neq 0 (
        echo   ERROR - No se pudieron instalar las dependencias.
        pause
        exit /b 1
    )
    echo   OK - Dependencias instaladas.
) else (
    echo   OK - Dependencias listas.
)

:: ── 5. Abrir la app ───────────────────────────────────────────────────────────
echo.
echo   Iniciando Meet Assistant...
echo.
call npm start
if !errorlevel! neq 0 (
    echo.
    echo   Error al iniciar. Presiona Enter para cerrar.
    pause
)
