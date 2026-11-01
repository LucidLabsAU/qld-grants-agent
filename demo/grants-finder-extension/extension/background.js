// Service worker: owns the conversation with the Foundry agent (via the local bridge) and persists it in
// chrome.storage so the chat survives SPA route changes, full page loads and multiple tabs. Content scripts only
// render state and send intents ("send", "setOpen", "reset").

import { matchGrants, parseQuery, parseRetrievedGrants } from './lib/grants.js';
import { responseEvents } from './lib/stream.js';

const KEY = 'gc';
const SITE = 'https://www.grants.services.qld.gov.au/';
const DEFAULT_BRIDGE = 'http://127.0.0.1:8787';
const empty = () => ({ open: false, busy: false, messages: [], picks: {} });

let state = null;
let saveTimer = null;
let loading = null;

async function getState() {
  if (state) return state;
  loading ??= (async () => {
    state = (await chrome.storage.local.get(KEY))[KEY] ?? empty();
    if (state.busy) {
      state.busy = false;
      const bot = state.messages.at(-1);
      if (bot?.role === 'assistant') {
        bot.status = 'error';
        bot.error = 'The previous response was interrupted. Please try again.';
      }
      await save(true);
    }
    return state;
  })();
  return loading;
}

function save(now = false) {
  clearTimeout(saveTimer);
  if (now) return chrome.storage.local.set({ [KEY]: state });
  saveTimer = setTimeout(() => chrome.storage.local.set({ [KEY]: state }), 90);
}

async function bridgeUrl() {
  const { bridgeUrl } = await chrome.storage.sync.get({ bridgeUrl: DEFAULT_BRIDGE });
  return bridgeUrl.replace(/\/+$/, '');
}

const uid = () => Math.random().toString(36).slice(2, 10);

function setStep(msg, key, patch) {
  const order = ['understand', 'search', 'write'];
  let step = msg.steps.find((s) => s.key === key);
  if (!step) {
    step = { key, state: 'active' };
    msg.steps.push(step);
    msg.steps.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }
  Object.assign(step, patch);
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const error = new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
    error.rateLimited = res.status === 429;
    throw error;
  }
  return res;
}

async function send({ text, context }) {
  const s = await getState();
  if (s.busy || !text?.trim()) return;
  const question = text.trim();
  const bot = {
    id: uid(),
    role: 'assistant',
    status: 'pending',
    text: '',
    grants: [],
    steps: [{ key: 'understand', state: 'active', label: 'Understanding what you need' }],
    startedAt: Date.now(),
  };
  s.messages.push({ id: uid(), role: 'user', text: question, context: context?.label ?? null }, bot);
  s.busy = true;
  s.open = true;
  await save(true);

  const retrieved = [];
  let searches = 0;
  // Extension API calls reset the service worker idle timer, keeping it alive during long agent turns.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  try {
    const base = await bridgeUrl();
    // Each turn runs in a fresh, small conversation seeded with a compact recap of earlier turns. Replaying the full
    // server-side history (including every retrieval payload) grows fast and exhausts the model's tokens-per-minute.
    const memory = recap(s.messages.slice(0, -2));
    const parts = [memory, context?.prompt, `User question: ${question}`].filter(Boolean);
    const input = parts.length > 1 ? parts.join('\n\n') : question;

    for (let attempt = 0; ; attempt++) {
      try {
        const conversation = (await (await postJson(`${base}/v1/conversations`, {})).json()).id;
        const res = await postJson(`${base}/v1/responses`, { conversation, input });
        await consume(res, bot, retrieved, () => ++searches);
        break;
      } catch (err) {
        if (!err.rateLimited || attempt >= 3 || bot.text) throw err;
        retrieved.length = 0;
        for (let wait = 12 + attempt * 12; wait > 0; wait--) {
          setStep(bot, 'search', { state: 'active', label: 'High demand right now', detail: `Retrying in ${wait}s…` });
          save();
          await new Promise((r) => setTimeout(r, 1000));
        }
        setStep(bot, 'search', { label: 'Searching Queensland Government grants', detail: undefined });
      }
    }

    bot.grants = matchGrants(bot.text, retrieved);
    for (const g of bot.grants) s.picks[g.id] ??= { title: g.title, question };
    setStep(bot, 'write', { state: 'done', label: 'Answer ready' });
    bot.status = 'done';
  } catch (err) {
    bot.status = 'error';
    bot.error = /Failed to fetch|NetworkError/i.test(err.message)
      ? 'Could not reach the local agent bridge. Start it with "npm run bridge" in demo/grants-finder-extension.'
      : err.rateLimited
        ? 'The AI service is very busy right now. Please try again in a minute.'
        : err.message;
  } finally {
    clearInterval(keepAlive);
    bot.elapsedMs = Date.now() - bot.startedAt;
    s.busy = false;
    await save(true);
  }
}

function recap(history) {
  const turns = [];
  for (let i = 0; i < history.length - 1; i++) {
    const [u, a] = [history[i], history[i + 1]];
    if (u.role !== 'user' || a.role !== 'assistant' || a.status !== 'done') continue;
    const picks = a.grants?.length ? ` You recommended: ${a.grants.map((g) => `"${g.title}" (${g.status || 'status unknown'}${g.closingDate ? `, closes ${String(g.closingDate).slice(0, 10)}` : ''})`).join(', ')}.` : '';
    const gist = a.text.replace(/【[^】]*】/g, '').replace(/\s+/g, ' ').slice(0, 500);
    turns.push(`- User asked: "${u.text.slice(0, 300)}".${picks} Your answer began: "${gist}…"`);
  }
  if (!turns.length) return '';
  return `Conversation so far (most recent last):\n${turns.slice(-3).join('\n')}`.slice(0, 3500);
}

async function consume(res, bot, retrieved, countSearch) {
  for await (const ev of responseEvents(res.body)) {
    switch (ev.type) {
      case 'response.output_item.added':
        if (ev.item?.type === 'mcp_call' || ev.item?.type === 'mcp_list_tools') {
          setStep(bot, 'understand', { state: 'done' });
          setStep(bot, 'search', { state: 'active', label: 'Searching Queensland Government grants' });
        }
        break;
      case 'response.mcp_call_arguments.done': {
        const q = parseQuery(ev.arguments);
        if (q) setStep(bot, 'search', { detail: q });
        break;
      }
      case 'response.output_item.done':
        if (ev.item?.type === 'mcp_call') {
          const searches = countSearch();
          retrieved.push(...parseRetrievedGrants(ev.item.output));
          const unique = new Set(retrieved.map((g) => g.id)).size;
          setStep(bot, 'search', {
            state: 'done',
            label: `Reviewed ${unique} matching programs${searches > 1 ? ` across ${searches} searches` : ''}`,
          });
        }
        break;
      case 'response.output_text.delta':
        if (bot.status !== 'streaming') {
          bot.status = 'streaming';
          setStep(bot, 'understand', { state: 'done' });
          setStep(bot, 'write', { state: 'active', label: 'Writing your answer' });
        }
        bot.text += ev.delta ?? '';
        break;
      case 'response.output_text.done':
        if (ev.text) bot.text = ev.text;
        break;
    }
    save();
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    const s = await getState();
    switch (msg?.type) {
      case 'send':
        send(msg); // long-running; progress flows through storage
        break;
      case 'setOpen':
        s.open = !!msg.open;
        await save(true);
        break;
      case 'reset':
        if (s.busy) break;
        state = { ...empty(), open: s.open };
        await save(true);
        break;
      case 'retry': {
        if (s.busy) break;
        const lastUser = [...s.messages].reverse().find((m) => m.role === 'user');
        const idx = s.messages.lastIndexOf(lastUser);
        if (lastUser) {
          s.messages.splice(idx); // drop the failed turn and resend it
          send({ text: lastUser.text, context: msg.context });
        }
        break;
      }
    }
    reply({ ok: true });
  })().catch((error) => {
    console.error('Grants companion message failed:', error);
    reply({ ok: false, error: error.message });
  });
  return true;
});

async function toggleIn(tab) {
  if (tab?.url?.startsWith(SITE)) {
    const s = await getState();
    s.open = !s.open;
    await save(true);
  } else {
    const s = await getState();
    s.open = true;
    await save(true);
    chrome.tabs.create({ url: SITE });
  }
}

chrome.action.onClicked.addListener(toggleIn);
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd === 'toggle-panel') toggleIn(tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
});

getState().catch((error) => console.error('Could not restore grants companion state:', error));
