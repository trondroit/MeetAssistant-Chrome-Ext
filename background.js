// Meet Assistant — Background service worker (Manifest V3)
// Handles things content scripts can't do directly: opening the options page
// and saving meeting transcripts through the Downloads API.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (msg.type === 'save-meeting') {
    saveMeeting(msg.filename, msg.content)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }

  // The content script marks its tab as a meeting tab so we can auto-save it
  // when the tab closes (see chrome.tabs.onRemoved below).
  if (msg.type === 'register-meeting-tab') {
    if (sender.tab?.id != null) chrome.storage.local.set({ meetingTabId: sender.tab.id });
    sendResponse?.({ ok: true });
    return;
  }

  // Sent from the tab's pagehide/beforeunload — download the cached transcript
  // right now from the background (which survives the tab being torn down).
  if (msg.type === 'save-on-close') {
    downloadPendingMeetingFile();
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === 'open-meetings-folder') {
    chrome.downloads.showDefaultFolder?.();
    sendResponse({ ok: true });
    return;
  }
});

// Auto-save when the meeting tab is closed (tab close, window close, quitting
// Chrome). The content script can't reliably finish a download during unload,
// but this service worker outlives the tab, so it downloads the last cached
// transcript from storage. Not fired on a hard crash/power cut — the in-app
// recovery banner handles that on the next launch.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const { meetingTabId } = await chrome.storage.local.get('meetingTabId');
    if (meetingTabId === tabId) await downloadPendingMeetingFile();
  } catch (_) {}
});

async function downloadPendingMeetingFile() {
  try {
    const { pendingMeetingFile } = await chrome.storage.local.get('pendingMeetingFile');
    if (!pendingMeetingFile || !pendingMeetingFile.content) return;
    await saveMeeting(pendingMeetingFile.filename, pendingMeetingFile.content);
    // Clear so we don't download it again and the recovery banner won't re-offer it.
    await chrome.storage.local.remove(['pendingMeeting', 'pendingMeetingFile', 'meetingTabId']);
  } catch (_) {}
}

async function saveMeeting(filename, content) {
  try {
    const base64 = utf8ToBase64(content);
    const url = `data:text/plain;charset=utf-8;base64,${base64}`;
    const safeName = filename.replace(/[/\\:*?"<>|]/g, '_');
    const downloadId = await chrome.downloads.download({
      url,
      filename: `Meet Assistant/${safeName}`,
      saveAs: false,
      // 'overwrite': saving more than once during the same meeting (Guardar,
      // then Resumen, then closing the tab) replaces the same file instead
      // of piling up "archivo (1).txt", "archivo (2).txt", etc.
      conflictAction: 'overwrite',
    });
    return { ok: true, downloadId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
