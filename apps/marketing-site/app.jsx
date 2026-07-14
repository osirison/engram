/* app.jsx — Engram marketing site.
 * Exports <App/> with no module-level side effects so it can render in two
 * places: the browser (main.jsx) and the build-time prerender (entry-server.jsx
 * via prerender.mjs). Everything browser-only (MemoryHaze, scroll listeners,
 * dev tweaks) stays effect-scoped and never runs during renderToString. */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MemoryHaze } from './memory-haze.js';

// Dev-only tweaks UI. `import.meta.env.DEV` is statically false in production
// builds, so Rollup drops the dynamic import and the panel never ships to
// visitors (verify: `grep -c twk-panel dist/assets/*.js` → 0 after build).
const DevTweaks = import.meta.env.DEV
  ? React.lazy(() => import('./dev-tweaks.jsx'))
  : null;

// Illustrative agent memories — these surface on recall/hover.
const SEED_MEMORIES = [
  "the user prefers terse answers, no preamble",
  "prod API key rotates every 90 days",
  "she moved the launch to Friday",
  "staging db is read-only on weekends",
  "their timezone is JST (UTC+9)",
  "the logo keeps 24px of clearspace",
  "never force-push to main",
  "invoice totals are in EUR, not USD",
];

const PLACEHOLDERS = [
  "she prefers concise answers",
  "the API key rotates every 90 days",
  "the deadline moved to Friday",
  "deploy only after 10am",
  "her name is spelled Sarah, not Sara",
];

// ---- wordmark + chrome ----------------------------------------------------
function Chrome() {
  return (
    <header className="chrome">
      <div className="mark">
        <span className="mark-dot" />
        <span className="mark-word">engram</span>
      </div>
      <nav className="chrome-nav">
        <a href="/docs/">docs</a>
        <span className="chrome-sep">/</span>
        <a href="https://github.com/osirison/engram" target="_blank" rel="noopener">source</a>
        <span className="chrome-sep">/</span>
        <a href="#install">connect</a>
      </nav>
    </header>
  );
}

// ---- the one line: hero ----------------------------------------------------
function Hero({ haze }) {
  const [value, setValue] = useState("");
  const [ph, setPh] = useState(0);
  const [stored, setStored] = useState([]);     // user-added
  const [flash, setFlash] = useState(null);      // "remembered." confirmation
  const [surfaced, setSurfaced] = useState(null); // recalled memory text
  const inputRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setPh((p) => (p + 1) % PLACEHOLDERS.length), 3200);
    return () => clearInterval(id);
  }, []);

  const remember = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    const el = inputRef.current;
    if (el && haze) {
      const r = el.getBoundingClientRect();
      haze.addMemory(text, r.left + r.width * 0.5, r.top + r.height * 0.5);
    }
    setStored((s) => [text, ...s].slice(0, 24));
    setValue("");
    setFlash(text);
    setTimeout(() => setFlash(null), 1900);
  }, [value, haze]);

  const recall = useCallback(() => {
    let pick = null;
    if (haze) {
      const frag = haze.recall();
      if (frag) pick = frag.el.querySelector(".haze-txt").textContent;
    }
    if (!pick) {
      const pool = stored.length ? stored : SEED_MEMORIES;
      pick = pool[Math.floor(Math.random() * pool.length)];
    }
    setSurfaced(pick);
    setTimeout(() => setSurfaced((cur) => (cur === pick ? null : cur)), 2600);
  }, [stored, haze]);

  return (
    <section className="hero section" data-mode="idle" data-screen-label="hero">
      <div className="hero-inner">
        <p className="eyebrow">memory for machines</p>
        <h1 className="hero-line">
          Your agent forgets<br />everything.
        </h1>
        <p className="hero-sub">Give it one thing it should never forget.</p>

        <div className="prompt">
          <span className="prompt-caret" aria-hidden="true">&gt;</span>
          <input
            ref={inputRef}
            className="prompt-input"
            value={value}
            spellCheck="false"
            autoComplete="off"
            aria-label="Type a memory to remember"
            placeholder={PLACEHOLDERS[ph]}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") remember(); }}
          />
          <button className="prompt-go" onClick={remember} aria-label="remember">
            remember
          </button>
        </div>

        <div className="hero-foot">
          <div className={"flash" + (flash ? " on" : "")} role="status">
            {flash ? <span><em>remembered.</em> “{truncate(flash, 52)}”</span> : <span>&nbsp;</span>}
          </div>
          <button className="recall-link" onClick={recall}>
            recall ↩
          </button>
        </div>
      </div>

      <div className={"surfaced" + (surfaced ? " on" : "")} role="status">
        {surfaced && (
          <div className="surfaced-card">
            <span className="surfaced-label">recalled by meaning</span>
            <span className="surfaced-text">“{surfaced}”</span>
          </div>
        )}
      </div>

      <div className="verbs-ghost">
        <span>remember</span><span>·</span><span>recall</span><span>·</span>
        <span>forget</span><span>·</span><span>reflect</span>
      </div>
      <div className="scroll-cue"><span>deeper</span><i /></div>
    </section>
  );
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ---- a single descent panel ------------------------------------------------
function Panel({ mode, index, kicker, line, sub, label, children }) {
  return (
    <section className="section panel" data-mode={mode} data-screen-label={label}>
      <div className="panel-inner">
        <span className="panel-index">{index}</span>
        <p className="kicker">{kicker}</p>
        <h2 className="panel-line">{line}</h2>
        <p className="panel-sub">{sub}</p>
        {children}
      </div>
    </section>
  );
}

// ---- the four verbs --------------------------------------------------------
const VERBS = [
  { v: "remember", g: "Store a fact, a preference, an outcome. One call." },
  { v: "recall", g: "Retrieve by meaning, not by keyword. The right memory, in context." },
  { v: "forget", g: "Let what no longer matters decay. On purpose." },
  { v: "reflect", g: "Consolidate scattered moments into durable understanding." },
];

function Verbs() {
  return (
    <section className="section verbs" data-mode="long" data-screen-label="verbs">
      <div className="verbs-inner">
        <p className="kicker center">four verbs. the heart of the interface.</p>
        <ul className="verbs-list">
          {VERBS.map((it) => (
            <li key={it.v} className="verb-row">
              <span className="verb-word">{it.v}</span>
              <span className="verb-gloss">{it.g}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---- install / close -------------------------------------------------------
function Install() {
  const [copied, setCopied] = useState(false);
  const cmd = "git clone https://github.com/osirison/engram && cd engram";
  const copy = () => {
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };
  return (
    <section className="section install" id="install" data-mode="idle" data-screen-label="install">
      <div className="install-inner">
        <h2 className="install-line">One memory layer.<br />Every agent.</h2>
        <p className="install-sub">
          Engram is an MCP server. It plugs into Claude, Cursor, or anything that speaks
          the protocol. Clone, run one profile, connect.
        </p>
        <button className="cmd" onClick={copy}>
          <span className="cmd-caret">$</span>
          <span className="cmd-text">{cmd}</span>
          <span className="cmd-copy">{copied ? "copied" : "copy"}</span>
        </button>
        <div className="install-foot">
          <a href="https://github.com/osirison/engram" target="_blank" rel="noopener">github.com/osirison/engram</a>
          <span className="chrome-sep">·</span>
          <a href="https://github.com/osirison/engram#choose-your-profile" target="_blank" rel="noopener">quickstart: choose your profile</a>
          <span className="chrome-sep">·</span>
          <span>open source · MCP-native</span>
        </div>
      </div>
      <div className="endmark">
        <span className="mark-dot" />
        <span>engram</span>
        <em>the trace a memory leaves behind</em>
      </div>
    </section>
  );
}

// ---- app -------------------------------------------------------------------
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "resolveOnScroll": false,
  "blur": 11,
  "lanternRadius": 300,
  "lanternStrength": 1.0,
  "floatSpeed": 1.0,
  "geoOpacity": 1.0,
  "geoShape": "cycle",
  "idleDrift": true
}/*EDITMODE-END*/;

function App() {
  const [haze, setHaze] = useState(null);

  useEffect(() => {
    const root = document.getElementById("haze");
    const h = new MemoryHaze(root, {
      fragments: 26, motes: 90,
      // memories must never sit on top of these — readable copy stays clear
      exclude: ".chrome .mark, .chrome-nav, .eyebrow, .hero-line, .hero-sub, .prompt, .hero-foot, .panel-index, .kicker, .panel-line, .panel-sub, .verb-row, .install-line, .install-sub, .cmd, .install-foot, .verbs-ghost, .scroll-cue, .endmark, .surfaced-card",
    });
    h.set(TWEAK_DEFAULTS);
    h.start();
    if (import.meta.env.DEV) window.__haze = h; // debug handle, dev builds only
    setHaze(h);

    // walk the focal plane forward as you scroll: haze -> clarity
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const p = max > 0 ? window.scrollY / max : 0;
        h.setProgress(p);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => { window.removeEventListener("scroll", onScroll); h.stop(); };
  }, []);

  return (
    <React.Fragment>
      <Chrome />
      <Hero haze={haze} />
      <Panel
        index="01" mode="short" label="short-term"
        kicker="short-term memory"
        line={<>It holds the<br />conversation.</>}
        sub="Working memory, milliseconds deep. Fast, volatile, and gone the moment it stops mattering, exactly like yours."
      />
      <Panel
        index="02" mode="long" label="long-term"
        kicker="long-term memory"
        line={<>It keeps the<br />meaning.</>}
        sub="Memories are embedded and stored by what they mean, then recalled by meaning, not by matching words. Search becomes understanding."
      />
      <Panel
        index="03" mode="dream" label="dream"
        kicker="while idle, it dreams"
        line={<>It sleeps on<br />what it learned.</>}
        sub="On demand, Engram consolidates: short-term memories that keep proving useful become long-term. It deduplicates new memories as they arrive, lets the trivial decay on a schedule, and spots contradictions, flagging both sides for review. It wakes up sharper than it went to sleep."
      />
      <Verbs />
      <Install />
      {import.meta.env.DEV && DevTweaks && (
        <React.Suspense fallback={null}>
          <DevTweaks haze={haze} defaults={TWEAK_DEFAULTS} />
        </React.Suspense>
      )}
    </React.Fragment>
  );
}

export default App;

