// Meet Assistant Desktop — Renderer
// Whisper transcription + live translation + GPT-4o comments

(async function () {
  const api = window.electronAPI;

  // ── State ─────────────────────────────────────────────────────────────────
  let config = await api.loadConfig();
  let isListening = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let currentTranscript = '';
  let meetingLog = [];
  let lastComment = '';
  let detectedLang = null;
  let pinned = true;
  let context = { topic: '', profile: '', notes: '' };
  let meetingStartTime = null;
  let selectedLength = 'medium';
  let autoMode = false;
  let silenceTimer = null;
  let autoGenerating = false;
  let translationMode = 'off'; // 'off' | 'es' | 'en'

  const SILENCE_MS = 3500;
  const TRIGGER_PHRASES = [
    'qué opinas','que opinas','qué piensas','que piensas','qué crees','que crees',
    'tu opinión','tu opinion','qué te parece','que te parece','te parece',
    'qué harías','qué propones','que propones','cómo lo ves','como lo ves',
    'tienes alguna pregunta','alguna pregunta','algún comentario','alguna duda',
    'cuéntame','cuentame','háblame','hablame','cuéntanos','cuentanos',
    'por qué quieres','cuál es tu','cuales son tus',
    'what do you think','what are your thoughts','your thoughts',
    'what would you do','how would you','tell me about',
    'do you have any questions','any questions','any comments',
    'what is your',"what's your",'how do you see',
    'your opinion','your perspective','your experience',
    'can you tell','could you tell','would you say',
    'over to you','your turn','go ahead',
  ];

  const $ = id => document.getElementById(id);

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    const hasKey = !!config.openaiKey;
    $('no-key-screen').classList.toggle('visible', !hasKey);
    $('body').style.display = hasKey ? 'flex' : 'none';
    if (config.context) { context = config.context; updateContextBar(); }
    updateSummaryBtn();
  }
  init();
  api.onConfigUpdated(data => { config = { ...config, ...data }; init(); });

  // ── Header ─────────────────────────────────────────────────────────────────
  $('btn-setup').addEventListener('click', () => api.openSettings());
  $('btn-settings').addEventListener('click', () => api.openSettings());
  $('btn-min').addEventListener('click', () => api.minimizeApp());
  $('btn-quit').addEventListener('click', () => api.quitApp());
  $('btn-pin').addEventListener('click', () => {
    pinned = !pinned;
    api.setAlwaysOnTop(pinned);
    $('btn-pin').style.opacity = pinned ? '1' : '0.4';
  });

  // ── Context modal ──────────────────────────────────────────────────────────
  $('context-bar').addEventListener('click', () => {
    $('ctx-topic').value   = context.topic || '';
    $('ctx-profile').value = context.profile || '';
    $('ctx-notes').value   = context.notes || '';
    $('ctx-modal').style.display = 'flex';
  });
  $('ctx-cancel').addEventListener('click', () => { $('ctx-modal').style.display = 'none'; });
  $('ctx-save').addEventListener('click', async () => {
    context = { topic: $('ctx-topic').value.trim(), profile: $('ctx-profile').value.trim(), notes: $('ctx-notes').value.trim() };
    await api.saveConfig({ context });
    updateContextBar();
    $('ctx-modal').style.display = 'none';
  });

  function updateContextBar() {
    const has = context.topic || context.profile || context.notes;
    $('context-bar').className = has ? 'has-context' : '';
    $('context-icon').textContent = has ? '✅' : '📋';
    const preview = [context.topic, context.profile ? 'Perfil: ' + context.profile : ''].filter(Boolean).join(' · ');
    $('context-text').textContent = has ? (preview.length > 85 ? preview.slice(0, 85) + '...' : preview) : 'Sin contexto — clic para agregar info sobre la reunión o tu perfil';
  }

  // ── Translation toggle ─────────────────────────────────────────────────────
  $('trans-off').addEventListener('click', () => setTranslationMode('off'));
  $('trans-to-es').addEventListener('click', () => setTranslationMode('es'));
  $('trans-to-en').addEventListener('click', () => setTranslationMode('en'));

  function setTranslationMode(mode) {
    translationMode = mode;
    ['trans-off','trans-to-es','trans-to-en'].forEach(id => {
      $( id).className = 'tgl-btn' + (
        (id === 'trans-off' && mode === 'off') ||
        (id === 'trans-to-es' && mode === 'es') ||
        (id === 'trans-to-en' && mode === 'en')
        ? ' active teal' : '');
    });
    $('translation-wrap').classList.toggle('visible', mode !== 'off');
    if (mode === 'off') $('translation-box').textContent = '';
  }

  // ── Auto/Manual mode ───────────────────────────────────────────────────────
  $('btn-manual').addEventListener('click', () => setMode('manual'));
  $('btn-auto').addEventListener('click',   () => setMode('auto'));

  function setMode(mode) {
    autoMode = mode === 'auto';
    $('btn-manual').className = 'tgl-btn' + (autoMode ? '' : ' active');
    $('btn-auto').className   = 'tgl-btn' + (autoMode ? ' active green' : '');
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

  // ── Length buttons ─────────────────────────────────────────────────────────
  const lengthMap = {
    short:    { tokens: 120, instruction: 'ONE to TWO sentences. Be concise and punchy.' },
    medium:   { tokens: 250, instruction: 'THREE to FOUR sentences. Balanced and clear.' },
    long:     { tokens: 450, instruction: 'FIVE to SEVEN sentences. Develop the idea with depth.' },
    extended: { tokens: 700, instruction: 'A full paragraph of 8-12 sentences. Be thorough with reasoning and examples.' },
  };

  document.querySelectorAll('.len-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.len-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedLength = btn.dataset.len;
    });
  });

  // ── Audio capture ──────────────────────────────────────────────────────────
  $('listen-btn').addEventListener('click', () => { if (isListening) stopListening(); else startListening(); });

  async function startListening() {
    try {
      setStatus('Solicitando micrófono...');
      const audioConstraints = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 16000 }
        : { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 16000 };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        if (!isListening) return;
        const chunks = [...audioChunks]; audioChunks = [];
        if (chunks.length) await processChunk(new Blob(chunks, { type: mimeType || 'audio/webm' }), mimeType);
        if (isListening && mediaRecorder) scheduleChunk();
      };
      isListening = true;
      if (!meetingStartTime) { meetingStartTime = new Date(); meetingLog = []; logEvent('system','▶ Reunión iniciada'); }
      $('listen-btn').className = 'active';
      $('listen-btn').textContent = '⏹ Detener';
      $('status-dot').className = 'status-dot listening';
      $('transcript-box').innerHTML = '';
      setStatus('Escuchando todos los participantes...');
      scheduleChunk();
    } catch (err) {
      setStatus(err.name === 'NotAllowedError' ? 'Permiso denegado — ve a Configuración del sistema > Privacidad > Micrófono' : 'Error: ' + err.message, true);
    }
  }

  function scheduleChunk() {
    try { mediaRecorder.start(); setTimeout(() => { if (mediaRecorder?.state === 'recording') mediaRecorder.stop(); }, 7000); } catch(e) {}
  }

  function stopListening() {
    isListening = false;
    try { if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop(); } catch(e) {}
    mediaRecorder = null; audioChunks = [];
    $('listen-btn').className = 'idle';
    $('listen-btn').textContent = '🎙 Escuchar reunión';
    $('status-dot').className = 'status-dot';
    logEvent('system','⏸ Pausa');
    setStatus('Listo');
  }

  // ── Whisper ────────────────────────────────────────────────────────────────
  async function processChunk(blob, mimeType) {
    try {
      const ext = mimeType?.includes('ogg') ? 'ogg' : 'webm';
      const fd = new FormData();
      fd.append('file', blob, `audio.${ext}`);
      fd.append('model', 'whisper-1');
      fd.append('response_format', 'verbose_json');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${config.openaiKey}` }, body: fd
      });
      if (!res.ok) { setStatus('Whisper error: ' + (await res.text()).slice(0,80), true); return; }

      const data = await res.json();
      const text = data.text?.trim();
      const lang = data.language;

      if (lang) {
        detectedLang = lang;
        $('lang-badge').textContent = lang === 'english' ? '🇺🇸 EN' : lang === 'spanish' ? '🇪🇸 ES' : lang;
      }

      if (text && text.length > 1) {
        appendTranscript(text);
        // Live translation
        if (translationMode !== 'off') translateText(text);
      }
    } catch(e) { console.error(e); }
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

  // ── Live Translation ───────────────────────────────────────────────────────
  async function translateText(text) {
    if (translationMode === 'off' || !config.openaiKey) return;
    const targetLang = translationMode === 'es' ? 'Spanish' : 'English';
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // use mini for speed on translation
          max_tokens: 300,
          messages: [
            { role: 'system', content: `Translate the following text to ${targetLang}. Return ONLY the translation, no explanations.` },
            { role: 'user', content: text }
          ]
        })
      });
      const data = await res.json();
      const translated = data.choices?.[0]?.message?.content?.trim();
      if (translated) {
        const box = $('translation-box');
        box.textContent = (box.textContent ? box.textContent + '\n' : '') + translated;
        box.scrollTop = box.scrollHeight;
      }
    } catch(e) { console.error('Translation error:', e); }
  }

  // ── Meeting log ────────────────────────────────────────────────────────────
  function logEvent(type, text) {
    const time = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    meetingLog.push({ time, type, text });
    updateSummaryBtn();
  }

  function getFullTranscript() {
    return meetingLog.filter(e => e.type === 'transcript').map(e => `[${e.time}] ${e.text}`).join('\n');
  }

  function updateSummaryBtn() {
    const has = meetingLog.filter(e => e.type === 'transcript').length > 0;
    $('btn-summary').disabled = !has;
    $('btn-summary').style.opacity = has ? '1' : '0.4';
  }

  // ── Generate Comment ───────────────────────────────────────────────────────
  const toneMap = {
    colaborativo: 'in a collaborative tone, showing you listened and contributing positively',
    analitico:    'in an analytical tone, with structured reasoning or data-driven points',
    propositivo:  'proposing a concrete action or clear next step',
    pregunta:     'asking one key, intelligent question that opens the discussion',
    resumen:      'summarizing the main points discussed clearly and concisely',
    acuerdo:      'showing agreement and expanding the idea with added value',
    tecnico:      'with technical depth, focusing on implementation or methodology',
  };

  async function generateComment(autoTriggered = false) {
    const text = currentTranscript.trim();
    if (text.length < 10 || !config.openaiKey) return;

    autoGenerating = true;
    $('gen-btn').disabled = true;
    $('gen-btn').textContent = '⏳ Generando...';
    $('comment-section').classList.remove('visible');
    setStatus('Generando con GPT-4o...');

    const tone    = $('tone-sel').value;
    const lenCfg  = lengthMap[selectedLength] || lengthMap.medium;

    // Comment language
    const langSel = $('comment-lang-sel').value;
    // In auto-triggered mode, always follow the detected meeting language
    const lang = (autoTriggered && langSel === 'auto') 
               ? (detectedLang === 'english' ? 'English' : detectedLang === 'spanish' ? 'Spanish' : 'the same language as the meeting')
               : langSel === 'es' ? 'Spanish'
               : langSel === 'en' ? 'English'
               : detectedLang === 'english' ? 'English'
               : detectedLang === 'spanish' ? 'Spanish'
               : 'the same language as the meeting';

    let ctxBlock = '';
    if (context.topic)              ctxBlock += `\nMeeting topic: ${context.topic}`;
    if (context.profile)            ctxBlock += `\nSpeaker role: ${context.profile}`;
    if (context.notes)              ctxBlock += `\nNotes: ${context.notes}`;
    if (config.defaultProfile)      ctxBlock += `\nProfile: ${config.defaultProfile}`;
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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.openaiKey}` },
        body: JSON.stringify({ model: config.model || 'gpt-4o', max_tokens: lenCfg.tokens, temperature: 0.75, messages })
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

    } catch(err) {
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
    $('transcript-box').innerHTML = '<span class="placeholder-txt">Presiona "Escuchar" para capturar el audio...</span>';
    $('translation-box').textContent = '';
    $('gen-btn').disabled = true;
    $('lang-badge').textContent = '—';
    detectedLang = null;
    setStatus('Listo');
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  $('btn-summary').addEventListener('click', openSummaryModal);
  $('summary-close').addEventListener('click', () => { $('summary-modal').style.display = 'none'; });
  $('btn-open-folder').addEventListener('click', () => api.openMeetingsFolder());
  $('summary-copy').addEventListener('click', () => {
    navigator.clipboard.writeText($('summary-content').innerText).then(() => {
      $('summary-copy').textContent = '✓ Copiado';
      setTimeout(() => { $('summary-copy').textContent = '📋 Copiar'; }, 2000);
    });
  });
  $('summary-new').addEventListener('click', () => {
    if (!confirm('¿Iniciar nueva reunión? Se borrará el historial actual.')) return;
    meetingLog = []; currentTranscript = ''; meetingStartTime = null; lastComment = '';
    $('transcript-box').innerHTML = '<span class="placeholder-txt">Presiona "Escuchar" para capturar el audio...</span>';
    $('translation-box').textContent = '';
    $('comment-section').classList.remove('visible');
    $('gen-btn').disabled = true; $('lang-badge').textContent = '—'; detectedLang = null;
    $('summary-modal').style.display = 'none';
    setStatus('Nueva reunión lista');
    updateSummaryBtn();
  });

  async function openSummaryModal() {
    $('summary-modal').style.display = 'flex';
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
        ${context.topic ? `<span>📌 ${context.topic}</span>` : ''}
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
    if (context.topic)   ctxBlock += `\nTema: ${context.topic}`;
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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.openaiKey}` },
        body: JSON.stringify({ model: config.model || 'gpt-4o', max_tokens: 1500, temperature: 0.4,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Transcript:\n\n${fullTx.slice(-12000)}` }]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const summary = data.choices?.[0]?.message?.content?.trim() || '';
      logEvent('summary', summary);
      renderSummary(summary, duration);
      btn.style.display = 'none';

      const saved = await saveMeetingToFile(summary);
      if (saved.ok) {
        $('sum-saved-msg').textContent = `✓ Guardado en Documentos/Meet Assistant/`;
        $('sum-saved-msg').style.display = 'block';
        $('btn-open-folder').style.display = 'flex';
      }
    } catch(err) {
      $('summary-content').innerHTML += `<p style="color:#f87171;font-size:12px;margin-top:8px">Error: ${err.message}</p>`;
      btn.disabled = false; btn.textContent = '↺ Reintentar';
    }
  }

  function renderSummary(md, duration) {
    const date = meetingStartTime ? meetingStartTime.toLocaleDateString('es', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : '';
    const html = md
      .replace(/^## (.+)$/gm,'<h3>$1</h3>')
      .replace(/^- (.+)$/gm,'<li>$1</li>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/(<li>[\s\S]*?<\/li>)/g,'<ul>$1</ul>')
      .replace(/<\/ul>\s*<ul>/g,'')
      .replace(/\n/g,'');
    $('summary-content').innerHTML = `
      <div class="sum-meta">
        <span>📅 ${date}</span><span>⏱ ${duration}</span>
        <span>💬 ${meetingLog.filter(e=>e.type==='transcript').length} fragmentos</span>
        ${context.topic ? `<span>📌 ${context.topic}</span>` : ''}
      </div>
      <div class="sum-body">${html}</div>`;
  }

  // ── Save to file ───────────────────────────────────────────────────────────
  async function saveMeetingToFile(summaryText) {
    const now = meetingStartTime || new Date();
    const dateStr = now.toISOString().slice(0,10);
    const timeStr = now.toTimeString().slice(0,5).replace(':','-');
    const topic = context.topic ? ' - ' + context.topic.slice(0,40).replace(/[/\\:*?"<>|]/g,'') : '';
    const filename = `${dateStr} ${timeStr}${topic}.txt`;
    const duration = meetingStartTime ? Math.round((new Date() - meetingStartTime) / 60000) + ' minutos' : '—';

    const txLines = meetingLog.filter(e=>e.type==='transcript').map(e=>`[${e.time}] ${e.text}`).join('\n');
    const cmLines = meetingLog.filter(e=>e.type==='comment').map((e,i)=>`[${e.time}] Comentario ${i+1}: ${e.text}`).join('\n');

    let fc = '═══════════════════════════════════════════════════\n';
    fc += '  MEET ASSISTANT — REGISTRO DE REUNIÓN\n';
    fc += '═══════════════════════════════════════════════════\n\n';
    fc += `Fecha:      ${now.toLocaleDateString('es',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}\n`;
    fc += `Hora:       ${now.toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})}\n`;
    fc += `Duración:   ${duration}\n`;
    if (context.topic)   fc += `Tema:       ${context.topic}\n`;
    if (context.profile) fc += `Mi rol:     ${context.profile}\n`;
    if (detectedLang)    fc += `Idioma:     ${detectedLang}\n`;
    fc += '\n';
    if (summaryText) {
      fc += '───────────────────────────────────────────────────\n  RESUMEN EJECUTIVO\n───────────────────────────────────────────────────\n';
      fc += summaryText.replace(/^## /gm,'').replace(/^### /gm,'').replace(/\*\*/g,'').replace(/^- /gm,'  • ') + '\n\n';
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

    return api.saveMeeting(filename, fc);
  }

  // ── Comment feed ──────────────────────────────────────────────────────────
  function appendCommentToFeed(text, isAuto = false) {
    const feed = $('comment-feed');
    const actions = $('comment-actions');

    const time = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    const entry = document.createElement('div');
    entry.className = 'comment-entry' + (isAuto ? ' auto' : '');

    const tsLabel = isAuto ? '⚡ Auto · ' + time : '✋ Manual · ' + time;
    entry.innerHTML = `
      <div class="comment-ts ${isAuto ? 'auto' : ''}">${tsLabel}</div>
      <div class="comment-text">${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
      <button class="comment-copy-btn">📋 Copiar</button>
    `;

    entry.querySelector('.comment-copy-btn').addEventListener('click', function() {
      navigator.clipboard.writeText(text).then(() => {
        this.textContent = '✓ Copiado';
        setTimeout(() => { this.textContent = '📋 Copiar'; }, 1600);
      });
    });

    feed.appendChild(entry);
    // Solo hacer scroll si el usuario ya está al fondo — si está leyendo, no mover la vista
    const body = $('body');
    const isAtBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    if (isAtBottom) {
      setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50);
    } else {
      showNewCommentBadge();
    }

    // Show clear-all button once there's at least one comment
    actions.style.display = 'flex';
  }

  // ── Audio device setup ───────────────────────────────────────────────────
  let selectedDeviceId = null; // null = default mic
  let selectedDeviceName = null; // for macOS SwitchAudioSource
  let platform = 'darwin';

  // Load platform and check BlackHole on init
  api.getPlatform().then(p => {
    platform = p;
    // Pre-select the right guide tab
    if (p === 'win32') {
      $('tab-mac').classList.remove('active');
      $('tab-win').classList.add('active');
      $('guide-mac').style.display = 'none';
      $('guide-win').style.display = 'flex';
    }
    // Check if BlackHole is installed (macOS only)
    if (p === 'darwin') {
      api.checkBlackhole().then(({ installed }) => {
        if (installed) {
          $('audio-status-bar').className = 'audio-status ok';
          $('audio-status-bar').textContent = '✓ BlackHole detectado — selecciónalo como entrada';
          if ($('bh-not-installed')) $('bh-not-installed').style.display = 'none';
          if ($('bh-installed-ok')) $('bh-installed-ok').style.display = 'block';
        } else {
          $('audio-status-bar').className = 'audio-status error';
          $('audio-status-bar').textContent = '❌ BlackHole no instalado — usa el botón 🎧 para instalarlo';
        }
      });
    }
  });

  // Open audio modal
  $('btn-audio-setup').addEventListener('click', async () => {
    $('audio-modal').style.display = 'flex';
    await loadAudioDevices();
  });

  $('audio-cancel').addEventListener('click', () => { $('audio-modal').style.display = 'none'; });

  $('audio-apply').addEventListener('click', async () => {
    const sel = $('audio-device-sel');
    const rawValue = sel.value;
    const rawLabel = sel.options[sel.selectedIndex]?.text?.replace('⭐ ', '') || 'predeterminado';
    const isVirtual = rawLabel.toLowerCase().includes('blackhole') ||
                      rawLabel.toLowerCase().includes('cable') ||
                      rawLabel.toLowerCase().includes('stereo mix') ||
                      rawLabel.toLowerCase().includes('vb-audio');

    $('audio-apply').textContent = '⏳ Aplicando...';
    $('audio-apply').disabled = true;

    if (platform === 'darwin' && rawValue && rawValue !== '') {
      // Use SwitchAudioSource to set system input
      const deviceNameClean = rawValue === '__blackhole__' ? 'BlackHole 2ch' : rawValue;
      const r = await api.switchAudioInput(deviceNameClean);
      if (r.ok) {
        selectedDeviceName = deviceNameClean;
        selectedDeviceId = null; // let system handle it
        setStatus(`✓ Entrada de audio cambiada a: ${deviceNameClean}`);
      } else {
        // Fallback: just use as browser deviceId
        selectedDeviceId = rawValue;
        selectedDeviceName = rawLabel;
        setStatus(`Dispositivo seleccionado: ${rawLabel}`);
      }
    } else {
      selectedDeviceId = rawValue || null;
      selectedDeviceName = rawLabel;
    }

    $('audio-status-bar').className = 'audio-status ' + (isVirtual ? 'ok' : 'warn');
    $('audio-status-bar').textContent = isVirtual
      ? `✓ ${rawLabel} — capturará audio de toda la reunión`
      : `⚠️ ${rawLabel} — solo captará tu micrófono`;

    api.saveConfig({ audioDeviceId: selectedDeviceId, audioDeviceName: selectedDeviceName });
    $('listen-btn').title = `Dispositivo: ${rawLabel}`;

    $('audio-apply').textContent = '✓ Usar este dispositivo';
    $('audio-apply').disabled = false;
    $('audio-modal').style.display = 'none';
  });

  // Guide tabs
  $('tab-mac').addEventListener('click', () => {
    $('tab-mac').classList.add('active'); $('tab-win').classList.remove('active');
    $('guide-mac').style.display = 'flex'; $('guide-win').style.display = 'none';
  });
  $('tab-win').addEventListener('click', () => {
    $('tab-win').classList.add('active'); $('tab-mac').classList.remove('active');
    $('guide-win').style.display = 'flex'; $('guide-mac').style.display = 'none';
  });

  // Open system audio settings
  $('btn-open-audio-settings').addEventListener('click', () => api.openAudioSettings());
  $('btn-open-audio-settings-win') && $('btn-open-audio-settings-win').addEventListener('click', () => api.openAudioSettings());

  // ── Install BlackHole (macOS) ───────────────────────────────────────────────
  const btnInstallBH = $('btn-install-blackhole');
  if (btnInstallBH) {
    btnInstallBH.addEventListener('click', async () => {
      btnInstallBH.disabled = true;
      btnInstallBH.textContent = '⏳ Descargando...';
      $('bh-installing').style.display = 'block';

      const result = await api.installBlackhole();

      $('bh-installing').style.display = 'none';
      btnInstallBH.style.display = 'none';

      const msgEl = $('bh-install-msg');
      msgEl.style.display = 'block';
      if (result.ok) {
        msgEl.style.color = '#4ade80';
        msgEl.textContent = '✅ ' + result.message;
        // After install, reload devices after a delay
        setTimeout(() => loadAudioDevices(), 3000);
      } else {
        msgEl.style.color = '#f87171';
        msgEl.textContent = '❌ Error: ' + result.error + '. Descárgalo manualmente en existential.audio/blackhole';
        btnInstallBH.disabled = false;
        btnInstallBH.style.display = 'flex';
        btnInstallBH.textContent = '↺ Reintentar';
      }
    });
  }

  // ── Install VB-Cable (Windows) ─────────────────────────────────────────────
  const btnVBCable = $('btn-install-vbcable');
  if (btnVBCable) {
    btnVBCable.addEventListener('click', async () => {
      const result = await api.installVBCableWin();
      const msgEl = $('win-install-msg');
      msgEl.style.display = 'block';
      msgEl.textContent = '🌐 ' + result.message + ' Instálalo, reinicia el equipo y vuelve aquí.';
    });
  }

  // ── Enable Stereo Mix (Windows) ────────────────────────────────────────────
  const btnStereoMix = $('btn-enable-stereomix');
  if (btnStereoMix) {
    btnStereoMix.addEventListener('click', async () => {
      const result = await api.enableStereomixWin();
      const msgEl = $('win-install-msg');
      msgEl.style.display = 'block';
      msgEl.textContent = '🔧 ' + result.message;
      setTimeout(() => loadAudioDevices(), 2000);
    });
  }

  // Load audio devices using SwitchAudioSource (macOS) or browser API (fallback)
  async function loadAudioDevices() {
    const sel = $('audio-device-sel');
    sel.innerHTML = '<option value="">⏳ Cargando...</option>';

    if (platform === 'darwin') {
      // Use SwitchAudioSource via main process for reliable device list
      const result = await api.listAudioInputs();
      sel.innerHTML = '';

      if (result.hasSwitchAudio && result.devices.length > 0) {
        result.devices.forEach(name => {
          const opt = document.createElement('option');
          opt.value = name;
          const isVirtual = name.toLowerCase().includes('blackhole') ||
                            name.toLowerCase().includes('cable') ||
                            name.toLowerCase().includes('stereo mix');
          opt.textContent = (isVirtual ? '⭐ ' : '') + name;
          if (name === selectedDeviceName) opt.selected = true;
          sel.appendChild(opt);
        });
        const hasVirtual = result.devices.some(n => n.toLowerCase().includes('blackhole') || n.toLowerCase().includes('cable'));
        $('audio-status-bar').className = 'audio-status ' + (hasVirtual ? 'ok' : 'warn');
        $('audio-status-bar').textContent = hasVirtual
          ? '✓ BlackHole detectado — selecciónalo y aplica'
          : '⚠️ No se detectó BlackHole. Instálalo con la guía de abajo.';

        // Show BlackHole install state
        if (hasVirtual) {
          if ($('bh-not-installed')) $('bh-not-installed').style.display = 'none';
          if ($('bh-installed-ok')) $('bh-installed-ok').style.display = 'block';
        }
        // Show SwitchAudioSource info
        $('switch-audio-note') && ($('switch-audio-note').style.display = 'none');
      } else {
        // SwitchAudioSource not installed — show install prompt
        sel.innerHTML = '<option value="__blackhole__">⭐ BlackHole 2ch (aplicar para activar)</option><option value="">🎤 Micrófono del sistema (predeterminado)</option>';
        showInstallSwitchAudioPrompt();
      }
    } else {
      // Windows / fallback: use browser API
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(d => d.kind === 'audioinput');
        sel.innerHTML = '<option value="">🎤 Predeterminado</option>';
        inputs.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          const isVirtual = d.label.toLowerCase().includes('blackhole') || d.label.toLowerCase().includes('cable') || d.label.toLowerCase().includes('stereo mix');
          opt.textContent = (isVirtual ? '⭐ ' : '') + (d.label || 'Dispositivo de audio');
          if (d.deviceId === selectedDeviceId) opt.selected = true;
          sel.appendChild(opt);
        });
      } catch(e) {
        sel.innerHTML = '<option>Error al cargar dispositivos</option>';
      }
    }
  }

  function showInstallSwitchAudioPrompt() {
    // Add a note inside the audio modal about installing SwitchAudioSource
    let note = $('switch-audio-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'switch-audio-note';
      note.style.cssText = 'background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.25);border-radius:9px;padding:10px 12px;font-size:11.5px;color:#fbbf24;margin-bottom:8px;line-height:1.6';
      note.innerHTML = `⚠️ Para ver todos los dispositivos de audio instala <strong>SwitchAudioSource</strong>:<br>
        <button id="btn-install-switchaudio" style="margin-top:6px;width:100%;padding:7px;background:rgba(251,191,36,.2);border:1px solid rgba(251,191,36,.3);border-radius:7px;color:#fbbf24;font-size:11.5px;cursor:pointer;font-family:inherit;font-weight:600">
          ⬇️ Instalar SwitchAudioSource (requiere Homebrew)
        </button>
        <div id="switch-install-msg" style="margin-top:5px;display:none;font-size:11px;color:#888"></div>`;
      const audioBody = document.querySelector('.audio-body');
      if (audioBody) audioBody.insertBefore(note, audioBody.firstChild);

      $('btn-install-switchaudio').addEventListener('click', async () => {
        $('btn-install-switchaudio').textContent = '⏳ Instalando via Homebrew...';
        $('btn-install-switchaudio').disabled = true;
        const r = await api.installSwitchAudio();
        const msg = $('switch-install-msg');
        msg.style.display = 'block';
        if (r.ok) {
          msg.style.color = '#4ade80';
          msg.textContent = '✅ Instalado. Cierra y vuelve a abrir el panel de audio.';
          setTimeout(() => loadAudioDevices(), 1500);
        } else if (r.needsBrew) {
          msg.style.color = '#f87171';
          msg.textContent = 'Homebrew no está instalado. Ve a brew.sh para instalarlo primero.';
          $('btn-install-switchaudio').disabled = false;
          $('btn-install-switchaudio').textContent = '↺ Reintentar';
        } else {
          msg.style.color = '#f87171';
          msg.textContent = 'Error: ' + r.error;
          $('btn-install-switchaudio').disabled = false;
          $('btn-install-switchaudio').textContent = '↺ Reintentar';
        }
      });
    }
  }

  // Load saved device preference on startup
  if (config.audioDeviceId) {
    selectedDeviceId = config.audioDeviceId;
    if (config.audioDeviceName) {
      $('listen-btn').title = `Dispositivo: ${config.audioDeviceName}`;
    }
  }

  // ── Smart scroll badge ────────────────────────────────────────────────────
  let newCommentBadge = null;

  function showNewCommentBadge() {
    if (newCommentBadge) {
      // Already showing — just update counter
      const current = parseInt(newCommentBadge.dataset.count || '1');
      newCommentBadge.dataset.count = current + 1;
      newCommentBadge.textContent = `⬇ ${current + 1} comentarios nuevos`;
      return;
    }
    newCommentBadge = document.createElement('button');
    newCommentBadge.dataset.count = '1';
    newCommentBadge.textContent = '⬇ Nuevo comentario';
    newCommentBadge.style.cssText = [
      'position:fixed', 'bottom:52px', 'left:50%', 'transform:translateX(-50%)',
      'background:rgba(99,102,241,0.95)', 'color:white', 'border:none',
      'border-radius:20px', 'padding:7px 18px', 'font-size:12px', 'font-weight:600',
      'cursor:pointer', 'font-family:inherit', 'z-index:500',
      'box-shadow:0 4px 20px rgba(0,0,0,0.45)',
      'animation:badgeIn 0.2s ease'
    ].join(';');

    document.head.insertAdjacentHTML('beforeend',
      '<style>@keyframes badgeIn{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}</style>'
    );

    newCommentBadge.addEventListener('click', () => {
      $('body').scrollTop = $('body').scrollHeight;
      dismissBadge();
    });
    document.body.appendChild(newCommentBadge);
  }

  function dismissBadge() {
    if (newCommentBadge) { newCommentBadge.remove(); newCommentBadge = null; }
  }

  // Quitar badge cuando el usuario llega al fondo por su cuenta
  $('body').addEventListener('scroll', () => {
    const body = $('body');
    if (body.scrollHeight - body.scrollTop - body.clientHeight < 80) dismissBadge();
  });

  // ── Auto-save ─────────────────────────────────────────────────────────────
  // Called by main process on: close, suspend, shutdown, lock-screen, quit
  api.onAutoSaveRequested(async ({ reason }) => {
    await autoSaveMeeting(reason);
  });

  // Periodic auto-save every 5 minutes (backup while meeting is running)
  setInterval(() => {
    if (meetingLog.filter(e => e.type === 'transcript').length > 0) {
      autoSaveMeeting('autosave');
    }
  }, 5 * 60 * 1000);

  async function autoSaveMeeting(reason) {
    if (meetingLog.filter(e => e.type === 'transcript').length === 0) return;

    const now = meetingStartTime || new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '-');
    const topic = context.topic ? ' - ' + context.topic.slice(0, 40).replace(/[/\\:*?"<>|]/g, '') : '';

    // Autosaves get a suffix; final save overwrites with clean name
    const suffix = reason === 'autosave' ? ' (autoguardado)' : '';
    const filename = `${dateStr} ${timeStr}${topic}${suffix}.txt`;

    const txLines = meetingLog.filter(e => e.type === 'transcript').map(e => `[${e.time}] ${e.text}`).join('\n');
    const cmLines = meetingLog.filter(e => e.type === 'comment').map((e, i) => `[${e.time}] Comentario ${i+1}: ${e.text}`).join('\n');
    const duration = meetingStartTime ? Math.round((new Date() - meetingStartTime) / 60000) + ' minutos' : '—';

    const reasonLabel = {
      close: 'Cierre de la aplicación',
      suspend: 'Suspensión del equipo',
      shutdown: 'Apagado del equipo',
      'lock-screen': 'Bloqueo de pantalla',
      quit: 'Cierre de la aplicación',
      autosave: 'Guardado automático (cada 5 min)',
    }[reason] || reason;

    let fc = '═══════════════════════════════════════════════════\n';
    fc += '  MEET ASSISTANT — REGISTRO DE REUNIÓN\n';
    fc += '═══════════════════════════════════════════════════\n\n';
    fc += `Fecha:      ${now.toLocaleDateString('es', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}\n`;
    fc += `Hora:       ${now.toLocaleTimeString('es', { hour:'2-digit', minute:'2-digit' })}\n`;
    fc += `Duración:   ${duration}\n`;
    fc += `Guardado:   ${reasonLabel}\n`;
    if (context.topic)   fc += `Tema:       ${context.topic}\n`;
    if (context.profile) fc += `Mi rol:     ${context.profile}\n`;
    if (detectedLang)    fc += `Idioma:     ${detectedLang}\n`;
    fc += '\n';

    if (cmLines) {
      fc += '───────────────────────────────────────────────────\n  MIS COMENTARIOS\n───────────────────────────────────────────────────\n';
      fc += cmLines + '\n\n';
    }
    if (txLines) {
      fc += '───────────────────────────────────────────────────\n  TRANSCRIPCIÓN COMPLETA\n───────────────────────────────────────────────────\n';
      fc += txLines + '\n';
    }
    fc += `\n═══════════════════════════════════════════════════\n  Guardado automáticamente el ${new Date().toLocaleString('es')}\n═══════════════════════════════════════════════════\n`;

    try {
      await api.saveMeeting(filename, fc);
      // Show subtle status only for non-autosave events
      if (reason !== 'autosave') {
        setStatus(`✓ Reunión guardada (${reasonLabel.toLowerCase()})`);
      }
    } catch(e) {
      console.error('Auto-save error:', e);
    }
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); if (isListening) stopListening(); else startListening(); }
    if (e.altKey && e.key.toLowerCase() === 'g') { e.preventDefault(); if (!$('gen-btn').disabled) generateComment(); }
    if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (!$('btn-summary').disabled) openSummaryModal(); }
    if (e.key === 'Escape') {
      $('ctx-modal').style.display = 'none';
      $('summary-modal').style.display = 'none';
    }
  });

  function setStatus(msg, isError = false) {
    $('status-text').textContent = msg;
    $('footer').className = isError ? 'error' : '';
    if (!isError && isListening) $('status-dot').className = 'status-dot listening';
    else if (!isError)           $('status-dot').className = 'status-dot';
  }

})();
