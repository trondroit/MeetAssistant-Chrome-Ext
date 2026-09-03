// Meet Assistant — Popup
(async function () {
  const statusBox = document.getElementById('status-box');
  const btnActivate = document.getElementById('btn-activate');
  const btnOptions = document.getElementById('btn-options');

  btnOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    statusBox.className = 'status off';
    statusBox.textContent = 'No se detectó ninguna pestaña activa.';
    return;
  }

  const config = await new Promise(resolve => chrome.storage.local.get(['openaiKey'], resolve));
  if (!config.openaiKey) {
    statusBox.className = 'status warn';
    statusBox.textContent = '⚠️ Configura tu OpenAI API Key para empezar.';
  }

  let url;
  try { url = new URL(tab.url); } catch { url = null; }
  const isHttp = url && (url.protocol === 'http:' || url.protocol === 'https:');

  chrome.tabs.sendMessage(tab.id, { type: 'ping' }, () => {
    const active = !chrome.runtime.lastError;
    if (active) {
      if (config.openaiKey) {
        statusBox.className = 'status ok';
        statusBox.textContent = '✓ Meet Assistant está activo en esta pestaña. Busca el panel flotante 🎙 abajo a la derecha.';
      }
      btnActivate.style.display = 'none';
    } else {
      statusBox.className = 'status off';
      statusBox.textContent = isHttp
        ? 'Meet Assistant no está activo en esta página todavía.'
        : 'Esta página no admite extensiones (chrome://, file://, etc).';
      btnActivate.style.display = isHttp ? 'block' : 'none';
    }
  });

  btnActivate.addEventListener('click', async () => {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      statusBox.className = 'status ok';
      statusBox.textContent = '✓ Activado. Busca el panel flotante 🎙 abajo a la derecha.';
      btnActivate.style.display = 'none';
    } catch (e) {
      statusBox.className = 'status warn';
      statusBox.textContent = 'No se pudo activar aquí: ' + e.message;
    }
  });
})();
