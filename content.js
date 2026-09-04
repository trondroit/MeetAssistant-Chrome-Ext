// Meet Assistant — Content script
// Injects a floating panel (inside a Shadow DOM, isolated from the host page)
// into Zoom / Google Meet / Teams / Webex tabs. By default it reads the
// meeting platform's own live captions (like Táctiq) — no share-this-tab
// prompt, no audio permissions. A "🎙️ Audio de la pestaña" fallback mode
// (getDisplayMedia + Whisper) is available for when captions aren't on.
// Either way, GPT-4o drafts the comments.

(function () {
  if (window.__meetAssistantInjected) return;
  window.__meetAssistantInjected = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ping') { sendResponse({ ok: true }); return; }
  });

  const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .ma-root { position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
  #app { width: 360px; height: 620px; background: rgba(18,18,30,0.97); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; color: #e0e0f0; box-shadow: 0 20px 60px rgba(0,0,0,0.55); }
  #app.hidden { display: none; }

  /* Bubble (minimized) */
  #bubble { display: none; width: 52px; height: 52px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#8b5cf6); align-items: center; justify-content: center; font-size: 22px; cursor: pointer; box-shadow: 0 8px 24px rgba(0,0,0,.45); border: none; }
  #bubble.visible { display: flex; }
  #bubble .dot { position: absolute; top: 2px; right: 2px; width: 12px; height: 12px; border-radius: 50%; background: #555; border: 2px solid #13131f; }
  #bubble .dot.listening { background: #4ade80; }

  /* Header */
  #header { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px 9px; background: rgba(255,255,255,0.04); border-bottom: 1px solid rgba(255,255,255,0.07); cursor: move; flex-shrink: 0; user-select: none; }
  #header-left { display: flex; align-items: center; gap: 7px; }
  #app-title { font-size: 13px; font-weight: 600; color: #a5b4fc; }
  .status-dot { width: 7px; height: 7px; border-radius: 50%; background: #555; flex-shrink: 0; }
  .status-dot.listening { background: #4ade80; animation: pulse 1.2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.4)} }
  #header-actions { display: flex; gap: 3px; }
  .hbtn { background: none; border: none; color: #666; cursor: pointer; padding: 4px 6px; border-radius: 6px; font-size: 12px; transition: background .15s, color .15s; }
  .hbtn:hover { background: rgba(255,255,255,.1); color: #e0e0f0; }

  /* Body */
  #body { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  #body::-webkit-scrollbar { width: 3px; }
  #body::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

  /* Context bar */
  #context-bar { background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.22); border-radius: 10px; padding: 7px 11px; font-size: 11.5px; color: #a5b4fc; display: flex; align-items: flex-start; gap: 7px; cursor: pointer; transition: background .15s; }
  #context-bar:hover { background: rgba(99,102,241,0.18); }
  #context-bar.has-context { border-color: rgba(74,222,128,0.3); background: rgba(74,222,128,0.07); color: #86efac; }
  #context-icon { font-size: 13px; flex-shrink: 0; }
  #context-text { line-height: 1.5; flex: 1; }

  .section-label { font-size: 10.5px; color: #555; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; display: flex; align-items: center; gap: 6px; }
  #lang-badge { background: rgba(255,255,255,.07); border-radius: 4px; padding: 1px 6px; font-size: 10px; color: #888; text-transform: none; letter-spacing: 0; }
  #transcript-box { background: #0d0d1a; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 9px 11px; min-height: 60px; max-height: 100px; overflow-y: auto; font-size: 12.5px; line-height: 1.65; color: #b0b0cc; word-break: break-word; }
  #transcript-box::-webkit-scrollbar { width: 3px; }
  #transcript-box::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
  .placeholder-txt { color: #444; font-style: italic; }
  #capture-hint { font-size: 10.5px; color: #6b7280; line-height: 1.5; padding: 0 1px; }

  #translation-wrap { display: none; flex-direction: column; gap: 5px; }
  #translation-wrap.visible { display: flex; }
  #translation-box { background: rgba(16,163,127,0.08); border: 1px solid rgba(16,163,127,0.2); border-radius: 10px; padding: 9px 11px; min-height: 44px; max-height: 90px; overflow-y: auto; font-size: 12.5px; line-height: 1.65; color: #86efac; word-break: break-word; }

  .toggle-row { display: flex; gap: 0; background: rgba(255,255,255,.05); border-radius: 9px; padding: 3px; border: 1px solid rgba(255,255,255,.07); }
  .tgl-btn { flex: 1; padding: 6px 6px; border-radius: 7px; border: none; background: none; color: #666; font-size: 11px; font-weight: 500; cursor: pointer; font-family: inherit; transition: all .15s; text-align: center; }
  .tgl-btn.active { background: rgba(99,102,241,.3); color: #c4b5fd; font-weight: 600; }
  .tgl-btn.active.green { background: rgba(74,222,128,.2); color: #4ade80; }
  .tgl-btn.active.teal { background: rgba(16,163,127,.25); color: #5eead4; }

  .row-wrap { display: flex; flex-direction: column; gap: 4px; }
  .row-label { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: .05em; }

  #listen-btn { width: 100%; padding: 9px 10px; border-radius: 9px; border: none; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background .15s; display: flex; align-items: center; justify-content: center; gap: 6px; }
  #listen-btn.idle { background: #10a37f; color: white; }
  #listen-btn.idle:hover { background: #1abc9c; }
  #listen-btn.active { background: #c0392b; color: white; }
  #listen-btn.active:hover { background: #e74c3c; }

  #auto-status { font-size: 11px; color: #555; text-align: center; min-height: 13px; }
  #auto-status.waiting { color: #4ade80; }
  #auto-status.detected { color: #fbbf24; }

  .idea-label { font-size: 10.5px; color: #555; text-transform: uppercase; letter-spacing: .06em; display: flex; align-items: center; justify-content: space-between; }
  .idea-label span { color: #3a3a55; font-size: 10px; text-transform: none; letter-spacing: 0; }
  #my-idea-input { width: 100%; background: #0d0d1a; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 8px 11px; color: #c0c0d8; font-size: 12.5px; font-family: inherit; resize: none; height: 46px; line-height: 1.55; }
  #my-idea-input:focus { outline: none; border-color: rgba(99,102,241,.5); }
  #my-idea-input::placeholder { color: #3a3a55; }

  .two-col { display: flex; gap: 7px; }
  .two-col .row-wrap { flex: 1; }
  select.mini-sel { width: 100%; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1); color: #c0c0d8; border-radius: 8px; padding: 7px 6px; font-size: 11px; font-family: inherit; cursor: pointer; }

  #length-row { display: flex; gap: 5px; }
  .len-btn { flex: 1; padding: 6px 3px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); color: #555; font-size: 10.5px; cursor: pointer; font-family: inherit; font-weight: 500; transition: all .15s; text-align: center; }
  .len-btn:hover { background: rgba(255,255,255,.1); color: #c0c0d8; }
  .len-btn.active { background: rgba(99,102,241,.25); border-color: rgba(99,102,241,.5); color: #a5b4fc; font-weight: 600; }

  #gen-btn { width: 100%; padding: 10px 14px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border: none; border-radius: 10px; color: white; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: opacity .15s, transform .1s; display: flex; align-items: center; justify-content: center; gap: 7px; }
  #gen-btn:hover { opacity: .88; }
  #gen-btn:active { transform: scale(.98); }
  #gen-btn:disabled { opacity: .35; cursor: not-allowed; transform: none; }

  #comment-feed { display: flex; flex-direction: column; gap: 8px; }
  .comment-entry { background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3); border-radius: 10px; padding: 10px 13px; word-break: break-word; white-space: pre-wrap; }
  .comment-entry.auto { border-color: rgba(74,222,128,0.3); background: rgba(74,222,128,0.07); }
  .comment-ts { font-size: 10px; color: #555; margin-bottom: 5px; display: flex; align-items: center; gap: 5px; }
  .comment-ts.auto { color: #4ade80; }
  .comment-text { font-size: 13.5px; line-height: 1.7; color: #e2e0ff; }
  .comment-entry.auto .comment-text { color: #d4fce4; }
  .comment-copy-btn { font-size: 10.5px; color: #666; background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 5px; font-family: inherit; margin-top: 5px; }
  .comment-copy-btn:hover { background: rgba(255,255,255,.1); color: #c0c0d8; }

  #comment-section { display: flex; flex-direction: column; gap: 7px; }
  #comment-actions { display: none; gap: 6px; }
  .act-btn { flex: 1; padding: 7px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.05); color: #c0c0d8; font-size: 11px; cursor: pointer; font-family: inherit; font-weight: 500; transition: background .15s; }
  .act-btn:hover { background: rgba(255,255,255,.12); color: white; }

  #save-row { display: flex; gap: 6px; }
  #btn-save { flex: 1; padding: 9px 10px; background: rgba(16,163,127,0.1); border: 1px solid rgba(16,163,127,0.25); border-radius: 10px; color: #10a37f; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 6px; transition: background .15s; }
  #btn-save:hover { background: rgba(16,163,127,0.2); }
  #btn-save:disabled { opacity: .35; cursor: not-allowed; }
  #btn-summary { flex: 1.4; padding: 9px 14px; background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.25); border-radius: 10px; color: #fbbf24; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 7px; transition: background .15s; }
  #btn-summary:hover { background: rgba(251,191,36,0.2); }
  #btn-summary:disabled { opacity: .35; cursor: not-allowed; }

  #recovery-banner { display: none; align-items: center; justify-content: space-between; gap: 8px; background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.3); border-radius: 10px; padding: 8px 10px; font-size: 11px; color: #fbbf24; flex-wrap: wrap; }
  #recovery-banner.visible { display: flex; }
  .recovery-actions { display: flex; gap: 6px; }
  .recovery-actions button { padding: 5px 9px; border-radius: 7px; border: 1px solid rgba(251,191,36,.3); background: rgba(251,191,36,.15); color: #fbbf24; font-size: 10.5px; cursor: pointer; font-family: inherit; font-weight: 600; }
  .recovery-actions button:hover { background: rgba(251,191,36,.28); }
  .recovery-actions #recovery-dismiss { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.12); color: #999; }

  #footer { padding: 4px 13px 8px; font-size: 11px; color: #555; text-align: center; flex-shrink: 0; }
  #footer.error #status-text { color: #f87171; }
  .shortcut { color: #333; font-size: 10px; margin-top: 2px; }

  #no-key-screen { display: none; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; padding: 24px; text-align: center; }
  #no-key-screen.visible { display: flex; }
  #no-key-screen h3 { font-size: 15px; color: #a5b4fc; }
  #no-key-screen p { font-size: 12px; color: #888; line-height: 1.6; }
  .setup-btn { padding: 10px 24px; background: #10a37f; border: none; border-radius: 9px; color: white; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }

  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.75); z-index: 200; align-items: center; justify-content: center; padding: 12px; }
  .modal-overlay.open { display: flex; }
  .modal-box { background: #1a1a2e; border: 1px solid rgba(255,255,255,.1); border-radius: 14px; width: 100%; display: flex; flex-direction: column; overflow: hidden; }
  #ctx-modal .modal-box { max-width: 300px; padding: 18px; }
  #ctx-modal h3 { font-size: 14px; color: #a5b4fc; margin-bottom: 13px; }
  #ctx-modal label { font-size: 11px; color: #888; display: block; margin-bottom: 5px; }
  #ctx-modal textarea { width: 100%; background: #0d0d1a; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 8px 10px; color: #c0c0d8; font-size: 12px; font-family: inherit; resize: vertical; min-height: 60px; margin-bottom: 10px; }
  #ctx-modal textarea:focus { outline: none; border-color: #6366f1; }
  .ctx-btns { display: flex; gap: 8px; }
  .ctx-btns button { flex: 1; padding: 8px; border-radius: 8px; font-family: inherit; font-size: 12px; cursor: pointer; }
  #ctx-cancel { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: #888; }
  #ctx-save { background: #6366f1; border: none; color: white; font-weight: 600; }

  #summary-modal .modal-box { max-height: 90vh; max-width: 380px; }
  #sum-header { padding: 14px 16px 12px; border-bottom: 1px solid rgba(255,255,255,.07); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  #sum-header h3 { font-size: 14px; color: #fbbf24; font-weight: 600; }
  .sum-hbtn { background: none; border: none; color: #666; cursor: pointer; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-family: inherit; }
  .sum-hbtn:hover { background: rgba(255,255,255,.1); color: #e0e0f0; }
  #summary-content { flex: 1; overflow-y: auto; padding: 14px 16px; font-size: 12.5px; line-height: 1.7; color: #c0c0d8; max-height: 50vh; }
  .sum-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .sum-meta span { background: rgba(255,255,255,.07); border-radius: 6px; padding: 3px 8px; font-size: 11px; color: #888; }
  .sum-placeholder { color: #555; font-style: italic; text-align: center; padding: 20px 0; }
  .sum-body h3 { font-size: 13px; color: #fbbf24; margin: 14px 0 7px; font-weight: 600; }
  .sum-body ul { padding-left: 16px; margin: 4px 0 8px; }
  .sum-body li { margin-bottom: 4px; }
  .sum-body strong { color: #e0e0f0; }
  #sum-saved-msg { display: none; font-size: 11px; color: #4ade80; text-align: center; padding: 5px 14px 0; }
  #btn-open-folder { display: none; align-items: center; justify-content: center; gap: 5px; padding: 6px 12px; background: rgba(74,222,128,.1); border: 1px solid rgba(74,222,128,.25); border-radius: 7px; color: #4ade80; font-size: 11.5px; cursor: pointer; font-family: inherit; margin: 6px 14px 4px; width: calc(100% - 28px); }
  #btn-open-folder:hover { background: rgba(74,222,128,.2); }
  #sum-footer { padding: 10px 14px; border-top: 1px solid rgba(255,255,255,.07); display: flex; gap: 7px; flex-shrink: 0; }
  #summary-generate { flex: 2; padding: 9px; background: linear-gradient(135deg, #f59e0b, #d97706); border: none; border-radius: 8px; color: white; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
  #summary-generate:disabled { opacity: .5; cursor: not-allowed; }
  #summary-copy { flex: 1; padding: 9px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; color: #c0c0d8; font-size: 12px; cursor: pointer; font-family: inherit; }
  #summary-copy:hover { background: rgba(255,255,255,.12); }
  #summary-new { flex: 1; padding: 9px; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.25); border-radius: 8px; color: #f87171; font-size: 12px; cursor: pointer; font-family: inherit; }
  #summary-new:hover { background: rgba(239,68,68,.2); }
  `;

  const MARKUP = `
  <button id="bubble" title="Abrir Meet Assistant">🎙<span class="dot" id="bubble-dot"></span></button>
  <div id="app">

    <div id="header">
      <div id="header-left">
        <span style="font-size:16px">🎙</span>
        <span id="app-title">Meet Assistant</span>
        <span class="status-dot" id="status-dot"></span>
      </div>
      <div id="header-actions">
        <button class="hbtn" id="btn-settings" title="Configuración">⚙️</button>
        <button class="hbtn" id="btn-min" title="Minimizar">—</button>
      </div>
    </div>

    <div id="no-key-screen">
      <div style="font-size:34px">🔑</div>
      <h3>Configura tu API Key</h3>
      <p>Necesitas una API Key de OpenAI para usar el asistente.</p>
      <button class="setup-btn" id="btn-setup">Abrir configuración</button>
    </div>

    <div id="body">

      <div id="recovery-banner">
        <span>⚠️ Hay una reunión sin guardar de antes</span>
        <div class="recovery-actions">
          <button id="recovery-download">💾 Descargar</button>
          <button id="recovery-dismiss">Descartar</button>
        </div>
      </div>

      <div id="context-bar" title="Clic para editar contexto">
        <span id="context-icon">📋</span>
        <span id="context-text">Sin contexto — clic para agregar info sobre la reunión o tu perfil</span>
      </div>

      <div>
        <div class="section-label">
          Transcripción en vivo
          <span id="lang-badge">—</span>
        </div>
        <div id="transcript-box">
          <span class="placeholder-txt">Presiona "Escuchar" para empezar a transcribir...</span>
        </div>
      </div>

      <div id="translation-wrap">
        <div class="section-label">🌐 Traducción en tiempo real</div>
        <div id="translation-box"></div>
      </div>

      <div class="row-wrap">
        <div class="row-label">Fuente de transcripción</div>
        <div class="toggle-row">
          <button class="tgl-btn" id="mode-captions">📝 Subtítulos</button>
          <button class="tgl-btn" id="mode-audio">🎙️ Audio pestaña</button>
        </div>
      </div>

      <button id="listen-btn" class="idle">🎙 Escuchar reunión</button>
      <div id="capture-hint"></div>

      <div class="row-wrap">
        <div class="row-label">Traducción en tiempo real</div>
        <div class="toggle-row">
          <button class="tgl-btn active" id="trans-off">🚫 Sin traducción</button>
          <button class="tgl-btn" id="trans-to-es">→ 🇪🇸 Español</button>
          <button class="tgl-btn" id="trans-to-en">→ 🇺🇸 English</button>
        </div>
      </div>

      <div>
        <div class="idea-label">
          Tu idea / punto a comentar
          <span>Opcional</span>
        </div>
        <textarea id="my-idea-input" placeholder="Ej: creo que deberíamos priorizar la migración antes del Q4..."></textarea>
      </div>

      <div class="two-col">
        <div class="row-wrap">
          <div class="row-label">Tono del comentario</div>
          <select class="mini-sel" id="tone-sel">
            <option value="colaborativo">Colaborativo</option>
            <option value="analitico">Analítico</option>
            <option value="propositivo">Proponer acción</option>
            <option value="pregunta">Pregunta clave</option>
            <option value="resumen">Resumir turno</option>
            <option value="acuerdo">Ampliar idea</option>
            <option value="tecnico">Técnico</option>
          </select>
        </div>
        <div class="row-wrap">
          <div class="row-label">Idioma del comentario</div>
          <select class="mini-sel" id="comment-lang-sel">
            <option value="auto">🌐 Como la reunión</option>
            <option value="es">🇪🇸 Siempre español</option>
            <option value="en">🇺🇸 Always English</option>
          </select>
        </div>
      </div>

      <div class="row-wrap">
        <div class="row-label">Modo de generación</div>
        <div class="toggle-row">
          <button class="tgl-btn active" id="btn-manual">✋ Manual</button>
          <button class="tgl-btn" id="btn-auto">⚡ Automático</button>
        </div>
      </div>
      <div id="auto-status"></div>

      <div class="row-wrap">
        <div class="row-label">Longitud del comentario</div>
        <div id="length-row">
          <button class="len-btn active" data-len="short">Corto</button>
          <button class="len-btn" data-len="medium">Medio</button>
          <button class="len-btn" data-len="long">Largo</button>
          <button class="len-btn" data-len="extended">Detallado</button>
        </div>
      </div>

      <button id="gen-btn" disabled>✨ Generar comentario <kbd style="font-size:10px;opacity:.5">Alt+G</kbd></button>

      <div id="comment-section">
        <div id="comment-feed"></div>
        <div id="comment-actions">
          <button class="act-btn" id="btn-regen">↺ Otra versión</button>
          <button class="act-btn" id="btn-clear-feed">🗑 Borrar todos</button>
        </div>
      </div>

      <div id="save-row">
        <button id="btn-save" disabled>💾 Guardar</button>
        <button id="btn-summary" disabled>📄 Resumen final <kbd style="font-size:10px;opacity:.5">Alt+S</kbd></button>
      </div>

    </div>

    <div id="footer">
      <div id="status-text">Listo</div>
      <div class="shortcut">Alt+M mic · Alt+G generar · Alt+S resumen</div>
    </div>
  </div>

  <div id="ctx-modal" class="modal-overlay">
    <div class="modal-box">
      <h3>📋 Contexto de la reunión</h3>
      <label>Tema / objetivo</label>
      <textarea id="ctx-topic" placeholder="Ej: Revisión roadmap Q3, cliente ACME Corp..."></textarea>
      <label>Tu perfil / rol</label>
      <textarea id="ctx-profile" placeholder="Ej: Soy el CTO, especialista en infraestructura cloud..."></textarea>
      <label>Notas adicionales</label>
      <textarea id="ctx-notes" placeholder="Ej: Presupuesto máximo $50k. Evitar hablar de competidor X." style="min-height:44px"></textarea>
      <div class="ctx-btns">
        <button id="ctx-cancel">Cancelar</button>
        <button id="ctx-save">Guardar</button>
      </div>
    </div>
  </div>

  <div id="summary-modal" class="modal-overlay">
    <div class="modal-box">
      <div id="sum-header">
        <h3>📄 Resumen de la reunión</h3>
        <button class="sum-hbtn" id="summary-close">✕</button>
      </div>
      <div id="summary-content">
        <div class="sum-placeholder">Presiona "Generar resumen" para analizar con GPT-4o</div>
      </div>
      <div id="sum-saved-msg"></div>
      <button id="btn-open-folder">📁 Abrir carpeta de descargas</button>
      <div id="sum-footer">
        <button id="summary-generate">✨ Generar resumen</button>
        <button id="summary-copy">📋 Copiar</button>
        <button id="summary-new">🔄 Nueva reunión</button>
      </div>
    </div>
  </div>
  `;

  // ── Mount shadow root ────────────────────────────────────────────────────
  const host = document.createElement('div');
  host.id = 'meet-assistant-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  const rootEl = document.createElement('div');
  rootEl.className = 'ma-root';
  rootEl.innerHTML = MARKUP;
  shadow.appendChild(styleEl);
  shadow.appendChild(rootEl);
  (document.body || document.documentElement).appendChild(host);

  const $ = id => shadow.getElementById(id);

  // ── Config (chrome.storage.local) ───────────────────────────────────────
  async function loadConfig() {
    return new Promise(resolve => chrome.storage.local.get(null, resolve));
  }
  async function saveConfig(patch) {
    return new Promise(resolve => chrome.storage.local.set(patch, resolve));
  }

  (async function main() {
    let config = await loadConfig();
    let isListening = false;
    let captureStream = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let currentTranscript = '';
    let meetingLog = [];
    let lastComment = '';
    let detectedLang = null;
    let context = { topic: '', profile: '', notes: '' };
    let meetingStartTime = null;
    let meetingFileName = null; // stable per meeting, so repeat saves overwrite instead of piling up
    let selectedLength = 'medium';
    let autoMode = false;
    let silenceTimer = null;
    let autoGenerating = false;
    let translationMode = 'off'; // 'off' | 'es' | 'en'
    let minimized = false;

    const SILENCE_MS = 3500;
    const TRIGGER_PHRASES = [
      'qué opinas', 'que opinas', 'qué piensas', 'que piensas', 'qué crees', 'que crees',
      'tu opinión', 'tu opinion', 'qué te parece', 'que te parece', 'te parece',
      'qué harías', 'qué propones', 'que propones', 'cómo lo ves', 'como lo ves',
      'tienes alguna pregunta', 'alguna pregunta', 'algún comentario', 'alguna duda',
      'cuéntame', 'cuentame', 'háblame', 'hablame', 'cuéntanos', 'cuentanos',
      'por qué quieres', 'cuál es tu', 'cuales son tus',
      'what do you think', 'what are your thoughts', 'your thoughts',
      'what would you do', 'how would you', 'tell me about',
      'do you have any questions', 'any questions', 'any comments',
      'what is your', "what's your", 'how do you see',
      'your opinion', 'your perspective', 'your experience',
      'can you tell', 'could you tell', 'would you say',
      'over to you', 'your turn', 'go ahead',
    ];

    // ── Init ─────────────────────────────────────────────────────────────
    function init() {
      const hasKey = !!config.openaiKey;
      $('no-key-screen').classList.toggle('visible', !hasKey);
      $('body').style.display = hasKey ? 'flex' : 'none';
      $('footer').style.display = hasKey ? '' : 'none';
      if (config.context) { context = config.context; updateContextBar(); }
      if (hasKey) checkForRecoverableMeeting();
    }
    init();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const patch = {};
      for (const key in changes) patch[key] = changes[key].newValue;
      config = { ...config, ...patch };
      init();
    });

    // ── Header ───────────────────────────────────────────────────────────
    $('btn-setup').addEventListener('click', () => safeSendMessage({ type: 'open-options' }));
    $('btn-settings').addEventListener('click', () => safeSendMessage({ type: 'open-options' }));
    $('btn-min').addEventListener('click', () => setMinimized(true));
    $('bubble').addEventListener('click', () => setMinimized(false));

    function setMinimized(v) {
      minimized = v;
      $('app').classList.toggle('hidden', v);
      $('bubble').classList.toggle('visible', v);
    }

    // ── Drag ─────────────────────────────────────────────────────────────
    // NOTE: must measure rootEl (the actual fixed-position panel inside the
    // shadow root), never `host` — host is a plain static <div> appended to
    // <body> with no size/position of its own, so its rect doesn't match
    // what's on screen and using it made the panel jump on every drag.
    (function enableDrag() {
      const header = $('header');
      let dragging = false, offX = 0, offY = 0;

      function onMouseMove(e) {
        if (!dragging) return;
        const maxLeft = Math.max(0, window.innerWidth - rootEl.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - rootEl.offsetHeight);
        rootEl.style.left = Math.min(Math.max(0, e.clientX - offX), maxLeft) + 'px';
        rootEl.style.top = Math.min(Math.max(0, e.clientY - offY), maxTop) + 'px';
      }
      function onMouseUp() {
        if (!dragging) return;
        dragging = false;
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
      header.addEventListener('mousedown', e => {
        if (e.target.closest('.hbtn')) return;
        const rect = rootEl.getBoundingClientRect();
        // Switch from the initial bottom/right anchoring to left/top at the
        // panel's current on-screen position, then track the cursor from there.
        rootEl.style.left = rect.left + 'px';
        rootEl.style.top = rect.top + 'px';
        rootEl.style.right = 'auto';
        rootEl.style.bottom = 'auto';
        offX = e.clientX - rect.left;
        offY = e.clientY - rect.top;
        dragging = true;
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
      });
    })();

    // ── Context modal ────────────────────────────────────────────────────
    $('context-bar').addEventListener('click', () => {
      $('ctx-topic').value = context.topic || '';
      $('ctx-profile').value = context.profile || '';
      $('ctx-notes').value = context.notes || '';
      $('ctx-modal').classList.add('open');
    });
    $('ctx-cancel').addEventListener('click', () => $('ctx-modal').classList.remove('open'));
    $('ctx-save').addEventListener('click', async () => {
      context = { topic: $('ctx-topic').value.trim(), profile: $('ctx-profile').value.trim(), notes: $('ctx-notes').value.trim() };
      await saveConfig({ context });
      updateContextBar();
      $('ctx-modal').classList.remove('open');
    });

    function updateContextBar() {
      const has = context.topic || context.profile || context.notes;
      $('context-bar').className = has ? 'has-context' : '';
      $('context-icon').textContent = has ? '✅' : '📋';
      const preview = [context.topic, context.profile ? 'Perfil: ' + context.profile : ''].filter(Boolean).join(' · ');
      $('context-text').textContent = has ? (preview.length > 85 ? preview.slice(0, 85) + '...' : preview) : 'Sin contexto — clic para agregar info sobre la reunión o tu perfil';
    }

    // ── Translation toggle ───────────────────────────────────────────────
    $('trans-off').addEventListener('click', () => setTranslationMode('off'));
    $('trans-to-es').addEventListener('click', () => setTranslationMode('es'));
    $('trans-to-en').addEventListener('click', () => setTranslationMode('en'));

    function setTranslationMode(mode) {
      translationMode = mode;
      ['trans-off', 'trans-to-es', 'trans-to-en'].forEach(id => {
        $(id).className = 'tgl-btn' + (
          (id === 'trans-off' && mode === 'off') ||
          (id === 'trans-to-es' && mode === 'es') ||
          (id === 'trans-to-en' && mode === 'en')
            ? ' active teal' : '');
      });
      $('translation-wrap').classList.toggle('visible', mode !== 'off');
      if (mode === 'off') $('translation-box').textContent = '';
    }

    // ── Auto/Manual mode ─────────────────────────────────────────────────
    $('btn-manual').addEventListener('click', () => setMode('manual'));
    $('btn-auto').addEventListener('click', () => setMode('auto'));

    function setMode(mode) {
      autoMode = mode === 'auto';
      $('btn-manual').className = 'tgl-btn' + (autoMode ? '' : ' active');
      $('btn-auto').className = 'tgl-btn' + (autoMode ? ' active green' : '');
      $('gen-btn').style.display = autoMode ? 'none' : 'flex';
      setAutoStatus(autoMode ? '⚡ Modo automático — escuchando...' : '', autoMode ? 'waiting' : '');
      if (!autoMode) clearSilenceTimer();
    }

    function setAutoStatus(msg, cls = '') {
      $('auto-status').textContent = msg;
      $('auto-status').className = cls;
    }

    function clearSilenceTimer() { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } }

    function resetSilenceTimer() {
      clearSilenceTimer();
      if (!autoMode || !isListening || autoGenerating) return;
      silenceTimer = setTimeout(async () => {
        if (!autoMode || !isListening || autoGenerating || currentTranscript.trim().length < 15) return;
        setAutoStatus('🔄 Generando comentario...', 'detected');
        await generateComment(true);
        setAutoStatus('⚡ Modo automático — escuchando...', 'waiting');
      }, SILENCE_MS);
    }

    function checkTriggerPhrases(text) {
      if (!autoMode || !isListening || autoGenerating) return;
      if (TRIGGER_PHRASES.some(p => text.toLowerCase().includes(p))) {
        clearSilenceTimer();
        setAutoStatus('💬 Te preguntaron algo — generando...', 'detected');
        setTimeout(async () => {
          if (!autoMode || autoGenerating) return;
          await generateComment(true);
          setAutoStatus('⚡ Modo automático — escuchando...', 'waiting');
        }, 800);
      }
    }

    // ── Length buttons ───────────────────────────────────────────────────
    const lengthMap = {
      short: { tokens: 120, instruction: 'ONE to TWO sentences. Be concise and punchy.' },
      medium: { tokens: 250, instruction: 'THREE to FOUR sentences. Balanced and clear.' },
      long: { tokens: 450, instruction: 'FIVE to SEVEN sentences. Develop the idea with depth.' },
      extended: { tokens: 700, instruction: 'A full paragraph of 8-12 sentences. Be thorough with reasoning and examples.' },
    };

    shadow.querySelectorAll('.len-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        shadow.querySelectorAll('.len-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedLength = btn.dataset.len;
      });
    });

    // ── Capture mode: captions (default, like Táctiq) vs tab audio ──────
    let captureMode = config.captureMode === 'audio' ? 'audio' : 'captions';

    function setCaptureMode(mode) {
      if (isListening) return; // don't swap sources mid-meeting
      captureMode = mode;
      saveConfig({ captureMode: mode });
      $('mode-captions').className = 'tgl-btn' + (mode === 'captions' ? ' active teal' : '');
      $('mode-audio').className = 'tgl-btn' + (mode === 'audio' ? ' active' : '');
      updateCaptureHint();
    }
    function updateCaptureHint() {
      if (isListening) return;
      const hint = $('capture-hint');
      hint.style.display = '';
      hint.textContent = captureMode === 'captions'
        ? 'En Google Meet activamos y ocultamos los subtítulos por ti al presionar Escuchar. En Zoom/Teams/Webex actívalos tú (botón "CC") antes de escuchar.'
        : 'Chrome te pedirá compartir esta pestaña — activa la casilla "Compartir audio de la pestaña".';
    }
    $('mode-captions').addEventListener('click', () => setCaptureMode('captions'));
    $('mode-audio').addEventListener('click', () => setCaptureMode('audio'));
    setCaptureMode(captureMode);

    // ── Captions engine ───────────────────────────────────────────────────
    // Reads the platform's own live-captions live region (an aria-live area
    // required for accessibility on Meet/Zoom/Teams/Webex) instead of
    // capturing audio — this is how Táctiq-style extensions work: no
    // share-tab prompt, no audio permission, and it's the platform's own
    // (usually very accurate) speech recognition doing the work.
    let captionsObserver = null;
    let captionsPollTimer = null;
    let captionsRegion = null;
    let captionSeen = new WeakMap();
    let candidateActivity = new WeakMap(); // el -> { lastText, changes } — see findCaptionsRegion()
    const CAPTION_STABLE_MS = 1100;

    // Picking "whichever aria-live region has the most text right now" picks
    // the WRONG element on Meet: one-off info toasts ("te uniste como...",
    // "se activaron los subtítulos") are also aria-live regions, and their
    // static boilerplate text is often longer than the couple of lines a live
    // caption strip shows at any instant — so that heuristic gets stuck on
    // the toast forever. Instead, score every candidate by how many times its
    // text has actually CHANGED since we started watching: real captions
    // update continuously while someone talks, a toast is set once and never
    // changes again. Only fall back to "most text" while nothing has changed
    // yet (e.g. right at the very start, before anyone has spoken).
    // Meet (and apparently others) exposes several unrelated aria-live
    // regions besides the actual captions: join/leave toasts, "se activaron
    // los subtítulos", and — confirmed by testing — chat message
    // announcements ("Fulano dice en el chat: <mensaje>"). These are
    // legitimate accessibility regions too, and they DO change over time
    // (new chat messages, repeated join/leave events), so the "most changed"
    // heuristic alone isn't enough to rule them out. Recognize and exclude
    // these known system-announcement patterns outright.
    const CAPTION_BLOCKLIST_PATTERNS = [
      /dice en el chat/i,
      /says? in the chat/i,
      /se activ(ó|aron) (el|los) subt[ií]tulo/i,
      /subtitles? (were|have been|turned) (on|off)/i,
      /las personas que usen este v[ií]nculo/i,
      /people who use this meeting link/i,
      /se uni[oó] a (la llamada|esta llamada|la reuni[oó]n)/i,
      /joined the (call|meeting)/i,
      /sali[oó] de la (llamada|reuni[oó]n)/i,
      /left the (call|meeting)/i,
      /https?:\/\//i, // toasts/chat links almost always contain a URL; spoken captions basically never do
    ];

    function looksLikeSystemMessage(text) {
      return CAPTION_BLOCKLIST_PATTERNS.some(re => re.test(text));
    }

    // Known, platform-specific selectors for the real captions container —
    // checked before falling back to the generic aria-live heuristic below.
    // For Google Meet this is confirmed straight from Meet's own DOM: `.a4cQT`
    // is the captions panel and `.iOzk7` the scrolling text region inside it
    // — confirmed because Tactiq's own injected stylesheet has a rule
    // `.tactiq-nocc .a4cQT { color: transparent !important }` to visually
    // hide Meet's native captions while its own overlay is showing, i.e. a
    // competing extension relies on this exact class staying stable.
    const MEET_CAPTIONS_CONTAINER_SELECTOR = '.a4cQT';
    const KNOWN_CAPTIONS_SELECTORS = [
      `${MEET_CAPTIONS_CONTAINER_SELECTOR} .iOzk7`,
      MEET_CAPTIONS_CONTAINER_SELECTOR,
    ];

    function findKnownCaptionsRegion() {
      for (const sel of KNOWN_CAPTIONS_SELECTORS) {
        const el = document.querySelector(sel);
        if (el && !host.contains(el) && el.getClientRects().length > 0) return el;
      }
      return null;
    }

    function findCaptionsRegion() {
      const known = findKnownCaptionsRegion();
      if (known) return known;

      const candidates = Array.from(document.querySelectorAll(
        '[aria-live="polite"], [aria-live="assertive"], [role="log"], [role="status"]'
      ))
        .filter(el => !host.contains(el))
        .filter(el => el.getClientRects().length > 0)
        .filter(el => !looksLikeSystemMessage(el.textContent || ''));
      if (!candidates.length) return null;

      const scored = candidates.map(el => {
        const text = (el.textContent || '').trim();
        let activity = candidateActivity.get(el);
        if (!activity) {
          activity = { lastText: text, changes: 0 };
          candidateActivity.set(el, activity);
        } else if (activity.lastText !== text) {
          activity.changes++;
          activity.lastText = text;
        }
        return { el, changes: activity.changes, length: text.length };
      });

      scored.sort((a, b) => (b.changes - a.changes) || (b.length - a.length));
      return scored[0].el;
    }

    // ── Auto-enable + hide + lock Meet's native captions ─────────────────
    // The captions engine needs Meet's own captions turned on to have
    // anything to read — but the user doesn't want to see that on-screen
    // caption box, and doesn't want to risk turning it off by accident
    // (same behavior Tactiq has). So: turn it on for them, hide it visually
    // with injected CSS (MutationObserver keeps working on hidden elements —
    // hiding is purely visual), and swallow clicks on the toggle button
    // while we're listening.
    let captionsHideStyleEl = null;
    const lockedCaptionButtons = new WeakSet();

    function findMeetCaptionsToggleButton() {
      const buttons = Array.from(document.querySelectorAll('button[aria-label], [role="button"][aria-label]'));
      return buttons.find(b => {
        if (host.contains(b)) return false;
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        return label.includes('subt') || label.includes('caption');
      }) || null;
    }

    function captionsAppearOn() {
      return !!document.querySelector(MEET_CAPTIONS_CONTAINER_SELECTOR);
    }

    let lastCaptionsClickAt = 0;
    function ensureMeetCaptionsOn() {
      if (captionsAppearOn()) return;
      // Rate-limit: if aria-pressed isn't reliable and .a4cQT just hasn't
      // rendered yet, retrying on every 2s recheck could double-click the
      // button and toggle captions back off. Give it a few seconds to catch up.
      if (Date.now() - lastCaptionsClickAt < 5000) return;
      const btn = findMeetCaptionsToggleButton();
      if (!btn || btn.getAttribute('aria-pressed') === 'true' || btn.disabled) return;
      lastCaptionsClickAt = Date.now();
      btn.click();
    }

    function hideVisibleCaptions(hide) {
      if (hide) {
        if (captionsHideStyleEl) return;
        captionsHideStyleEl = document.createElement('style');
        captionsHideStyleEl.textContent = `${MEET_CAPTIONS_CONTAINER_SELECTOR} { opacity: 0 !important; pointer-events: none !important; }`;
        document.head.appendChild(captionsHideStyleEl);
      } else if (captionsHideStyleEl) {
        captionsHideStyleEl.remove();
        captionsHideStyleEl = null;
      }
    }

    function blockCaptionToggleClick(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setStatus('Los subtítulos están bloqueados mientras Meet Assistant escucha — presiona "Detener" para soltarlos');
    }

    function lockCaptionsToggleButton(lock) {
      const btn = findMeetCaptionsToggleButton();
      if (!btn) return;
      if (lock) {
        if (lockedCaptionButtons.has(btn)) return;
        btn.addEventListener('click', blockCaptionToggleClick, true);
        lockedCaptionButtons.add(btn);
      } else if (lockedCaptionButtons.has(btn)) {
        btn.removeEventListener('click', blockCaptionToggleClick, true);
        lockedCaptionButtons.delete(btn);
      }
    }

    function commitCaptionNode(node) {
      if (!isListening || captureMode !== 'captions') return; // stopped/switched before this line stabilized
      const entry = captionSeen.get(node);
      if (!entry || entry.committed) return;
      entry.committed = true;
      const text = entry.text.trim();
      if (text && !looksLikeSystemMessage(text)) handleCapturedText(text);
    }

    function trackCaptionLeaf(node) {
      const text = node.textContent || '';
      if (!text.trim()) return;
      let entry = captionSeen.get(node);
      if (!entry) { entry = { text, committed: false, timer: null }; captionSeen.set(node, entry); }
      else if (entry.text !== text) { entry.text = text; entry.committed = false; }
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => commitCaptionNode(node), CAPTION_STABLE_MS);
    }

    function walkCaptionLeaves(node) {
      if (!node || node.nodeType !== 1) return;
      const children = Array.from(node.children || []);
      if (children.length === 0) trackCaptionLeaf(node);
      else children.forEach(walkCaptionLeaves);
    }

    function flushRemovedCaptionNodes(node) {
      if (!node || node.nodeType !== 1) return;
      if (captionSeen.has(node)) commitCaptionNode(node);
      (node.querySelectorAll ? Array.from(node.querySelectorAll('*')) : []).forEach(el => {
        if (captionSeen.has(el)) commitCaptionNode(el);
      });
    }

    function handleCapturedText(text) {
      appendTranscript(text);
      if (translationMode !== 'off') translateText(text);
    }

    function attachCaptionsObserver(region) {
      if (captionsObserver) captionsObserver.disconnect();
      captionsRegion = region;
      walkCaptionLeaves(region);
      captionsObserver = new MutationObserver(mutations => {
        walkCaptionLeaves(captionsRegion);
        mutations.forEach(m => m.removedNodes.forEach(flushRemovedCaptionNodes));
      });
      captionsObserver.observe(region, { childList: true, subtree: true, characterData: true });
    }

    function recheckCaptionsRegion() {
      if (!isListening || captureMode !== 'captions') return;
      ensureMeetCaptionsOn(); // self-heal if it somehow got toggled off (e.g. keyboard shortcut)
      lockCaptionsToggleButton(true); // re-attach in case Meet re-rendered the button
      const best = findCaptionsRegion();
      if (best && best !== captionsRegion) {
        console.debug('[Meet Assistant] switching captions region ->', best, JSON.stringify((best.textContent || '').trim().slice(0, 120)));
        attachCaptionsObserver(best);
      }
      captionsPollTimer = setTimeout(recheckCaptionsRegion, 2000);
    }

    function startCaptionsWatch() {
      ensureMeetCaptionsOn();
      // Prime the activity scores for a moment before committing to a region —
      // gives an already-updating real captions region a chance to reveal
      // itself instead of locking onto whatever merely has the most static
      // text right this instant (see findCaptionsRegion for why that matters).
      findCaptionsRegion();
      captionsPollTimer = setTimeout(() => {
        if (!isListening || captureMode !== 'captions') return;
        const region = findCaptionsRegion();
        if (!region) {
          $('capture-hint').style.display = '';
          $('capture-hint').textContent = 'No detecto subtítulos activos todavía. Actívalos en la reunión — Meet: ícono "CC" · Zoom: "Mostrar subtítulos" · Teams: menú "…" → Subtítulos en vivo — esto se conecta solo en cuanto aparezcan.';
          setStatus('Buscando subtítulos activados...');
          captionsPollTimer = setTimeout(() => { if (isListening) startCaptionsWatch(); }, 2000);
          return;
        }
        console.debug('[Meet Assistant] captions region ->', region, JSON.stringify((region.textContent || '').trim().slice(0, 120)));
        attachCaptionsObserver(region);
        hideVisibleCaptions(true);
        lockCaptionsToggleButton(true);
        $('capture-hint').style.display = 'none';
        setStatus('Escuchando los subtítulos de la reunión...');
        captionsPollTimer = setTimeout(recheckCaptionsRegion, 2000);
      }, 1500);
    }

    function stopCaptionsWatch() {
      if (captionsObserver) { captionsObserver.disconnect(); captionsObserver = null; }
      candidateActivity = new WeakMap();
      captionSeen = new WeakMap();
      if (captionsPollTimer) { clearTimeout(captionsPollTimer); captionsPollTimer = null; }
      captionsRegion = null;
      hideVisibleCaptions(false);
      lockCaptionsToggleButton(false);
    }

    // ── Listen button ────────────────────────────────────────────────────
    $('listen-btn').addEventListener('click', () => { if (isListening) stopListening(); else startListening(); });

    async function startListening() {
      if (captureMode === 'captions') {
        isListening = true;
        if (!meetingStartTime) { meetingStartTime = new Date(); meetingLog = []; logEvent('system', '▶ Reunión iniciada'); }
        $('listen-btn').className = 'active';
        $('listen-btn').textContent = '⏹ Detener';
        $('status-dot').className = 'status-dot listening';
        $('bubble-dot').className = 'dot listening';
        $('transcript-box').innerHTML = '';
        startCaptionsWatch();
        return;
      }

      // ── Fallback: tab audio via getDisplayMedia + Whisper ─────────────
      try {
        setStatus('Solicitando compartir la pestaña...');
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
        });

        stream.getVideoTracks().forEach(t => t.stop());
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
          stream.getTracks().forEach(t => t.stop());
          setStatus('No se compartió audio — vuelve a intentar y activa "Compartir audio de la pestaña"', true);
          return;
        }

        captureStream = new MediaStream(audioTracks);
        audioTracks[0].addEventListener('ended', () => { if (isListening) stopListening(); });

        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
        mediaRecorder = new MediaRecorder(captureStream, mimeType ? { mimeType } : {});
        audioChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = async () => {
          if (!isListening) return;
          const chunks = [...audioChunks]; audioChunks = [];
          if (chunks.length) await processChunk(new Blob(chunks, { type: mimeType || 'audio/webm' }), mimeType);
          if (isListening && mediaRecorder) scheduleChunk();
        };
        isListening = true;
        if (!meetingStartTime) { meetingStartTime = new Date(); meetingLog = []; logEvent('system', '▶ Reunión iniciada'); }
        $('listen-btn').className = 'active';
        $('listen-btn').textContent = '⏹ Detener';
        $('status-dot').className = 'status-dot listening';
        $('bubble-dot').className = 'dot listening';
        $('transcript-box').innerHTML = '';
        $('capture-hint').style.display = 'none';
        setStatus('Escuchando el audio de la reunión...');
        scheduleChunk();
      } catch (err) {
        if (err.name === 'NotAllowedError') setStatus('Compartir cancelado — vuelve a presionar "Escuchar" y elige esta pestaña', true);
        else setStatus('Error: ' + err.message, true);
      }
    }

    function scheduleChunk() {
      try { mediaRecorder.start(); setTimeout(() => { if (mediaRecorder?.state === 'recording') mediaRecorder.stop(); }, 7000); } catch (e) {}
    }

    function stopListening() {
      isListening = false;
      stopCaptionsWatch();
      try { if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop(); } catch (e) {}
      mediaRecorder = null; audioChunks = [];
      if (captureStream) { captureStream.getTracks().forEach(t => t.stop()); captureStream = null; }
      $('listen-btn').className = 'idle';
      $('listen-btn').textContent = '🎙 Escuchar reunión';
      $('status-dot').className = 'status-dot';
      $('bubble-dot').className = 'dot';
      logEvent('system', '⏸ Pausa');
      setStatus('Listo');
      updateCaptureHint();
    }

    // ── Whisper ──────────────────────────────────────────────────────────
    async function processChunk(blob, mimeType) {
      try {
        const ext = mimeType?.includes('ogg') ? 'ogg' : 'webm';
        const fd = new FormData();
        fd.append('file', blob, `audio.${ext}`);
        fd.append('model', 'whisper-1');
        fd.append('response_format', 'verbose_json');

        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST', headers: { Authorization: `Bearer ${config.openaiKey}` }, body: fd,
        });
        if (!res.ok) { setStatus('Whisper error: ' + (await res.text()).slice(0, 80), true); return; }

        const data = await res.json();
        const text = data.text?.trim();
        const lang = data.language;

        if (lang) {
          detectedLang = lang;
          $('lang-badge').textContent = lang === 'english' ? '🇺🇸 EN' : lang === 'spanish' ? '🇪🇸 ES' : lang;
        }

        if (text && text.length > 1) {
          appendTranscript(text);
          if (translationMode !== 'off') translateText(text);
        }
      } catch (e) { console.error('[Meet Assistant]', e); }
    }

    function appendTranscript(text) {
      currentTranscript += (currentTranscript ? ' ' : '') + text;
      const display = currentTranscript.length > 500 ? '...' + currentTranscript.slice(-500) : currentTranscript;
      $('transcript-box').textContent = display;
      $('transcript-box').scrollTop = $('transcript-box').scrollHeight;
      $('gen-btn').disabled = autoMode || currentTranscript.trim().length < 10;
      logEvent('transcript', text);
      updateSummaryBtn();
      if (autoMode) { checkTriggerPhrases(text); resetSilenceTimer(); }
    }

    // ── Live translation ─────────────────────────────────────────────────
    async function translateText(text) {
      if (translationMode === 'off' || !config.openaiKey) return;
      const targetLang = translationMode === 'es' ? 'Spanish' : 'English';
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 300,
            messages: [
              { role: 'system', content: `Translate the following text to ${targetLang}. Return ONLY the translation, no explanations.` },
              { role: 'user', content: text },
            ],
          }),
        });
        const data = await res.json();
        const translated = data.choices?.[0]?.message?.content?.trim();
        if (translated) {
          const box = $('translation-box');
          box.textContent = (box.textContent ? box.textContent + '\n' : '') + translated;
          box.scrollTop = box.scrollHeight;
        }
      } catch (e) { console.error('[Meet Assistant] Translation error:', e); }
    }

    // ── Meeting log ──────────────────────────────────────────────────────
    function logEvent(type, text) {
      const time = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      meetingLog.push({ time, type, text });
      updateSummaryBtn();
      cacheMeetingToStorage();
    }

    // Keeps a copy in chrome.storage.local as the meeting goes — cheap and
    // invisible (no download, no interruption). This is only a recovery net
    // for a crashed/force-closed tab; it is NOT what saves the final file —
    // that only happens via the Guardar/Resumen buttons, ending the meeting,
    // or closing the tab (see saveMeetingToFile).
    function cacheMeetingToStorage() {
      if (!meetingStartTime) return;
      chrome.storage.local.set({
        pendingMeeting: {
          startedAt: meetingStartTime.getTime(),
          context,
          detectedLang,
          log: meetingLog,
          updatedAt: Date.now(),
        },
      });
    }

    function clearMeetingCache() {
      chrome.storage.local.remove('pendingMeeting');
    }

    // ── Recovery banner (leftover cache from a crash/force-closed tab) ────
    let recoveredMeetingCache = null;

    async function checkForRecoverableMeeting() {
      const { pendingMeeting } = await new Promise(resolve => chrome.storage.local.get('pendingMeeting', resolve));
      if (!pendingMeeting?.log?.some(e => e.type === 'transcript')) return;
      if (meetingStartTime && pendingMeeting.startedAt === meetingStartTime.getTime()) return; // that's this session
      recoveredMeetingCache = pendingMeeting;
      $('recovery-banner').classList.add('visible');
    }

    $('recovery-download').addEventListener('click', async () => {
      const cached = recoveredMeetingCache;
      recoveredMeetingCache = null;
      $('recovery-banner').classList.remove('visible');
      if (cached) await downloadCachedMeeting(cached);
    });
    $('recovery-dismiss').addEventListener('click', () => {
      recoveredMeetingCache = null;
      clearMeetingCache();
      $('recovery-banner').classList.remove('visible');
    });

    async function downloadCachedMeeting(cached) {
      const now = new Date(cached.startedAt || Date.now());
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toTimeString().slice(0, 5).replace(':', '-');
      const topic = cached.context?.topic ? ' - ' + cached.context.topic.slice(0, 40).replace(/[/\\:*?"<>|]/g, '') : '';
      const filename = `${dateStr} ${timeStr}${topic} (recuperado).txt`;
      const log = cached.log || [];
      const txLines = log.filter(e => e.type === 'transcript').map(e => `[${e.time}] ${e.text}`).join('\n');
      const cmLines = log.filter(e => e.type === 'comment').map((e, i) => `[${e.time}] Comentario ${i + 1}: ${e.text}`).join('\n');

      let fc = '═══════════════════════════════════════════════════\n  MEET ASSISTANT — REUNIÓN RECUPERADA\n═══════════════════════════════════════════════════\n\n';
      fc += `Fecha:      ${now.toLocaleDateString('es', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
      if (cached.context?.topic) fc += `Tema:       ${cached.context.topic}\n`;
      if (cached.context?.profile) fc += `Mi rol:     ${cached.context.profile}\n`;
      if (cached.detectedLang) fc += `Idioma:     ${cached.detectedLang}\n`;
      fc += '\n';
      if (cmLines) fc += '───────────────────────────────────────────────────\n  MIS COMENTARIOS\n───────────────────────────────────────────────────\n' + cmLines + '\n\n';
      if (txLines) fc += '───────────────────────────────────────────────────\n  TRANSCRIPCIÓN COMPLETA\n───────────────────────────────────────────────────\n' + txLines + '\n';

      await safeSendMessage({ type: 'save-meeting', filename, content: fc });
      clearMeetingCache();
    }

    function getFullTranscript() {
      return meetingLog.filter(e => e.type === 'transcript').map(e => `[${e.time}] ${e.text}`).join('\n');
    }

    function updateSummaryBtn() {
      const has = meetingLog.filter(e => e.type === 'transcript').length > 0;
      $('btn-summary').disabled = !has;
      $('btn-summary').style.opacity = has ? '1' : '0.4';
      $('btn-save').disabled = !has;
      $('btn-save').style.opacity = has ? '1' : '0.4';
    }

    // ── Generate comment ─────────────────────────────────────────────────
    const toneMap = {
      colaborativo: 'in a collaborative tone, showing you listened and contributing positively',
      analitico: 'in an analytical tone, with structured reasoning or data-driven points',
      propositivo: 'proposing a concrete action or clear next step',
      pregunta: 'asking one key, intelligent question that opens the discussion',
      resumen: 'summarizing the main points discussed clearly and concisely',
      acuerdo: 'showing agreement and expanding the idea with added value',
      tecnico: 'with technical depth, focusing on implementation or methodology',
    };

    async function generateComment(autoTriggered = false) {
      const text = currentTranscript.trim();
      if (text.length < 10 || !config.openaiKey) return;

      autoGenerating = true;
      $('gen-btn').disabled = true;
      $('gen-btn').textContent = '⏳ Generando...';
      setStatus('Generando con GPT-4o...');

      const tone = $('tone-sel').value;
      const lenCfg = lengthMap[selectedLength] || lengthMap.medium;

      const langSel = $('comment-lang-sel').value;
      const lang = (autoTriggered && langSel === 'auto')
        ? (detectedLang === 'english' ? 'English' : detectedLang === 'spanish' ? 'Spanish' : 'the same language as the meeting')
        : langSel === 'es' ? 'Spanish'
        : langSel === 'en' ? 'English'
        : detectedLang === 'english' ? 'English'
        : detectedLang === 'spanish' ? 'Spanish'
        : 'the same language as the meeting';

      let ctxBlock = '';
      if (context.topic) ctxBlock += `\nMeeting topic: ${context.topic}`;
      if (context.profile) ctxBlock += `\nSpeaker role: ${context.profile}`;
      if (context.notes) ctxBlock += `\nNotes: ${context.notes}`;
      if (config.defaultProfile) ctxBlock += `\nProfile: ${config.defaultProfile}`;
      if (config.defaultInstructions) ctxBlock += `\nInstructions: ${config.defaultInstructions}`;

      const systemPrompt = `You are an expert professional communication assistant for work meetings.
Generate a comment ${toneMap[tone]}.
LENGTH: ${lenCfg.instruction}
The comment must sound natural and intelligent, as if spoken by a participant who has been in the meeting from the start.
Respond to the LATEST topic/question but reflect awareness of everything discussed.
NO introductory phrases. Respond DIRECTLY, ready to read aloud.
Respond in ${lang}.${ctxBlock}`;

      const fullHistory = getFullTranscript();
      const messages = [{ role: 'system', content: systemPrompt }];
      if (fullHistory.trim()) {
        messages.push({ role: 'user', content: `FULL MEETING CONTEXT:\n${fullHistory.slice(-8000)}` });
        messages.push({ role: 'assistant', content: 'Got full context. Ready to comment on the latest.' });
      }

      const myIdea = $('my-idea-input')?.value.trim();
      let userMsg = `LATEST / RESPOND TO THIS:\n${text}`;
      if (myIdea) userMsg += `\n\nMY IDEA TO EXPAND (polish and complete this naturally):\n"${myIdea}"`;
      messages.push({ role: 'user', content: userMsg });

      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
          body: JSON.stringify({ model: config.model || 'gpt-4o', max_tokens: lenCfg.tokens, temperature: 0.75, messages }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        lastComment = data.choices?.[0]?.message?.content?.trim() || '';
        appendCommentToFeed(lastComment, autoTriggered);
        logEvent('comment', lastComment);
        setStatus('Listo ✓');

        currentTranscript = '';
        $('transcript-box').innerHTML = '<span class="placeholder-txt">Listo para el siguiente turno...</span>';
        if ($('my-idea-input')) $('my-idea-input').value = '';
        $('gen-btn').disabled = true;
      } catch (err) {
        setStatus('Error: ' + err.message, true);
      }

      autoGenerating = false;
      $('gen-btn').textContent = '✨ Generar comentario';
      $('gen-btn').disabled = autoMode || currentTranscript.trim().length < 10;
    }

    $('gen-btn').addEventListener('click', () => generateComment());
    $('btn-regen').addEventListener('click', () => generateComment());
    $('btn-clear-feed').addEventListener('click', () => {
      if (!confirm('¿Borrar todos los comentarios?')) return;
      $('comment-feed').innerHTML = '';
      $('comment-actions').style.display = 'none';
      currentTranscript = '';
      lastComment = '';
      $('transcript-box').innerHTML = '<span class="placeholder-txt">Presiona "Escuchar" para empezar a transcribir...</span>';
      $('translation-box').textContent = '';
      $('gen-btn').disabled = true;
      $('lang-badge').textContent = '—';
      detectedLang = null;
      setStatus('Listo');
    });

    // ── Save / Summary ─────────────────────────────────────────────────────
    $('btn-save').addEventListener('click', async () => {
      const btn = $('btn-save');
      btn.disabled = true; btn.textContent = '⏳ Guardando...';
      const res = await saveMeetingToFile('manual');
      btn.textContent = '💾 Guardar';
      updateSummaryBtn();
      setStatus(res?.ok ? '✓ Reunión guardada en Descargas/Meet Assistant/' : 'Error al guardar', !res?.ok);
    });

    $('btn-summary').addEventListener('click', openSummaryModal);
    $('summary-close').addEventListener('click', () => $('summary-modal').classList.remove('open'));
    $('btn-open-folder').addEventListener('click', () => safeSendMessage({ type: 'open-meetings-folder' }));
    $('summary-copy').addEventListener('click', () => {
      navigator.clipboard.writeText($('summary-content').innerText).then(() => {
        $('summary-copy').textContent = '✓ Copiado';
        setTimeout(() => { $('summary-copy').textContent = '📋 Copiar'; }, 2000);
      });
    });
    $('summary-new').addEventListener('click', async () => {
      if (!confirm('¿Iniciar nueva reunión? Se guardará la actual antes de borrarla.')) return;
      if (meetingLog.some(e => e.type === 'transcript')) await saveMeetingToFile('nueva-reunion');
      meetingLog = []; currentTranscript = ''; meetingStartTime = null; meetingFileName = null; lastComment = '';
      $('transcript-box').innerHTML = '<span class="placeholder-txt">Presiona "Escuchar" para empezar a transcribir...</span>';
      $('translation-box').textContent = '';
      $('comment-feed').innerHTML = '';
      $('comment-actions').style.display = 'none';
      $('gen-btn').disabled = true; $('lang-badge').textContent = '—'; detectedLang = null;
      $('summary-modal').classList.remove('open');
      setStatus('Nueva reunión lista');
      updateSummaryBtn();
    });

    async function openSummaryModal() {
      $('summary-modal').classList.add('open');
      $('sum-saved-msg').style.display = 'none';
      $('btn-open-folder').style.display = 'none';
      $('summary-generate').style.display = 'flex';
      $('summary-generate').disabled = false;
      $('summary-generate').textContent = '✨ Generar resumen';
      const lines = meetingLog.filter(e => e.type === 'transcript');
      const duration = meetingStartTime ? Math.round((new Date() - meetingStartTime) / 60000) + ' min' : '—';
      $('summary-content').innerHTML = `
        <div class="sum-meta">
          <span>📅 ${meetingStartTime ? meetingStartTime.toLocaleDateString('es') : '—'}</span>
          <span>⏱ ${duration}</span>
          <span>💬 ${lines.length} fragmentos</span>
          ${context.topic ? `<span>📌 ${escapeHtml(context.topic)}</span>` : ''}
        </div>
        <div class="sum-placeholder">Presiona "Generar resumen" para analizar con GPT-4o</div>`;
    }

    $('summary-generate').addEventListener('click', generateSummary);

    async function generateSummary() {
      const fullTx = getFullTranscript();
      if (!fullTx || fullTx.length < 20) return;
      const btn = $('summary-generate');
      btn.disabled = true; btn.textContent = '⏳ Analizando...';

      const lang = $('comment-lang-sel').value === 'en' ? 'English' : 'Spanish';
      const duration = meetingStartTime ? Math.round((new Date() - meetingStartTime) / 60000) + ' minutos' : '—';
      let ctxBlock = '';
      if (context.topic) ctxBlock += `\nTema: ${context.topic}`;
      if (context.profile) ctxBlock += `\nRol: ${context.profile}`;

      const systemPrompt = `You are an expert meeting analyst. Generate a comprehensive meeting summary in ${lang}.
Duration: ${duration}.${ctxBlock}

Use this exact format:

## 📋 Resumen ejecutivo
[2-3 sentences]

## 🎯 Temas principales discutidos
[Bullet list]

## ✅ Decisiones tomadas
[Bullet list or "Ninguna"]

## 📌 Action items / Próximos pasos
[Bullet list with who/what/when]

## 💡 Puntos clave / Insights
[Bullet list]

## ❓ Temas pendientes
[Bullet list or "Ninguno"]`;

      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
          body: JSON.stringify({
            model: config.model || 'gpt-4o', max_tokens: 1500, temperature: 0.4,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Transcript:\n\n${fullTx.slice(-12000)}` }],
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        const summary = data.choices?.[0]?.message?.content?.trim() || '';
        logEvent('summary', summary);
        renderSummary(summary, duration);
        btn.style.display = 'none';

        const saved = await saveMeetingToFile('summary', summary);
        if (saved.ok) {
          $('sum-saved-msg').textContent = '✓ Guardado en Descargas/Meet Assistant/';
          $('sum-saved-msg').style.display = 'block';
          $('btn-open-folder').style.display = 'flex';
        }
      } catch (err) {
        $('summary-content').innerHTML += `<p style="color:#f87171;font-size:12px;margin-top:8px">Error: ${escapeHtml(err.message)}</p>`;
        btn.disabled = false; btn.textContent = '↺ Reintentar';
      }
    }

    function renderSummary(md, duration) {
      const date = meetingStartTime ? meetingStartTime.toLocaleDateString('es', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
      const html = md
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
        .replace(/<\/ul>\s*<ul>/g, '')
        .replace(/\n/g, '');
      $('summary-content').innerHTML = `
        <div class="sum-meta">
          <span>📅 ${date}</span><span>⏱ ${duration}</span>
          <span>💬 ${meetingLog.filter(e => e.type === 'transcript').length} fragmentos</span>
          ${context.topic ? `<span>📌 ${escapeHtml(context.topic)}</span>` : ''}
        </div>
        <div class="sum-body">${html}</div>`;
    }

    function escapeHtml(s) { return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    // ── Save to file ─────────────────────────────────────────────────────
    // Only ever called from: the "💾 Guardar" button, generating a summary,
    // starting a new meeting (saves the old one first), or closing the tab —
    // never on a timer. `meetingFileName` is computed once per meeting and
    // reused, so saving more than once during the same meeting overwrites
    // the same file instead of piling up duplicates (background.js uses
    // conflictAction: 'overwrite').
    function getMeetingFileName() {
      if (meetingFileName) return meetingFileName;
      const now = meetingStartTime || new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toTimeString().slice(0, 5).replace(':', '-');
      const topic = context.topic ? ' - ' + context.topic.slice(0, 40).replace(/[/\\:*?"<>|]/g, '') : '';
      meetingFileName = `${dateStr} ${timeStr}${topic}.txt`;
      return meetingFileName;
    }

    async function saveMeetingToFile(reason, summaryText = '') {
      if (!meetingLog.some(e => e.type === 'transcript')) return { ok: false };

      const now = meetingStartTime || new Date();
      const filename = getMeetingFileName();
      const duration = meetingStartTime ? Math.round((new Date() - meetingStartTime) / 60000) + ' minutos' : '—';
      const reasonLabel = {
        manual: 'Guardado manual',
        summary: 'Resumen generado',
        'nueva-reunion': 'Nueva reunión iniciada',
        cierre: 'Cierre de la pestaña',
      }[reason] || reason;

      const txLines = meetingLog.filter(e => e.type === 'transcript').map(e => `[${e.time}] ${e.text}`).join('\n');
      const cmLines = meetingLog.filter(e => e.type === 'comment').map((e, i) => `[${e.time}] Comentario ${i + 1}: ${e.text}`).join('\n');

      let fc = '═══════════════════════════════════════════════════\n';
      fc += '  MEET ASSISTANT — REGISTRO DE REUNIÓN\n';
      fc += '═══════════════════════════════════════════════════\n\n';
      fc += `Fecha:      ${now.toLocaleDateString('es', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
      fc += `Hora:       ${now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}\n`;
      fc += `Duración:   ${duration}\n`;
      fc += `Guardado:   ${reasonLabel}\n`;
      if (context.topic) fc += `Tema:       ${context.topic}\n`;
      if (context.profile) fc += `Mi rol:     ${context.profile}\n`;
      if (detectedLang) fc += `Idioma:     ${detectedLang}\n`;
      fc += '\n';
      if (summaryText) {
        fc += '───────────────────────────────────────────────────\n  RESUMEN EJECUTIVO\n───────────────────────────────────────────────────\n';
        fc += summaryText.replace(/^## /gm, '').replace(/^### /gm, '').replace(/\*\*/g, '').replace(/^- /gm, '  • ') + '\n\n';
      }
      if (cmLines) {
        fc += '───────────────────────────────────────────────────\n  MIS COMENTARIOS\n───────────────────────────────────────────────────\n';
        fc += cmLines + '\n\n';
      }
      if (txLines) {
        fc += '───────────────────────────────────────────────────\n  TRANSCRIPCIÓN COMPLETA\n───────────────────────────────────────────────────\n';
        fc += txLines + '\n';
      }
      fc += `\n═══════════════════════════════════════════════════\n  Guardado el ${new Date().toLocaleString('es')}\n═══════════════════════════════════════════════════\n`;

      const res = await safeSendMessage({ type: 'save-meeting', filename, content: fc });
      clearMeetingCache();
      return res || { ok: false };
    }

    // chrome.runtime.sendMessage throws "Extension context invalidated" if the
    // extension was reloaded (e.g. from chrome://extensions) while this tab's
    // content script is still the old instance — normal during development,
    // fixed by refreshing the meeting tab. Never let that crash a save/action.
    function safeSendMessage(msg) {
      return new Promise(resolve => {
        try {
          chrome.runtime.sendMessage(msg, res => resolve(res));
        } catch (e) {
          console.warn('[Meet Assistant] No se pudo comunicar con la extensión — refresca la pestaña.', e);
          resolve(null);
        }
      });
    }

    window.addEventListener('beforeunload', () => {
      if (meetingLog.some(e => e.type === 'transcript')) saveMeetingToFile('cierre');
    });

    // ── Comment feed ─────────────────────────────────────────────────────
    function appendCommentToFeed(text, isAuto = false) {
      const feed = $('comment-feed');
      const actions = $('comment-actions');

      const time = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      const entry = document.createElement('div');
      entry.className = 'comment-entry' + (isAuto ? ' auto' : '');

      const tsLabel = isAuto ? '⚡ Auto · ' + time : '✋ Manual · ' + time;
      entry.innerHTML = `
        <div class="comment-ts ${isAuto ? 'auto' : ''}">${tsLabel}</div>
        <div class="comment-text">${escapeHtml(text)}</div>
        <button class="comment-copy-btn">📋 Copiar</button>
      `;

      entry.querySelector('.comment-copy-btn').addEventListener('click', function () {
        navigator.clipboard.writeText(text).then(() => {
          this.textContent = '✓ Copiado';
          setTimeout(() => { this.textContent = '📋 Copiar'; }, 1600);
        });
      });

      feed.appendChild(entry);
      const body = $('body');
      const isAtBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
      if (isAtBottom) setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50);

      actions.style.display = 'flex';
    }

    // ── Keyboard shortcuts ───────────────────────────────────────────────
    document.addEventListener('keydown', e => {
      if (minimized) return;
      if (e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); if (isListening) stopListening(); else startListening(); }
      if (e.altKey && e.key.toLowerCase() === 'g') { e.preventDefault(); if (!$('gen-btn').disabled) generateComment(); }
      if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (!$('btn-summary').disabled) openSummaryModal(); }
      if (e.key === 'Escape') {
        $('ctx-modal').classList.remove('open');
        $('summary-modal').classList.remove('open');
      }
    });

    function setStatus(msg, isError = false) {
      $('status-text').textContent = msg;
      $('footer').className = isError ? 'error' : '';
      if (!isError && isListening) $('status-dot').className = 'status-dot listening';
      else if (!isError) $('status-dot').className = 'status-dot';
    }
  })();
})();
