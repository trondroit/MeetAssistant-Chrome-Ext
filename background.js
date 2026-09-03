// Meet Assistant — Background service worker (Manifest V3)
// Handles things content scripts can't do directly: opening the options page
// and saving meeting transcripts through the Downloads API.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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

  if (msg.type === 'open-meetings-folder') {
    chrome.downloads.showDefaultFolder?.();
    sendResponse({ ok: true });
    return;
  }
});

async function saveMeeting(filename, content) {
  try {
    const base64 = utf8ToBase64(content);
    const url = `data:text/plain;charset=utf-8;base64,${base64}`;
    const safeName = filename.replace(/[/\\:*?"<>|]/g, '_');
    const downloadId = await chrome.downloads.download({
      url,
      filename: `Meet Assistant/${safeName}`,
      saveAs: false,
      conflictAction: 'uniquify',
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
