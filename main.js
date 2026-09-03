const { app, BrowserWindow, ipcMain, screen, systemPreferences, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let settingsWindow = null;

// ── Config ────────────────────────────────────────────────────────────────────
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try { if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch(e) {}
  return {};
}
function saveConfig(data) {
  const current = loadConfig();
  fs.writeFileSync(configPath, JSON.stringify({ ...current, ...data }, null, 2));
}

// ── Auto-save helper ──────────────────────────────────────────────────────────
// Asks the renderer to serialize its current meeting state and save it to disk.
// reason: 'close' | 'suspend' | 'shutdown' | 'autosave'
function requestAutoSave(reason) {
  if (!mainWindow) return;
  mainWindow.webContents.send('auto-save-requested', { reason });
}

// ── Windows ───────────────────────────────────────────────────────────────────
function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 360, height: 640,
    x: width - 380, y: height - 670,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: true,
    skipTaskbar: true, focusable: true, hasShadow: false,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (process.platform === 'win32') mainWindow.setSkipTaskbar(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.loadFile('index.html');

  // ── Auto-save on close ──────────────────────────────────────────────────────
  mainWindow.on('close', (e) => {
    // Signal renderer to save, then allow close
    requestAutoSave('close');
    // Give renderer 1.5s to write the file, then close for real
    setTimeout(() => { if (mainWindow) mainWindow.destroy(); }, 1500);
    e.preventDefault(); // prevent immediate close
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createSettingsWindow() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 520, height: 680,
    title: 'Meet Assistant — Configuración',
    resizable: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  settingsWindow.loadFile('settings.html');
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'darwin') systemPreferences.askForMediaAccess('microphone');
  createMainWindow();

  // ── Power monitor: suspend / shutdown ──────────────────────────────────────
  // 'suspend' fires before sleep on macOS and Windows
  powerMonitor.on('suspend', () => {
    requestAutoSave('suspend');
  });

  // 'shutdown' fires on macOS before shutdown/restart
  powerMonitor.on('shutdown', () => {
    requestAutoSave('shutdown');
  });

  // 'lock-screen' also saves as a precaution
  powerMonitor.on('lock-screen', () => {
    requestAutoSave('lock-screen');
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => { if (!mainWindow) createMainWindow(); });

// On macOS, before-quit fires when Cmd+Q is pressed
app.on('before-quit', () => {
  requestAutoSave('quit');
});

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('load-config', () => loadConfig());
ipcMain.handle('save-config', (_, data) => { saveConfig(data); return true; });
ipcMain.handle('open-settings', () => { createSettingsWindow(); return true; });
ipcMain.handle('close-settings', () => { if (settingsWindow) settingsWindow.close(); return true; });
ipcMain.handle('quit-app', () => { app.quit(); });
ipcMain.handle('minimize-app', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('set-always-on-top', (_, v) => { if (mainWindow) mainWindow.setAlwaysOnTop(v, 'screen-saver'); });

ipcMain.on('settings-saved', (_, data) => {
  saveConfig(data);
  if (mainWindow) mainWindow.webContents.send('config-updated', data);
  if (settingsWindow) settingsWindow.close();
});

ipcMain.on('window-move', (_, { x, y }) => {
  if (mainWindow) mainWindow.setPosition(Math.round(x), Math.round(y));
});

// ── File saving ───────────────────────────────────────────────────────────────
ipcMain.handle('save-meeting', (_, { filename, content }) => {
  try {
    const docsPath = path.join(app.getPath('documents'), 'Meet Assistant');
    if (!fs.existsSync(docsPath)) fs.mkdirSync(docsPath, { recursive: true });
    const filePath = path.join(docsPath, filename);
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true, path: filePath };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ── Audio helpers ────────────────────────────────────────────────────────────
ipcMain.handle('get-platform', () => process.platform);

ipcMain.handle('open-audio-settings', () => {
  if (process.platform === 'darwin') {
    // Open Audio MIDI Setup on macOS
    const { exec } = require('child_process');
    exec('open -a "Audio MIDI Setup"');
  } else if (process.platform === 'win32') {
    // Open Sound settings on Windows
    const { exec } = require('child_process');
    exec('control mmsys.cpl');
  }
});

// ── Install audio drivers ─────────────────────────────────────────────────────
ipcMain.handle('install-blackhole', async () => {
  const { exec } = require('child_process');
  const os = require('os');
  const https = require('https');
  const fs = require('fs');
  const path = require('path');

  return new Promise((resolve) => {
    // BlackHole 2ch pkg URL (direct from existential audio github releases)
    const url = 'https://github.com/ExistentialAudio/BlackHole/releases/download/v0.6.0/BlackHole2ch-0.6.0.pkg';
    const dest = path.join(os.tmpdir(), 'BlackHole2ch.pkg');

    const file = fs.createWriteStream(dest);
    const request = https.get(url, (response) => {
      // Handle redirect
      if (response.statusCode === 302 || response.statusCode === 301) {
        https.get(response.headers.location, (r2) => {
          r2.pipe(file);
          file.on('finish', () => {
            file.close();
            // Open the pkg installer — macOS will handle the rest
            exec(`open "${dest}"`, (err) => {
              if (err) resolve({ ok: false, error: err.message });
              else resolve({ ok: true, message: 'Instalador abierto. Sigue los pasos en pantalla y reinicia la app.' });
            });
          });
        }).on('error', (e) => resolve({ ok: false, error: e.message }));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        exec(`open "${dest}"`, (err) => {
          if (err) resolve({ ok: false, error: err.message });
          else resolve({ ok: true, message: 'Instalador abierto. Sigue los pasos y reinicia la app.' });
        });
      });
    }).on('error', (e) => {
      fs.unlink(dest, () => {});
      resolve({ ok: false, error: e.message });
    });
  });
});

ipcMain.handle('install-vbcable-win', () => {
  const { exec } = require('child_process');
  // Open VB-Cable download page
  exec('start https://vb-audio.com/Cable/');
  return { ok: true, message: 'Abriendo página de descarga de VB-Cable...' };
});

ipcMain.handle('enable-stereomix-win', () => {
  const { exec } = require('child_process');
  // Open sound control panel
  exec('control mmsys.cpl');
  return { ok: true, message: 'Abre la pestaña Grabación, clic derecho → Mostrar dispositivos deshabilitados → habilita Stereo Mix' };
});

// Set BlackHole as default input via SwitchAudioSource or osascript
ipcMain.handle('set-blackhole-as-default', async () => {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    // Try with SwitchAudioSource first (if installed via brew)
    exec('SwitchAudioSource -s "BlackHole 2ch" -t input', (err) => {
      if (!err) { resolve({ ok: true, method: 'SwitchAudioSource' }); return; }
      // Fallback: use osascript to set input device
      const script = `
        tell application "System Preferences"
          reveal pane "com.apple.preference.sound"
          activate
        end tell
        delay 0.5
        tell application "System Events"
          tell process "System Preferences"
            click radio button "Entrada" of tab group 1 of window 1
          end tell
        end tell
      `;
      exec(`osascript -e '${script.replace(/'/g, "\'")}'`, (err2) => {
        if (err2) {
          // Last resort: use system_profiler + defaults
          exec(`osascript -e 'set volume input volume 100'`, () => {});
          resolve({ ok: false, needsManual: true });
        } else {
          resolve({ ok: true, method: 'SystemPreferences', needsManual: true });
        }
      });
    });
  });
});

// Get current default input device name
ipcMain.handle('get-default-input', async () => {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec(`osascript -e 'get name of (get current application)'`, () => {});
    // Use system_profiler to list audio devices
    exec('system_profiler SPAudioDataType -json 2>/dev/null', (err, stdout) => {
      if (err) { resolve({ name: 'unknown' }); return; }
      try {
        const data = JSON.parse(stdout);
        const devices = data?.SPAudioDataType || [];
        const inputs = [];
        devices.forEach(d => {
          if (d?._items) d._items.forEach(item => {
            if (item.coreaudio_input_source) inputs.push(item._name);
          });
        });
        resolve({ devices: inputs });
      } catch(e) { resolve({ name: 'unknown' }); }
    });
  });
});

// Use SwitchAudioSource to list and set devices (brew install switchaudio-osx)
ipcMain.handle('list-audio-inputs', async () => {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('SwitchAudioSource -a -t input', (err, stdout) => {
      if (err || !stdout) {
        // Fallback: use system_profiler
        exec('system_profiler SPAudioDataType 2>/dev/null', (err2, out2) => {
          if (err2) { resolve({ devices: [], hasSwitchAudio: false }); return; }
          const lines = out2.split('\n');
          const devices = [];
          lines.forEach(l => { if (l.trim().startsWith('BlackHole') || l.trim().startsWith('Built-in') || l.trim().startsWith('External')) devices.push(l.trim()); });
          resolve({ devices, hasSwitchAudio: false });
        });
        return;
      }
      const devices = stdout.trim().split('\n').filter(Boolean);
      resolve({ devices, hasSwitchAudio: true });
    });
  });
});

ipcMain.handle('switch-audio-input', async (_, deviceName) => {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec(`SwitchAudioSource -s "${deviceName}" -t input`, (err) => {
      resolve({ ok: !err, error: err?.message });
    });
  });
});

ipcMain.handle('install-switchaudio', async () => {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    // Check if brew is installed first
    exec('which brew', (err) => {
      if (err) {
        resolve({ ok: false, needsBrew: true });
        return;
      }
      exec('brew install switchaudio-osx', (err2, stdout, stderr) => {
        resolve({ ok: !err2, error: err2?.message });
      });
    });
  });
});

ipcMain.handle('check-blackhole', () => {
  if (process.platform === 'darwin') {
    const { execSync } = require('child_process');
    try {
      const out = execSync('system_profiler SPAudioDataType 2>/dev/null').toString();
      return { installed: out.toLowerCase().includes('blackhole') };
    } catch(e) { return { installed: false }; }
  }
  return { installed: null }; // unknown on windows
});

ipcMain.handle('open-meetings-folder', () => {
  const docsPath = path.join(app.getPath('documents'), 'Meet Assistant');
  if (!fs.existsSync(docsPath)) fs.mkdirSync(docsPath, { recursive: true });
  shell.openPath(docsPath);
});
