# 🎙 Meet Assistant Desktop

Asistente de reuniones con IA — funciona con **Zoom, Google Meet, Teams, cualquier app**.

## Características
- 🎤 Captura audio de todos los participantes (no solo tu micrófono)
- 🌐 Detecta automáticamente el idioma (español, inglés, etc.)
- 🤖 Genera comentarios con GPT-4o
- 📋 Contexto por reunión (tema, tu perfil, notas)
- 🔒 Panel flotante siempre visible, discreto
- ⌨️ Atajos: `Alt+M` escuchar · `Alt+G` generar

---

## Instalación

### 1. Requisitos
- **Node.js** 18+ → https://nodejs.org
- **Cuenta OpenAI** con API Key → https://platform.openai.com/api-keys

### 2. Instalar dependencias y ejecutar
```bash
npm install
npm start
```

---

## Capturar audio de Zoom/Teams (todos los participantes)

El micrófono por defecto solo captura tu voz. Para escuchar a todos necesitas
un **driver de audio virtual** que "loopea" el audio del sistema:

### macOS
1. Instala **BlackHole 2ch** (gratuito): https://existential.audio/blackhole/
2. Abre **Configuración de Sonido > Entrada** y selecciona BlackHole
3. Crea un **Dispositivo Multi-Salida** en Audio MIDI Setup:
   - Combina tus altavoces + BlackHole
   - Úsalo como salida de audio del sistema
4. En Meet Assistant, al presionar "Escuchar" selecciona BlackHole como entrada

### Windows
**Opción A — Stereo Mix (gratis, ya incluido en muchas tarjetas):**
1. Clic derecho en el ícono de sonido > Sonidos > Grabación
2. Clic derecho en área vacía > Mostrar dispositivos deshabilitados
3. Habilita "Stereo Mix" y ponlo como predeterminado

**Opción B — VB-Cable (gratuito):**
1. Descarga VB-Cable: https://vb-audio.com/Cable/
2. Instala y reinicia
3. En Reproducción: selecciona "CABLE Input" como salida
4. En Grabación: selecciona "CABLE Output" como entrada

---

## Uso

1. Abre la app → clic en ⚙️ para configurar tu OpenAI API Key
2. (Opcional) Clic en el banner de contexto para describir la reunión y tu rol
3. Únete a tu reunión en Zoom/Meet/Teams
4. Presiona **🎙 Escuchar** en el panel
5. Cuando quieras comentar → **✨ Generar comentario** (o `Alt+G`)
6. El comentario aparece listo para leer → **📋 Copiar**

---

## Estructura del proyecto
```
meet-assistant-desktop/
├── main.js              # Proceso principal Electron
├── preload.js           # Bridge seguro IPC
├── renderer.js          # Lógica del panel flotante
├── settings-renderer.js # Lógica de configuración
├── index.html           # Panel flotante UI
├── settings.html        # Ventana de configuración
└── package.json
```

---

## Notas de privacidad
- Tu API Key se guarda localmente en tu computadora (nunca se envía a terceros)
- El audio se envía directamente a OpenAI Whisper para transcripción
- Nada pasa por servidores intermedios
