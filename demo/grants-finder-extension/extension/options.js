const DEFAULT_BRIDGE = 'http://127.0.0.1:8787';
const input = document.getElementById('bridge');
const status = document.getElementById('status');

chrome.storage.sync.get({ bridgeUrl: DEFAULT_BRIDGE }).then(({ bridgeUrl }) => (input.value = bridgeUrl));

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({ bridgeUrl: input.value.trim() || DEFAULT_BRIDGE });
  status.textContent = 'Saved.';
});

document.getElementById('test').addEventListener('click', async () => {
  status.textContent = 'Checking…';
  try {
    const res = await fetch(`${(input.value.trim() || DEFAULT_BRIDGE).replace(/\/+$/, '')}/health`);
    const body = await res.json();
    status.textContent = res.ok ? `Connected: agent "${body.agent}" on ${body.project}` : `Bridge error: ${body.error}`;
  } catch (err) {
    status.textContent = `Could not reach the bridge (${err.message}). Is "npm run bridge" running?`;
  }
});

document.getElementById('clear').addEventListener('click', async () => {
  const { gc } = await chrome.storage.local.get('gc');
  if (gc?.busy) {
    status.textContent = 'Wait for the current response before clearing the conversation.';
    return;
  }
  const result = await chrome.runtime.sendMessage({ type: 'reset' });
  status.textContent = result?.ok ? 'Conversation cleared.' : `Could not clear conversation: ${result?.error ?? 'No response'}`;
});
