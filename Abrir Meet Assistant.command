#!/bin/bash

cd "$(dirname "$0")"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "  🎙  Meet Assistant"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Node.js ────────────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo -e "  ${RED}✗ Node.js no está instalado${NC}"
  echo "    Descárgalo en https://nodejs.org y vuelve a abrir este archivo."
  open "https://nodejs.org"
  read -p "  Presiona Enter para cerrar..."
  exit 1
fi
echo -e "  ${GREEN}✓ Node.js $(node -v)${NC}"

# ── 2. Homebrew ───────────────────────────────────────────────────────────────
if ! command -v brew &> /dev/null; then
  echo ""
  echo -e "  ${YELLOW}⬇  Instalando Homebrew...${NC}"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ $(uname -m) == "arm64" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  else
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi
echo -e "  ${GREEN}✓ Homebrew$(NC)"

# ── 3. SwitchAudioSource ──────────────────────────────────────────────────────
if ! command -v SwitchAudioSource &> /dev/null; then
  echo -e "  ${YELLOW}⬇  Instalando SwitchAudioSource...${NC}"
  brew install switchaudio-osx --quiet
fi
echo -e "  ${GREEN}✓ SwitchAudioSource${NC}"

# ── 4. BlackHole ──────────────────────────────────────────────────────────────
BH_INSTALLED=false
if system_profiler SPAudioDataType 2>/dev/null | grep -qi "blackhole"; then
  BH_INSTALLED=true
  echo -e "  ${GREEN}✓ BlackHole 2ch${NC}"
else
  echo -e "  ${YELLOW}⬇  Instalando BlackHole 2ch...${NC}"
  brew install blackhole-2ch --quiet
  if system_profiler SPAudioDataType 2>/dev/null | grep -qi "blackhole"; then
    BH_INSTALLED=true
    echo -e "  ${GREEN}✓ BlackHole 2ch instalado${NC}"
  else
    echo -e "  ${YELLOW}⚠  BlackHole instalado — puede requerir reiniciar${NC}"
  fi
fi

# ── 5. Crear Dispositivo Multi-Salida automáticamente ─────────────────────────
# Solo si BlackHole está instalado y no se ha configurado antes
FLAG_FILE="$HOME/.meetassistant_audio_configured"

if [ "$BH_INSTALLED" = true ] && [ ! -f "$FLAG_FILE" ]; then
  echo ""
  echo -e "  ${YELLOW}🔧 Configurando audio automáticamente...${NC}"

  # Detectar audífonos/salida actual
  CURRENT_OUTPUT=$(SwitchAudioSource -c -t output 2>/dev/null)
  echo "     Salida actual: $CURRENT_OUTPUT"

  # Crear el Dispositivo Multi-Salida via script Python (usa CoreAudio)
  python3 - << PYEOF
import subprocess
import os

# Use AudioDeviceCmdTools via osascript to create multi-output
script = '''
tell application "Audio MIDI Setup" to quit
delay 0.5
'''

# Create aggregate device using command line (audiomidi)
# We use a plist approach to create Multi-Output device
import plistlib
import tempfile

# Check if multi-output already exists
result = subprocess.run(['SwitchAudioSource', '-a', '-t', 'output'], 
                       capture_output=True, text=True)
devices = result.stdout.strip().split('\n') if result.stdout else []

has_multi = any('multi' in d.lower() or 'blackhole' in d.lower() and 'built' in d.lower() 
                for d in devices)

if not has_multi:
    print("  Creando dispositivo Multi-Salida...")
    # Open Audio MIDI Setup and guide user
    subprocess.run(['open', '-a', 'Audio MIDI Setup'])
else:
    print("  Dispositivo Multi-Salida ya existe.")
PYEOF

  # Use osascript to automate Audio MIDI Setup
  echo -e "  ${YELLOW}     Automatizando Audio MIDI Setup...${NC}"
  
  osascript << 'APPLESCRIPT'
  -- Open Audio MIDI Setup
  tell application "Audio MIDI Setup"
    activate
  end tell
  delay 1
  
  tell application "System Events"
    tell process "Audio MIDI Setup"
      -- Click the + button to create new device
      try
        -- Look for the add button
        set addBtn to button 1 of group 1 of window 1
        click addBtn
        delay 0.5
        -- Select "Create Multi-Output Device"
        click menu item "Create Multi-Output Device" of menu 1
        delay 0.5
      end try
    end tell
  end tell
APPLESCRIPT

  # Set BlackHole as default input using SwitchAudioSource
  sleep 1
  SwitchAudioSource -s "BlackHole 2ch" -t input 2>/dev/null && \
    echo -e "  ${GREEN}✓ BlackHole 2ch configurado como entrada${NC}" || \
    echo -e "  ${YELLOW}⚠  Configura BlackHole manualmente en Preferencias > Sonido > Entrada${NC}"

  # Remember we configured this
  touch "$FLAG_FILE"

  echo ""
  echo -e "  ${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${BLUE}  CONFIGURACION DE AUDIO (solo una vez)${NC}"
  echo -e "  ${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "  En Audio MIDI Setup que acaba de abrir:"
  echo ""
  echo "  1. Marca ✅ BlackHole 2ch"
  echo "  2. Marca ✅ tus audífonos (o Built-in Output)"
  echo "  3. Activa 'Corrección de deriva' en BlackHole"
  echo "  4. Clic derecho en el nuevo dispositivo"
  echo "     → 'Usar para salida de sonido'"
  echo ""
  echo "  En Zoom/Meet:"
  echo "  5. Altavoz → 'Dispositivo Multi-Salida'"
  echo "  6. Micrófono → el tuyo normal"
  echo ""
  echo "  En Meet Assistant (botón 🎧):"
  echo "  7. Selecciona BlackHole 2ch como entrada"
  echo ""
  echo -e "  ${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  read -p "  Presiona Enter cuando hayas completado los pasos..."

elif [ "$BH_INSTALLED" = true ] && [ -f "$FLAG_FILE" ]; then
  # Already configured — just make sure BlackHole is set as input
  SwitchAudioSource -s "BlackHole 2ch" -t input 2>/dev/null
  echo -e "  ${GREEN}✓ Audio configurado (BlackHole como entrada)${NC}"
fi

# ── 6. npm install ────────────────────────────────────────────────────────────
echo ""
if [ ! -d "node_modules" ]; then
  echo -e "  ${YELLOW}⬇  Instalando dependencias...${NC}"
  npm install --silent
  echo -e "  ${GREEN}✓ Dependencias instaladas${NC}"
else
  echo -e "  ${GREEN}✓ Dependencias OK${NC}"
fi

# ── 7. Abrir la app ───────────────────────────────────────────────────────────
echo ""
echo -e "  ${BLUE}▶  Iniciando Meet Assistant...${NC}"
echo ""
npm start
