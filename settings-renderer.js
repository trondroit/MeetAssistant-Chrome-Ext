// Settings renderer
(async function () {
  const api = window.electronAPI;
  const config = await api.loadConfig();

  // Populate fields
  if (config.openaiKey)          document.getElementById('openai-key').value = config.openaiKey;
  if (config.model)              document.getElementById('model-sel').value = config.model;
  if (config.defaultName)        document.getElementById('default-name').value = config.defaultName;
  if (config.defaultProfile)     document.getElementById('default-profile').value = config.defaultProfile;
  if (config.defaultInstructions) document.getElementById('default-instructions').value = config.defaultInstructions;
  if (config.autoLang !== undefined) document.getElementById('auto-lang').checked = config.autoLang;
  if (config.autoClear !== undefined) document.getElementById('auto-clear').checked = config.autoClear;

  // Toggle key visibility
  const keyInput = document.getElementById('openai-key');
  document.getElementById('toggle-key').addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    document.getElementById('toggle-key').textContent = keyInput.type === 'password' ? 'mostrar' : 'ocultar';
  });

  // Save
  document.getElementById('save-btn').addEventListener('click', () => {
    const data = {
      openaiKey: document.getElementById('openai-key').value.trim(),
      model: document.getElementById('model-sel').value,
      defaultName: document.getElementById('default-name').value.trim(),
      defaultProfile: document.getElementById('default-profile').value.trim(),
      defaultInstructions: document.getElementById('default-instructions').value.trim(),
      autoLang: document.getElementById('auto-lang').checked,
      autoClear: document.getElementById('auto-clear').checked,
    };

    if (data.openaiKey && !data.openaiKey.startsWith('sk-')) {
      alert('La API Key de OpenAI debe empezar con sk-');
      return;
    }

    api.saveSettings(data);

    const msg = document.getElementById('success-msg');
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 2500);
  });
})();
