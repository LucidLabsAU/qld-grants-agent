// Scripted "art of the possible" journey: 16:9 screenshots + an MP4 walkthrough.
// Needs the bridge running (npm run bridge). Usage: npm run capture [-- --no-video] [-- --headed]
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(root, 'extension');
const SHOTS = path.join(root, 'screenshots');
const REC = path.join(root, 'recordings');
const FRAMES = path.join(REC, '.frames');
const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:8787';
const SITE = 'https://www.grants.services.qld.gov.au';
const VIDEO = !process.argv.includes('--no-video');
const W = 1920;
const H = 1080;

const QUESTION = 'I run a small café in Townsville and want to take on my first apprentice. What support can I get?';

// ------------------------------------------------------------ overlay (capture only, never shipped in the extension)
const overlay = () => {
  const css = `
    #demo-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;
      transition:transform var(--t,.7s) cubic-bezier(.45,.05,.2,1);filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))}
    #demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:2147483646;pointer-events:none;
      border:3px solid rgba(124,92,255,.9);opacity:0}
    #demo-ripple.go{animation:demo-rip .55s ease-out}
    @keyframes demo-rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
    #demo-caption{position:fixed;left:48px;bottom:44px;max-width:820px;z-index:2147483645;pointer-events:none;
      padding:18px 26px 18px 22px;border-radius:18px;color:#fff;font:600 24px/1.3 Lato,'Segoe UI',sans-serif;
      background:linear-gradient(135deg,rgba(14,22,48,.92),rgba(40,26,92,.92));box-shadow:0 20px 50px -18px rgba(0,0,0,.6);
      border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(8px);display:flex;gap:16px;align-items:flex-start;
      transform:translateY(20px);opacity:0;transition:opacity .45s,transform .45s}
    #demo-caption.on{opacity:1;transform:none}
    #demo-caption .n{flex:none;min-width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:18px;font-weight:800;
      background:linear-gradient(135deg,#0ea5e9,#7c5cff 60%,#d946ef)}
    #demo-caption small{display:block;margin-top:4px;font-weight:400;font-size:17px;color:#cfd6f5}
    #demo-card{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;text-align:center;color:#fff;pointer-events:none;
      background:radial-gradient(1200px 700px at 30% 20%,#1d4ed8 0,transparent 60%),radial-gradient(900px 600px at 80% 90%,#9333ea 0,transparent 60%),#0b1026;
      opacity:0;transition:opacity .6s;font-family:Lato,'Segoe UI',sans-serif}
    #demo-card.on{opacity:1}
    #demo-card h1{font-size:76px;margin:0 0 18px;font-weight:900;letter-spacing:-1px}
    #demo-card p{font-size:30px;margin:0;color:#cfd6f5}
    #demo-card .k{display:inline-block;margin-bottom:28px;padding:8px 18px;border-radius:999px;font-size:20px;font-weight:700;
      background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2)}`;
  const mount = () => {
    if (document.getElementById('demo-cursor')) return;
    const st = document.createElement('style');
    st.textContent = css;
    document.documentElement.append(st);
    const cur = document.createElement('div');
    cur.id = 'demo-cursor';
    cur.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 9.5-6.6 1.3L16 20l-2.8 1.3-3.5-7.2L4 18.6z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const rip = document.createElement('div');
    rip.id = 'demo-ripple';
    const cap = document.createElement('div');
    cap.id = 'demo-caption';
    const card = document.createElement('div');
    card.id = 'demo-card';
    document.documentElement.append(cur, rip, cap, card);
    const p = JSON.parse(sessionStorage.getItem('demo-cursor') || '[960,700]');
    cur.style.setProperty('--t', '0s');
    cur.style.transform = `translate(${p[0]}px,${p[1]}px)`;
  };
  const el = (id) => (mount(), document.getElementById(id));
  window.__demo = {
    move(x, y, ms = 700) {
      const c = el('demo-cursor');
      c.style.setProperty('--t', `${ms}ms`);
      c.style.transform = `translate(${x}px,${y}px)`;
      sessionStorage.setItem('demo-cursor', JSON.stringify([x, y]));
    },
    ripple() {
      const [x, y] = JSON.parse(sessionStorage.getItem('demo-cursor') || '[0,0]');
      const r = el('demo-ripple');
      r.style.left = `${x + 4}px`;
      r.style.top = `${y + 3}px`;
      r.classList.remove('go');
      void r.offsetWidth;
      r.classList.add('go');
    },
    caption(n, title, sub) {
      const c = el('demo-caption');
      if (!title) return c.classList.remove('on');
      c.innerHTML = `<span class="n">${n}</span><div>${title}${sub ? `<small>${sub}</small>` : ''}</div>`;
      c.classList.add('on');
    },
    card(kicker, title, sub) {
      const c = el('demo-card');
      if (!title) return c.classList.remove('on');
      c.innerHTML = `<div><span class="k">${kicker}</span><h1>${title}</h1><p>${sub}</p></div>`;
      c.classList.add('on');
    },
    hud(on) {
      for (const id of ['demo-caption', 'demo-cursor']) el(id).style.visibility = on ? '' : 'hidden';
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
};

// ------------------------------------------------------------ helpers
function findFfmpeg() {
  const candidates = [];
  try {
    // ffmpeg-static returns null on unsupported archs (e.g. Windows ARM64) even when an emulatable x64 binary exists.
    const dir = path.dirname(createRequire(import.meta.url).resolve('ffmpeg-static/package.json'));
    candidates.push(path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  } catch {}
  candidates.push('ffmpeg');
  for (const c of candidates.filter(Boolean)) {
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (r.status === 0 && /libx264/.test(r.stdout)) return c;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const health = await fetch(`${BRIDGE}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) throw new Error(`Bridge not reachable at ${BRIDGE} - run "npm run bridge" first.`);

  fs.mkdirSync(SHOTS, { recursive: true });
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-capture-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !process.argv.includes('--headed'),
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--window-size=${W},${H}`],
  });
  await ctx.addInitScript(overlay);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('pageerror', (e) => console.warn('pageerror:', e.message));

  // Point the extension at the bridge (options live in chrome.storage.sync).
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  await sw.evaluate((url) => chrome.storage.sync.set({ bridgeUrl: url }), BRIDGE);

  // ---- recording (CDP screencast -> timestamped JPEG frames -> ffmpeg)
  const frames = [];
  const speeds = [{ t: 0, f: 1 }];
  let cdp;
  const t0 = Date.now();
  if (VIDEO) {
    cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      const file = path.join(FRAMES, `${String(frames.length).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, t: Date.now() - t0 });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
  }
  const startCast = () => cdp?.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H });
  const speed = (f) => speeds.push({ t: Date.now() - t0, f });

  // ---- choreography helpers
  const demo = (fn, ...a) => page.evaluate(([fn, a]) => window.__demo[fn](...a), [fn, a]);
  const caption = (n, title, sub) => demo('caption', n, title, sub);
  const shot = async (name) => {
    await demo('hud', false);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await demo('hud', true);
    console.log('  📸', name);
  };
  const moveTo = async (loc, ms = 800) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    await demo('move', b.x + Math.min(b.width / 2, 60), b.y + b.height / 2, ms);
    await sleep(ms + 120);
  };
  const click = async (loc) => {
    await moveTo(loc);
    await demo('ripple');
    await loc.click();
  };
  const panelRoot = 'gc-companion';
  const agentState = () => sw.evaluate(() => chrome.storage.local.get('gc').then((s) => s.gc ?? {}));
  const msgCount = async () => (await agentState()).messages?.length ?? 0;
  const waitAnswer = async (label, before) => {
    await sleep(3500);
    speed(5);
    await caption('⏩', label, 'Fast-forwarded · the agent is searching live Queensland Government grant data');
    const until = Date.now() + 240000;
    let completed = false;
    for (let retried = false; Date.now() < until; await sleep(1000)) {
      const s = await agentState();
      const last = s.messages?.at(-1);
      if (s.busy || (s.messages?.length ?? 0) < before + 2 || last?.role !== 'assistant') continue;
      if (last.status === 'done') {
        completed = true;
        break;
      }
      if (last.status === 'error' && !retried) {
        console.warn('  agent error, retrying:', last.error);
        retried = true;
        await page.locator(`${panelRoot} .chip`, { hasText: 'Try again' }).last().click().catch(() => {});
        await sleep(2000);
        continue;
      }
      if (last.status === 'error') throw new Error(`Agent error: ${last.error}`);
    }
    if (!completed) throw new Error(`Timed out waiting for the agent: ${label}`);
    speed(1);
    await sleep(1500);
  };
  const scrollThreadTo = (sel, index = -1, offset = 16) =>
    page.locator(`${panelRoot} .scroll`).evaluate(
      (el, [sel, index, offset]) => {
        const all = el.querySelectorAll(sel);
        const t = all[index < 0 ? all.length + index : index];
        if (t) el.scrollTo({ top: el.scrollTop + t.getBoundingClientRect().top - el.getBoundingClientRect().top - offset, behavior: 'smooth' });
      },
      [sel, index, offset],
    );

  // ================================================================== the journey
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await startCast();
  await demo('card', 'Concept demo', 'Queensland Grants Finder, reimagined with AI', 'An AI companion that understands you, follows you across the site, and links you to the right program.');
  await sleep(3800);
  await demo('card', '', '', '');
  await sleep(900);

  console.log('1. Landing');
  await caption(1, 'Meet Mia - she runs a small café in Townsville', 'Instead of guessing filters, the Grants Finder now opens with an AI search box.');
  await moveTo(page.locator('gc-hero textarea').first(), 1100);
  await sleep(1500);
  await shot('01-landing-ai-hero');

  const heroInput = page.locator('gc-hero textarea');
  await click(heroInput);
  await caption(2, 'She simply describes her situation', 'Plain English - no need to know program names, agencies or categories.');
  await heroInput.pressSequentially(QUESTION, { delay: 28 });
  await sleep(700);
  await shot('02-ask-in-plain-english');
  let before = await msgCount();
  await click(page.locator('gc-hero button[type=submit]'));

  console.log('2. Answer');
  await caption(3, 'The companion slides in and shows its work', 'A live trace: understanding the request, searching the grants index, writing the answer.');
  await sleep(2600);
  await shot('03-live-reasoning-trace');
  await waitAnswer('Searching every Queensland grant for Mia…', before);
  await caption(4, 'A grounded answer, with official links', 'Every recommendation comes from the Queensland Government grants index - with status, dates and agency.');
  await scrollThreadTo('.msg.bot', -1);
  await sleep(1400);
  await shot('04-grounded-answer');
  await scrollThreadTo('.card', 0, 60);
  await caption(5, 'Top matches as rich, actionable cards', 'Open programs first. Jump to the details page, the official site, or ask a follow-up.');
  await sleep(1600);
  await shot('05-top-match-cards');

  console.log('3. Detail page');
  const firstCard = page.locator(`${panelRoot} .card:has(button.btn.primary)`).first();
  const firstTitle = (await firstCard.locator('h4').textContent())?.trim();
  await click(firstCard.locator('.btn.primary'));
  await page.waitForURL(/service-details/, { timeout: 15000 });
  await sleep(2200);
  await caption(6, 'The conversation follows her across the site', `On "${firstTitle}" the companion knows it's an AI pick - and why.`);
  await moveTo(page.locator('gc-inline .inline-btn.primary'), 900);
  await sleep(1400);
  await shot('06-detail-page-ai-pick');
  before = await msgCount();
  await click(page.locator('gc-inline .inline-btn', { hasText: 'Am I eligible' }));
  await caption(7, 'Context-aware questions, one click away', 'The companion reads the page she is on, so "Am I eligible?" just works.');
  await waitAnswer('Checking eligibility for this program…', before);
  await caption(7, 'An honest eligibility check', 'What is confirmed, what she still needs to check, and the next step.');
  await scrollThreadTo('.msg.user', -1);
  await sleep(1500);
  await shot('07-eligibility-check');

  console.log('4. Results page');
  await caption(8, 'She can still browse the classic way', 'Filtering by "Business" on the original Grants Finder…');
  await click(page.locator('a, button', { hasText: /Back to search/ }).first());
  await sleep(1800);
  if (!(await page.locator('label[for=input-0-0]').count())) {
    await page.goto(SITE, { waitUntil: 'networkidle' });
    await sleep(1200);
  }
  await click(page.locator('label[for=input-0-0]'));
  await sleep(600);
  await shot('08-classic-filters');
  await click(page.locator('.results-button-container button'));
  await page.waitForURL(/results/, { timeout: 15000 });
  await sleep(2600);
  await caption(9, "…and the AI highlights its picks in the site's own results", 'An insights bar summarises how many recommendations are on this page.');
  await moveTo(page.locator('gc-results .inline-btn.primary'), 900);
  await sleep(1200);
  await shot('09-results-ai-insights');
  const picked = page.locator('.gc-picked').first();
  if (await picked.count()) {
    await picked.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy({ top: -260, behavior: 'smooth' }));
    await sleep(1400);
    await moveTo(picked.locator('h2 a').first(), 900);
    await caption(10, 'Recommended programs stand out', 'Badged and outlined right inside the existing results list.');
    await sleep(1400);
    await shot('10-results-ai-pick-highlight');
  }

  console.log('5. Compare');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(900);
  before = await msgCount();
  await click(page.locator('gc-results .inline-btn.primary'));
  await caption(11, '"Which should I apply for first?"', 'The companion compares its own picks for Mia.');
  await waitAnswer('Comparing the recommended programs…', before);
  await scrollThreadTo('.msg.user', -1);
  await caption(11, 'A clear, prioritised plan', 'Grounded in the same live grants data, with links to apply.');
  await sleep(1600);
  await shot('11-compare-and-prioritise');

  console.log('6. Collapse');
  await click(page.locator(`${panelRoot} [data-act=close]`));
  await caption(12, 'Out of the way when she does not need it', 'The companion tucks into an edge tab (Alt+G) and remembers the whole conversation.');
  await sleep(1800);
  await moveTo(page.locator(`${panelRoot} .tab`), 900);
  await sleep(900);
  await shot('12-collapsed-edge-tab');
  await caption();
  await demo('card', 'Art of the possible', 'Find the right grant in minutes, not hours', 'Microsoft Foundry agent · Azure AI Search (FoundryIQ) · live Queensland Government grant data');
  await sleep(4200);

  if (cdp) await cdp.send('Page.stopScreencast').catch(() => {});
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });

  if (VIDEO) await encode(frames, speeds, Date.now() - t0);
}

const LIST = path.join(FRAMES, 'list.json');
const FPS = 30;

async function encode(frames, speeds, end) {
  if (!frames.length) return console.warn('No frames captured.');
  const factorAt = (t) => speeds.filter((s) => s.t <= t).at(-1).f;
  const list = frames.map((f, i) => {
    const next = frames[i + 1]?.t ?? Math.min(f.t + 1500, end);
    return { file: f.file, d: (next - f.t) / factorAt(f.t) / 1000 };
  });
  fs.writeFileSync(LIST, JSON.stringify(list));
  await encodeList(list);
}

// Pipes the variable-rate screencast frames into ffmpeg as a constant-rate MJPEG stream.
async function encodeList(list) {
  const x264 = findFfmpeg();
  const bin = x264 ?? playwrightFfmpeg();
  if (!bin) return console.warn(`No ffmpeg found. Frames kept in ${FRAMES}`);
  const out = path.join(REC, x264 ? 'grants-ai-companion-journey.mp4' : 'grants-ai-companion-journey.webm');
  const input = ['-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0'];
  const args = x264
    ? [...input, '-vf', `scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart', out]
    : [...input, '-vf', `scale=${W}:${H}`, '-c:v', 'libvpx', '-b:v', '8M', '-qmin', '0', '-qmax', '30', '-deadline', 'good', out];

  let total = 0;
  const plan = [];
  let clock = 0;
  for (const f of list) {
    clock += f.d;
    const until = Math.round(clock * FPS);
    while (total < until) (plan.push(f.file), total++);
  }
  console.log(`Encoding ${(total / FPS).toFixed(0)}s of video (${x264 ? 'H.264 MP4' : 'VP8 WebM'})…`);

  const proc = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
  function* buffers() {
    let cached = [null, null];
    for (const file of plan) {
      if (cached[0] !== file) cached = [file, fs.readFileSync(file)];
      yield cached[1];
    }
  }
  try {
    const [, [code]] = await Promise.all([pipeline(Readable.from(buffers()), proc.stdin), once(proc, 'close')]);
    if (code !== 0) throw new Error(`Video encoding failed (${code}): ${stderr}`);
  } finally {
    if (proc.pid && proc.exitCode === null && !proc.killed) {
      const closed = once(proc, 'close');
      proc.kill();
      await closed;
    }
  }
  fs.rmSync(FRAMES, { recursive: true, force: true });
  console.log('🎬', out);
}

function playwrightFfmpeg() {
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'ms-playwright');
  const dir = fs.existsSync(base) && fs.readdirSync(base).find((d) => d.startsWith('ffmpeg-'));
  const exe = dir && fs.readdirSync(path.join(base, dir)).find((f) => f.startsWith('ffmpeg'));
  return exe ? path.join(base, dir, exe) : null;
}

const run = process.argv.includes('--encode-only') ? () => encodeList(JSON.parse(fs.readFileSync(LIST, 'utf8'))) : main;
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
