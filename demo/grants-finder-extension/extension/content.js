// Content script: renders the AI companion on the Queensland Grants Finder (in Shadow DOM so site CSS can't leak in)
// and decorates the site's own pages (AI hero on the landing page, "Ask AI" bar on grant details, "AI pick" badges
// on results). All chat state lives in chrome.storage (owned by background.js), so the UI survives navigation.
(() => {
  if (globalThis.__gcLoaded) return;
  globalThis.__gcLoaded = true;

  const KEY = 'gc';
  const CSS_URL = chrome.runtime.getURL('panel.css');
  const md = globalThis.GCMarkdown;

  // ---------------------------------------------------------------- icons (Lucide-style, stroke based)
  const ICONS = {
    sparkles:
      '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    close: '<path d="m9 18 6-6-6-6"/><path d="M15 6v12" opacity="0"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    landmark: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    coffee: '<path d="M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1M6 2v2"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0z"/>',
    sprout: '<path d="M7 20h10M10 20c5.5-2.5.8-6.4 3-10M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8zM14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
  };
  const icon = (name, size = 16) =>
    `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  // ---------------------------------------------------------------- helpers
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'html') el.innerHTML = v; // only ever used with static markup/icons
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...children.filter((c) => c != null && c !== false));
    return el;
  }

  function shadowHost(tag) {
    const host = document.createElement(tag);
    const root = host.attachShadow({ mode: 'open' });
    root.append(h('link', { rel: 'stylesheet', href: CSS_URL }));
    return { host, root };
  }

  const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
  const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Brisbane' });
  const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

  const msg = (payload) => chrome.runtime.sendMessage(payload).catch(() => {});

  const STARTERS = [
    { icon: 'coffee', label: 'Café owner hiring an apprentice', text: 'I run a small café in Townsville and want to take on my first apprentice. What support can I get?' },
    { icon: 'trophy', label: 'Sports club looking for funding', text: 'Which grants for community sports clubs are open right now, and when do they close?' },
    { icon: 'sprout', label: 'Farmer dealing with drought', text: "I'm a cattle farmer in western Queensland dealing with drought. What assistance is available?" },
  ];

  // ---------------------------------------------------------------- state
  let state = { open: false, busy: false, messages: [], picks: {} };
  let ctx = pageContext();

  function pageContext() {
    const detail = /^\/service-details\/(\d+)/.exec(location.pathname) ?? /service-details\/(\d+)/.exec(location.hash);
    if (detail) {
      const title = document.querySelector('.full-view__title')?.textContent.trim();
      const status = document.querySelector('.full-view__body .badge')?.textContent.trim();
      return {
        kind: 'detail',
        id: detail[1],
        title,
        label: title || 'Grant details',
        prompt: title
          ? `[Website context, added by the Grants Finder page: the user is viewing the details page for "${title}" (grant id ${detail[1]}${status ? `, status ${status}` : ''}). "This grant" refers to it.]`
          : null,
      };
    }
    if (location.pathname.startsWith('/results')) {
      const h1 = document.querySelector('.results-page h1')?.textContent.trim().replace(/\.$/, '');
      return {
        kind: 'results',
        label: h1 ? `Search results · ${h1}` : 'Search results',
        prompt: h1 ? `[Website context, added by the Grants Finder page: the user is looking at a filtered results list ("${h1}").]` : null,
      };
    }
    return { kind: 'home', label: 'Grants Finder home', prompt: null };
  }

  function ask(text, { withContext = true } = {}) {
    if (!text?.trim() || state.busy) return;
    const context = withContext && ctx.kind !== 'home' ? { label: ctx.label, prompt: ctx.prompt } : null;
    state.open = true;
    renderShell();
    msg({ type: 'send', text: text.trim(), context });
  }

  function navigate(path) {
    if (location.pathname === path) return window.scrollTo({ top: 0, behavior: 'smooth' });
    // Drive the site's own Vue router so navigation is instant and the page never reloads.
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      if (location.pathname === path && !document.querySelector('.full-view__title, .results-page, form.qg-forms-v2')) location.assign(path);
    }, 2500);
  }

  function wireLink(a, href) {
    try {
      const u = new URL(href);
      if (u.origin === location.origin) {
        a.removeAttribute('target');
        a.addEventListener('click', (e) => {
          e.preventDefault();
          navigate(u.pathname + u.search);
        });
      }
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- page-level styles (docking + badges)
  document.head.append(
    h('style', { id: 'gc-page-style' }, `
      html body { transition: margin-right .45s cubic-bezier(.2,.8,.2,1); }
      @media (min-width: 1180px) { html.gc-docked body { margin-right: 460px !important; } }
      .gc-picked { position: relative; outline: 2px solid rgba(109,75,216,.55); outline-offset: 6px; border-radius: 4px;
        box-shadow: 0 18px 40px -22px rgba(109,75,216,.7); animation: gc-pick-in .8s ease both; }
      @keyframes gc-pick-in { from { outline-color: rgba(109,75,216,0); box-shadow: none; } }
    `),
  );

  // ---------------------------------------------------------------- companion panel
  const { host: appHost, root } = shadowHost('gc-companion');
  appHost.style.cssText = 'position:fixed;inset:auto;z-index:2147483000;';
  document.documentElement.append(appHost);

  const tab = h('button', {
    class: 'tab',
    'aria-label': 'Open the Grants AI companion (Alt+G)',
    html: `<span class="tab-ring"></span>${icon('sparkles', 20)}<span class="tab-text">Ask Grants AI</span>`,
    onclick: () => {
      state.open = true;
      renderShell();
      msg({ type: 'setOpen', open: true });
    },
  });

  const panel = h('aside', { class: 'panel', role: 'complementary', 'aria-label': 'Grants AI companion' });
  panel.innerHTML = `
    <header class="head">
      <div class="aurora"></div>
      <div class="brand">
        <div class="avatar">${icon('sparkles', 20)}</div>
        <div>
          <div class="title">Queensland Grants Finder</div>
          <div class="sub"><span class="live"></span>AI companion · live Queensland Government data</div>
        </div>
      </div>
      <div class="head-actions">
        <button class="icon-btn" data-act="reset" title="Start a new conversation">${icon('rotate')}</button>
        <button class="icon-btn" data-act="close" title="Hide (Alt+G)">${icon('close', 18)}</button>
      </div>
    </header>
    <div class="context"><span class="ctx-icon"></span><span class="ctx-text"></span><span class="ctx-pick"></span></div>
    <div class="scroll">
      <div class="empty">
        <div class="hello">
          <div class="orb">${icon('sparkles', 28)}</div>
          <h3>G'day! What can I help you find?</h3>
          <p>Tell me about yourself or your organisation and what you need. I'll search every Queensland Government grant, rebate and assistance program for you.</p>
        </div>
        <div class="starters"></div>
      </div>
      <div class="thread" aria-live="polite"></div>
    </div>
    <div class="chips"></div>
    <form class="composer">
      <textarea rows="1" placeholder="Ask about grants, eligibility or deadlines…" aria-label="Message the Grants AI companion"></textarea>
      <button class="send" type="submit" aria-label="Send">${icon('arrowUp', 18)}</button>
    </form>
    <div class="foot">AI-generated from Queensland Government grant data. Always confirm details on the official page before applying.</div>`;

  const $ = (sel) => panel.querySelector(sel);
  const thread = $('.thread');
  const scroller = $('.scroll');
  const input = $('textarea');

  for (const s of STARTERS) {
    $('.starters').append(
      h('button', { class: 'starter', onclick: () => ask(s.text, { withContext: false }) },
        h('span', { class: 'starter-icon', html: icon(s.icon, 18) }),
        h('span', { class: 'starter-text' }, h('strong', {}, s.label), h('span', {}, s.text)),
        h('span', { class: 'starter-go', html: icon('arrowRight', 16) }),
      ),
    );
  }

  $('[data-act=close]').addEventListener('click', () => {
    state.open = false;
    renderShell();
    msg({ type: 'setOpen', open: false });
  });
  $('[data-act=reset]').addEventListener('click', () => msg({ type: 'reset' }));

  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('.composer').requestSubmit();
    }
  });
  $('.composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.busy || !input.value.trim()) return;
    ask(input.value);
    input.value = '';
    grow();
  });

  root.append(h('div', { class: 'app' }, tab, panel));

  // ---------------------------------------------------------------- rendering
  function renderShell() {
    const app = root.querySelector('.app');
    app.classList.toggle('open', !!state.open);
    document.documentElement.classList.toggle('gc-docked', !!state.open);
  }

  function renderContext() {
    const ic = { home: 'home', results: 'list', detail: 'file' }[ctx.kind];
    $('.ctx-icon').innerHTML = icon(ic, 14);
    $('.ctx-text').textContent = ctx.kind === 'detail' ? `Viewing: ${ctx.label}` : ctx.label;
    const pick = ctx.kind === 'detail' && state.picks?.[ctx.id];
    $('.ctx-pick').innerHTML = pick ? `${icon('sparkles', 12)} AI pick` : '';
    $('.context').classList.remove('flash');
    void $('.context').offsetWidth;
    $('.context').classList.add('flash');
  }

  function chipSet() {
    if (ctx.kind === 'detail') return ['Am I eligible for this grant?', 'Explain this grant in plain English', 'Find similar grants that are open now'];
    if (!state.messages.length) return [];
    if (ctx.kind === 'results') return ['Which of these results fit me best?', 'Only show grants that are open now'];
    return ['Only show grants that are open now', 'What should I prepare before applying?', 'Which one offers the most funding?'];
  }

  function renderChips() {
    const box = $('.chips');
    box.replaceChildren();
    const last = state.messages[state.messages.length - 1];
    if (state.busy || last?.status === 'error') return;
    for (const c of chipSet()) {
      box.append(h('button', { class: 'chip', onclick: () => ask(c) }, h('span', { html: icon('sparkles', 12) }), c));
    }
  }

  const nodes = new Map();

  function renderThread() {
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
    const restoring = nodes.size === 0 && state.messages.length > 0;
    const ids = new Set(state.messages.map((m) => m.id));
    for (const [id, el] of nodes) if (!ids.has(id)) (el.remove(), nodes.delete(id));
    let added = false;
    for (const m of state.messages) {
      let el = nodes.get(m.id);
      if (!el) {
        el = h('div');
        nodes.set(m.id, el);
        thread.append(el);
        added = true;
      }
      m.role === 'user' ? renderUser(el, m) : renderBot(el, m);
    }
    $('.empty').hidden = state.messages.length > 0;
    $('.send').disabled = !!state.busy;
    $('.composer').classList.toggle('busy', !!state.busy);
    if (restoring) {
      const pin = () => { scroller.scrollTop = scroller.scrollHeight; };
      pin();
      requestAnimationFrame(pin);
      setTimeout(pin, 450);
    } else if (added || nearBottom) scroller.scrollTo({ top: scroller.scrollHeight, behavior: added ? 'smooth' : 'auto' });
  }

  function renderUser(el, m) {
    if (el.dataset.built) return;
    el.dataset.built = '1';
    el.className = 'msg user';
    if (m.context) el.append(h('div', { class: 'user-ctx', html: icon('file', 11) }, trunc(m.context, 60)));
    el.append(h('div', { class: 'bubble' }, m.text));
  }

  function renderBot(el, m) {
    if (!el.dataset.built) {
      el.dataset.built = '1';
      el.className = 'msg bot';
      el.innerHTML = `<div class="bot-avatar">${icon('sparkles', 14)}</div><div class="bot-body"><div class="trace"></div><div class="md"></div><div class="cards"></div><div class="err"></div></div>`;
    }
    const part = (sel, sig, fn) => {
      const node = el.querySelector(sel);
      if (node.dataset.sig !== sig) {
        node.dataset.sig = sig;
        fn(node);
      }
    };

    part('.trace', JSON.stringify([m.status, m.steps]), (node) => {
      node.replaceChildren();
      const done = m.status === 'done';
      const details = h('details', { class: `trace-box ${done ? 'done' : ''}`, open: !done && m.status !== 'error' });
      const secs = m.elapsedMs ? ` · ${(m.elapsedMs / 1000).toFixed(1)}s` : '';
      const search = m.steps.find((s) => s.key === 'search');
      details.append(
        h('summary', {
          html: done
            ? `${icon('check', 14)}<span>${search ? 'Searched Queensland grants' : 'Answered'}${search?.label ? ` · ${search.label.replace(/^Reviewed /, '')}` : ''}${secs}</span>${icon('chevron', 14)}`
            : `<span class="spinner"></span><span>Working on it…</span>`,
        }),
      );
      const ol = h('ol');
      for (const s of m.steps) {
        const ic = { understand: 'bulb', search: 'search', write: 'pen' }[s.key];
        ol.append(
          h('li', { class: s.state },
            h('span', { class: 'step-icon', html: s.state === 'active' ? '<span class="spinner"></span>' : icon(ic, 14) }),
            h('span', { class: 'step-text' }, s.label ?? '', s.detail ? h('em', {}, `“${trunc(s.detail, 120)}”`) : null),
          ),
        );
      }
      details.append(ol);
      node.append(details);
    });

    part('.md', `${m.text.length}:${m.status}`, (node) => {
      node.replaceChildren(md.render(m.text, { onLink: wireLink }));
      if (m.status === 'streaming') {
        const tail = node.lastElementChild?.matches('ul,ol') ? node.lastElementChild.lastElementChild : node.lastElementChild;
        (tail ?? node).append(h('span', { class: 'caret' }));
      }
    });

    part('.cards', `${m.status}:${m.grants?.map((g) => g.id).join(',')}`, (node) => {
      node.replaceChildren();
      if (m.status !== 'done' || !m.grants?.length) return;
      node.append(h('div', { class: 'cards-head', html: `${icon('sparkles', 14)}<span>Top matches</span><b>${m.grants.length}</b>` }));
      m.grants.forEach((g, i) => node.append(card(g, i)));
    });

    part('.err', m.error ?? '', (node) => {
      node.replaceChildren();
      if (!m.error) return;
      node.append(
        h('div', { class: 'error', html: icon('alert', 16) }, h('span', {}, m.error)),
        h('button', { class: 'chip', onclick: () => msg({ type: 'retry', context: ctx.kind !== 'home' ? { label: ctx.label, prompt: ctx.prompt } : null }) }, 'Try again'),
      );
    });
  }

  function card(g, i) {
    const detailsPath = g.source === 'Queensland Grants Finder' && /^\d+$/.test(g.id) ? `/service-details/${g.id}` : null;
    const closing = g.closingDate ? new Date(g.closingDate) : null;
    const when = closing
      ? `${closing < new Date() ? 'Closed' : 'Closes'} ${fmtDate(g.closingDate)}`
      : g.isOpen
        ? 'Ongoing / no closing date'
        : null;
    const statusClass = g.isOpen ? 'open' : /closed/i.test(g.status) ? 'closed' : 'other';
    return h('article', { class: 'card', style: `--i:${i}` },
      h('div', { class: 'card-top' },
        h('span', { class: `status ${statusClass}` }, h('i'), g.status || (g.isOpen ? 'Open' : 'Unknown')),
        g.type ? h('span', { class: 'type' }, g.type) : null,
      ),
      h('h4', {}, g.title),
      g.summary ? h('p', { class: 'card-sum' }, g.summary) : null,
      h('div', { class: 'meta' },
        g.amount !== null ? h('span', { html: icon('coins', 13) }, aud.format(g.amount)) : null,
        when ? h('span', { html: icon('calendar', 13) }, when) : null,
        g.agency ? h('span', { html: icon('landmark', 13) }, g.agency) : null,
      ),
      h('div', { class: 'card-actions' },
        detailsPath
          ? h('button', { class: 'btn primary', onclick: () => navigate(detailsPath), html: `View details ${icon('arrowRight', 14)}` })
          : g.url ? h('a', { class: 'btn primary', href: g.url, target: '_blank', rel: 'noopener noreferrer',
            html: `${g.source === 'business.gov.au' ? 'View on business.gov.au' : 'Official site'} ${icon('external', 13)}` }) : null,
        g.url && detailsPath
          ? h('a', { class: 'btn', href: g.url, target: '_blank', rel: 'noopener noreferrer', html: `Official site ${icon('external', 13)}` }) : null,
        h('button', { class: 'btn ghost', title: 'Ask about this grant', onclick: () => ask(`Tell me more about "${g.title}" - who is eligible and how do I apply?`, { withContext: false }), html: `${icon('message', 13)} Ask` }),
      ),
    );
  }

  function renderAll() {
    renderShell();
    renderContext();
    renderThread();
    renderChips();
    decorate();
  }

  // ---------------------------------------------------------------- site decorations
  let hero = null;
  let inlineBar = null;
  let resultsBar = null;

  function heroEl() {
    const { host, root: r } = shadowHost('gc-hero');
    host.style.display = 'block';
    const wrap = h('section', { class: 'hero' });
    wrap.innerHTML = `
      <div class="hero-bg"></div>
      <div class="hero-inner">
        <div class="eyebrow">${icon('sparkles', 14)} New · AI-powered grant search</div>
        <h2>Tell us what you need, in your own words.</h2>
        <p>Skip the checklists. Describe yourself or your organisation, and our AI companion will search every Queensland Government grant, rebate and assistance program for you.</p>
        <form class="hero-form">
          <span class="hero-search">${icon('search', 20)}</span>
          <textarea rows="2" aria-label="Describe what you need"></textarea>
          <button type="submit">Find my grants ${icon('arrowRight', 16)}</button>
        </form>
        <div class="hero-chips"><span>Try</span></div>
        <div class="hero-alt">Prefer to browse? Use the checklist below.</div>
      </div>`;
    const ta = wrap.querySelector('textarea');
    for (const s of STARTERS) {
      wrap.querySelector('.hero-chips').append(
        h('button', { type: 'button', class: 'hero-chip', onclick: () => ask(s.text, { withContext: false }), html: icon(s.icon, 14) }, s.label),
      );
    }
    wrap.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!ta.value.trim()) return ta.focus();
      ask(ta.value, { withContext: false });
      ta.value = '';
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        wrap.querySelector('form').requestSubmit();
      }
    });
    // Typewriter placeholder cycling through example requests.
    let n = 0;
    let c = 0;
    const tick = () => {
      if (!host.isConnected) return void setTimeout(tick, 500);
      const full = `e.g. ${STARTERS[n % STARTERS.length].text}`;
      ta.placeholder = full.slice(0, c);
      if (c < full.length) (c += 2), setTimeout(tick, 28);
      else setTimeout(() => ((c = 0), n++, tick()), 2600);
    };
    setTimeout(tick, 400);
    r.append(wrap);
    return host;
  }

  function inlineBarEl(id) {
    const { host, root: r } = shadowHost('gc-inline');
    host.style.display = 'block';
    host.dataset.id = id;
    const pick = state.picks?.[id];
    r.append(
      h('div', { class: 'inline' },
        pick ? h('div', { class: 'pick', html: icon('sparkles', 14) }, h('span', {}, 'AI pick for '), h('q', {}, trunc(pick.question, 70))) : null,
        h('div', { class: 'inline-actions' },
          h('button', { class: 'inline-btn primary', onclick: () => ask('Explain this grant in plain English'), html: `${icon('sparkles', 15)} Ask AI about this grant` }),
          h('button', { class: 'inline-btn', onclick: () => ask('Am I eligible for this grant?') }, 'Am I eligible?'),
          h('button', { class: 'inline-btn', onclick: () => ask('Find similar grants that are open now') }, 'Find similar open grants'),
        ),
      ),
    );
    return host;
  }

  function resultsBarEl(pickedHere, totalPicks) {
    const { host, root: r } = shadowHost('gc-results');
    host.style.display = 'block';
    host.dataset.sig = `${pickedHere}/${totalPicks}`;
    r.append(
      h('div', { class: 'results-bar' },
        h('span', { class: 'rb-icon', html: icon('sparkles', 18) }),
        h('div', { class: 'rb-text' },
          h('strong', {}, pickedHere ? `${pickedHere} of your AI picks ${pickedHere === 1 ? 'is' : 'are'} in these results` : 'Too many results to read?'),
          h('span', {}, pickedHere ? "They're highlighted below. Ask the companion to compare them or narrow things down." : 'Describe your situation and let the AI companion shortlist the best fits for you.'),
        ),
        h('button', { class: 'inline-btn primary', onclick: () => (pickedHere ? ask('Compare the grants you recommended - which should I apply for first? Focus on the ones that are open now.') : openAndFocus()), html: `${icon('sparkles', 15)} ${pickedHere ? 'Compare my picks' : 'Ask AI'}` }),
      ),
    );
    return host;
  }

  function openAndFocus() {
    state.open = true;
    renderShell();
    msg({ type: 'setOpen', open: true });
    setTimeout(() => input.focus(), 350);
  }

  function decorate() {
    // Landing page: AI hero above the checklist.
    const main = document.querySelector('#qg-primary-content');
    const onHome = ctx.kind === 'home' && document.querySelector('form.qg-forms-v2');
    if (onHome && main && !(hero?.isConnected && main.contains(hero))) {
      hero ??= heroEl();
      main.prepend(hero);
    } else if (!onHome && hero?.isConnected) hero.remove();

    // Grant details: "Ask AI" bar under the title.
    const titleRow = document.querySelector('.full-view__title')?.closest('.row');
    if (ctx.kind === 'detail' && titleRow) {
      const want = `${ctx.id}:${!!state.picks?.[ctx.id]}`;
      if (!inlineBar?.isConnected || inlineBar.dataset.key !== want || inlineBar.previousElementSibling !== titleRow) {
        inlineBar?.remove();
        inlineBar = inlineBarEl(ctx.id);
        inlineBar.dataset.key = want;
        titleRow.after(inlineBar);
      }
    } else if (inlineBar?.isConnected) inlineBar.remove();

    // Results: highlight grants the companion recommended.
    if (ctx.kind === 'results') {
      let pickedHere = 0;
      for (const item of document.querySelectorAll('.service-result-item')) {
        const id = /service-details\/(\d+)/.exec(item.querySelector('h2 a')?.getAttribute('href') ?? '')?.[1];
        const pick = id && state.picks?.[id];
        if (pick) pickedHere++;
        if (pick && !item.classList.contains('gc-picked')) {
          item.classList.add('gc-picked');
          const { host, root: r } = shadowHost('gc-pick');
          r.append(h('span', { class: 'pick-badge', title: `Recommended for: ${pick.question}`, html: icon('sparkles', 12) }, 'AI pick'));
          item.querySelector('.mb-2')?.append(host);
        } else if (!pick) {
          item.classList.remove('gc-picked');
          item.querySelector('gc-pick')?.remove();
        }
      }
      const list = document.querySelector('.results-section');
      const sig = `${pickedHere}/${Object.keys(state.picks ?? {}).length}`;
      if (list && (!resultsBar?.isConnected || resultsBar.dataset.sig !== sig)) {
        resultsBar?.remove();
        resultsBar = resultsBarEl(pickedHere, Object.keys(state.picks ?? {}).length);
        list.before(resultsBar);
      }
    } else if (resultsBar?.isConnected) resultsBar.remove();
  }

  // ---------------------------------------------------------------- wiring
  let lastHref = location.href;
  let lastLabel = ctx.label;
  function onPageChange() {
    const next = pageContext();
    const changed = next.label !== lastLabel || location.href !== lastHref;
    ctx = next;
    lastHref = location.href;
    if (changed) {
      lastLabel = ctx.label;
      renderContext();
      renderChips();
    }
    decorate();
  }

  let debounce;
  new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(onPageChange, 120);
  }).observe(document.body, { childList: true, subtree: true });
  setInterval(() => location.href !== lastHref && onPageChange(), 300);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    const prevPicks = JSON.stringify(state.picks);
    state = changes[KEY].newValue ?? { open: false, busy: false, messages: [], picks: {} };
    renderShell();
    renderThread();
    renderChips();
    if (JSON.stringify(state.picks) !== prevPicks) {
      renderContext();
      decorate();
    }
  });

  chrome.storage.local.get(KEY).then((s) => {
    state = s[KEY] ?? state;
    renderAll();
  });
  renderAll();
})();
