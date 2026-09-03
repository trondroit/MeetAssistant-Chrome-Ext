# 🎙 Meet Assistant — Extensión de Chrome

Asistente de reuniones con IA — funciona con **Zoom, Google Meet, Microsoft Teams y Webex** directamente en el navegador.

## Características
- 📝 Lee los **subtítulos en vivo** de la propia reunión (como Táctiq) — sin pedir compartir pantalla ni permisos de audio
- 🎙️ Modo alternativo: captura el audio de la pestaña (Whisper) para cuando no hay subtítulos disponibles
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
2. **Activa los subtítulos en vivo de la reunión** (botón "CC" / "Mostrar subtítulos" / "Subtítulos en vivo" según la plataforma)
3. El panel flotante 🎙 aparece automáticamente abajo a la derecha de la página
4. Deja el modo **📝 Subtítulos** seleccionado (es el predeterminado) y presiona **🎙 Escuchar reunión** — no aparece ningún permiso ni ventana de "compartir pantalla"
5. (Opcional) Clic en el banner de contexto para describir la reunión y tu rol
6. Cuando quieras comentar → **✨ Generar comentario** (o `Alt+G`)
7. El comentario aparece listo para leer → **📋 Copiar**
8. Al terminar, presiona **📄 Resumen final** para generar y guardar el acta de la reunión

El panel se arrastra tomándolo por la barra superior (el título "Meet Assistant"), y el botón **—** lo minimiza a una burbuja 🎙; clic en la burbuja para volver a abrirlo.

---

## Cómo funciona la transcripción

**Modo por defecto — 📝 Subtítulos:** igual que Táctiq, la extensión lee los subtítulos en vivo
que la propia plataforma (Meet/Zoom/Teams/Webex) ya genera y muestra en pantalla. No pide compartir
la pestaña ni ningún permiso de audio/pantalla — solo necesitas tener los subtítulos activados en
la reunión (botón "CC" en Meet, "Mostrar subtítulos" en Zoom, "Subtítulos en vivo" en el menú "…"
de Teams). El motor de detección busca automáticamente la región de subtítulos de la página y se
conecta en cuanto aparece.

**Modo alternativo — 🎙️ Audio de la pestaña:** si la plataforma no ofrece subtítulos o prefieres no
usarlos, cambia al modo de audio. Este usa `getDisplayMedia` para capturar el audio que reproduce
la propia pestaña (la voz de los demás participantes) y lo transcribe con Whisper — en este caso sí
te pedirá compartir la pestaña; asegúrate de activar la casilla "Compartir audio de la pestaña" en
el diálogo de Chrome, si no la marcas no se capturará ningún audio.

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
- En modo Subtítulos, el texto de los subtítulos se envía a la API de OpenAI (GPT-4o) solo para generar comentarios/resúmenes — no se captura audio ni video
- En modo Audio de la pestaña, el audio se envía directamente desde tu navegador a la API de OpenAI (Whisper) para transcripción
- Nada pasa por servidores intermedios propios
