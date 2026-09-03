# 🎙 Meet Assistant — Extensión de Chrome

Asistente de reuniones con IA — funciona con **Zoom, Google Meet, Microsoft Teams y Webex** directamente en el navegador.

## Características
- 🎤 Captura el audio de **todos los participantes** directamente desde la pestaña de la reunión (sin drivers de audio virtuales — usa la API nativa de Chrome para compartir el audio de la pestaña)
- 🌐 Detecta automáticamente el idioma (español, inglés, etc.) con Whisper
- 🤖 Genera comentarios con GPT-4o, en el tono y longitud que elijas
- 🌍 Traducción en vivo de la transcripción (a español o inglés)
- ⚡ Modo automático: detecta silencios o preguntas directas y sugiere un comentario solo
- 📋 Contexto por reunión (tema, tu perfil, notas) + perfil por defecto en Opciones
- 📄 Resumen ejecutivo al final de la reunión, guardado en `Descargas/Meet Assistant/`
- 🔒 Panel flotante y arrastrable, inyectado sobre la propia página de la reunión
- ⌨️ Atajos: `Alt+M` escuchar · `Alt+G` generar · `Alt+S` resumen

---

## Instalación (modo desarrollador)

1. Consigue una API Key de OpenAI en [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Abre `chrome://extensions` en Chrome (o Edge)
3. Activa **"Modo de desarrollador"** (arriba a la derecha)
4. Clic en **"Cargar descomprimida"** y selecciona esta carpeta
5. Clic en el ícono 🎙 de la extensión → **⚙️ Configuración** → pega tu API Key y guarda

---

## Uso

1. Entra a tu reunión en Google Meet, Zoom (web), Teams o Webex
2. El panel flotante 🎙 aparece automáticamente abajo a la derecha de la página
3. Presiona **🎙 Escuchar reunión** — Chrome te pedirá compartir la pestaña:
   activa la casilla **"Compartir audio de la pestaña"** y confirma
4. (Opcional) Clic en el banner de contexto para describir la reunión y tu rol
5. Cuando quieras comentar → **✨ Generar comentario** (o `Alt+G`)
6. El comentario aparece listo para leer → **📋 Copiar**
7. Al terminar, presiona **📄 Resumen final** para generar y guardar el acta de la reunión

El botón **—** minimiza el panel a una burbuja 🎙; clic en la burbuja para volver a abrirlo.

---

## Cómo funciona la captura de audio

A diferencia de la versión de escritorio (que necesitaba BlackHole/VB-Cable/Stereo Mix para
"loopear" el audio del sistema), esta extensión usa la API `getDisplayMedia` de Chrome para
capturar directamente el audio que reproduce la propia pestaña de la reunión — es decir, la voz
de todos los demás participantes — sin instalar nada adicional. Tu propio micrófono no se graba
(normalmente no se escucha a ti mismo en la pestaña), lo cual es justo lo que necesita el
asistente para saber qué te están diciendo y sugerirte una respuesta.

---

## Estructura del proyecto
```
meet-assistant-chrome-ext/
├── manifest.json      # Manifest V3
├── background.js       # Service worker (guardar reuniones, abrir Opciones)
├── content.js           # Panel flotante inyectado (Shadow DOM) + lógica de IA
├── popup.html/.js       # Popup de la barra de herramientas
├── options.html/.js     # Página de configuración (API Key, perfil, modelo)
└── icons/                # Íconos de la extensión
```

---

## Notas de privacidad
- Tu API Key se guarda solo en `chrome.storage.local` de tu navegador (nunca se envía a terceros)
- El audio se envía directamente desde tu navegador a la API de OpenAI (Whisper) para transcripción
- Nada pasa por servidores intermedios propios
