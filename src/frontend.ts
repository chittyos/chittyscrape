import { html } from 'hono/html';

export function renderDashboard() {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ChittyScrape // Mission Control</title>
<style>
/* ── Reset & Base ─────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root {
  --bg: #0a0a0f;
  --surface: #12121a;
  --surface2: #1a1a28;
  --border: #2a2a3a;
  --border-glow: #3a3a5a;
  --text: #e8e8f0;
  --text-dim: #8888a0;
  --text-muted: #555568;
  --accent: #6c5ce7;
  --accent-glow: #a29bfe;
  --green: #00e676;
  --green-dim: #00c853;
  --amber: #ffab00;
  --red: #ff5252;
  --cyan: #00e5ff;
  --mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --radius: 12px;
  --radius-sm: 8px;
}
html { font-size: 14px; }
body {
  font-family: var(--sans);
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent-glow); text-decoration: none; }
button { cursor: pointer; font-family: inherit; }

/* ── Ambient Background ───────────────────────────────────────── */
.ambient {
  position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
}
.ambient::before {
  content: '';
  position: absolute;
  top: -40%; left: -20%;
  width: 80vw; height: 80vw;
  background: radial-gradient(circle, rgba(108,92,231,0.06) 0%, transparent 70%);
  animation: drift 25s ease-in-out infinite;
}
.ambient::after {
  content: '';
  position: absolute;
  bottom: -30%; right: -10%;
  width: 60vw; height: 60vw;
  background: radial-gradient(circle, rgba(0,229,255,0.04) 0%, transparent 70%);
  animation: drift 30s ease-in-out infinite reverse;
}
@keyframes drift {
  0%,100% { transform: translate(0,0); }
  33% { transform: translate(5vw, -3vh); }
  66% { transform: translate(-3vw, 5vh); }
}

/* ── Grid Pattern ─────────────────────────────────────────────── */
.grid-pattern {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(42,42,58,0.3) 1px, transparent 1px),
    linear-gradient(90deg, rgba(42,42,58,0.3) 1px, transparent 1px);
  background-size: 60px 60px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 100%);
}

/* ── Layout ───────────────────────────────────────────────────── */
.shell { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }

/* ── Top Bar ──────────────────────────────────────────────────── */
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 28px;
  border-bottom: 1px solid var(--border);
  background: rgba(10,10,15,0.8);
  backdrop-filter: blur(20px);
  position: sticky; top: 0; z-index: 100;
}
.topbar-left { display: flex; align-items: center; gap: 16px; }
.logo {
  display: flex; align-items: center; gap: 10px;
  font-weight: 700; font-size: 1.1rem; letter-spacing: -0.02em;
}
.logo-icon {
  width: 32px; height: 32px;
  background: linear-gradient(135deg, var(--accent), var(--cyan));
  border-radius: 8px;
  display: grid; place-items: center;
  font-size: 16px; font-weight: 800; color: white;
  box-shadow: 0 0 20px rgba(108,92,231,0.3);
}
.logo span { color: var(--text-dim); font-weight: 400; }
.health-pill {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 20px;
  background: rgba(0,230,118,0.08);
  border: 1px solid rgba(0,230,118,0.2);
  font-size: 0.78rem; font-family: var(--mono);
  color: var(--green); font-weight: 500;
}
.health-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--green);
  animation: pulse-dot 2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%,100% { box-shadow: 0 0 0 0 rgba(0,230,118,0.4); }
  50% { box-shadow: 0 0 0 6px rgba(0,230,118,0); }
}
.health-pill.down { background: rgba(255,82,82,0.08); border-color: rgba(255,82,82,0.2); color: var(--red); }
.health-pill.down .health-dot { background: var(--red); animation: none; }

.topbar-right { display: flex; align-items: center; gap: 12px; }
.cmd-trigger {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px; border-radius: var(--radius-sm);
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text-dim); font-size: 0.82rem;
  transition: all 0.15s;
}
.cmd-trigger:hover { border-color: var(--border-glow); color: var(--text); }
.cmd-trigger kbd {
  padding: 2px 6px; border-radius: 4px;
  background: var(--surface); border: 1px solid var(--border);
  font-family: var(--mono); font-size: 0.72rem;
}
.version-tag {
  font-family: var(--mono); font-size: 0.72rem;
  color: var(--text-muted); padding: 3px 8px;
  background: var(--surface); border-radius: 4px;
}

/* ── Main Content ─────────────────────────────────────────────── */
.main { flex: 1; display: flex; gap: 0; }
.sidebar {
  width: 260px; min-width: 260px;
  border-right: 1px solid var(--border);
  background: rgba(18,18,26,0.6);
  backdrop-filter: blur(10px);
  display: flex; flex-direction: column;
  overflow-y: auto;
}
.content { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 24px; }

/* ── Sidebar ──────────────────────────────────────────────────── */
.sidebar-section { padding: 16px; }
.sidebar-section + .sidebar-section { border-top: 1px solid var(--border); }
.sidebar-label {
  font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-muted); margin-bottom: 10px; font-weight: 600;
}
.category-list { display: flex; flex-direction: column; gap: 2px; }
.category-btn {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-radius: var(--radius-sm);
  background: transparent; border: none;
  color: var(--text-dim); font-size: 0.85rem;
  transition: all 0.15s; text-align: left;
}
.category-btn:hover { background: var(--surface2); color: var(--text); }
.category-btn.active { background: rgba(108,92,231,0.12); color: var(--accent-glow); }
.category-btn .cat-icon { width: 20px; text-align: center; margin-right: 8px; font-size: 0.9rem; }
.category-count {
  font-family: var(--mono); font-size: 0.7rem;
  background: var(--surface2); padding: 1px 7px;
  border-radius: 10px; color: var(--text-muted);
}
.category-btn.active .category-count { background: rgba(108,92,231,0.2); color: var(--accent-glow); }

.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stat-card {
  padding: 12px; border-radius: var(--radius-sm);
  background: var(--surface2); border: 1px solid var(--border);
}
.stat-value { font-size: 1.4rem; font-weight: 700; font-family: var(--mono); }
.stat-label { font-size: 0.68rem; color: var(--text-muted); margin-top: 2px; }
.stat-value.green { color: var(--green); }
.stat-value.amber { color: var(--amber); }
.stat-value.cyan { color: var(--cyan); }

/* ── Topology Visualization ───────────────────────────────────── */
.topo-section {
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  position: relative; overflow: hidden;
}
.topo-section::before {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, rgba(108,92,231,0.04) 0%, transparent 70%);
}
.topo-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; position: relative;
}
.topo-title { font-size: 0.82rem; font-weight: 600; }
.topo-canvas { position: relative; min-height: 220px; }
.topo-hub {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: 80px; height: 80px;
  background: linear-gradient(135deg, var(--accent), #8b5cf6);
  border-radius: 50%;
  display: grid; place-items: center;
  font-size: 0.7rem; font-weight: 700; color: white;
  text-align: center; line-height: 1.2;
  box-shadow: 0 0 40px rgba(108,92,231,0.3);
  z-index: 2;
}
.topo-node {
  position: absolute;
  width: 52px; height: 52px;
  border-radius: 50%;
  background: var(--surface2);
  border: 2px solid var(--border);
  display: grid; place-items: center;
  font-size: 0.6rem; font-family: var(--mono);
  color: var(--text-dim); text-align: center;
  transition: all 0.3s; z-index: 2;
  cursor: pointer;
}
.topo-node:hover {
  border-color: var(--accent); color: var(--accent-glow);
  box-shadow: 0 0 20px rgba(108,92,231,0.2);
  transform: scale(1.12);
}
.topo-node.active { border-color: var(--green); color: var(--green); }
.topo-line {
  position: absolute; z-index: 1;
  height: 2px;
  background: linear-gradient(90deg, var(--border), var(--border-glow), var(--border));
  transform-origin: left center;
  opacity: 0.4;
}
.topo-node.active ~ .topo-line { opacity: 0.8; }

/* ── Scraper Cards ────────────────────────────────────────────── */
.cards-header {
  display: flex; align-items: center; justify-content: space-between;
}
.cards-title { font-size: 1.1rem; font-weight: 600; }
.cards-subtitle { font-size: 0.78rem; color: var(--text-dim); }
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.scraper-card {
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.2s;
  position: relative; overflow: hidden;
}
.scraper-card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0; transition: opacity 0.3s;
}
.scraper-card:hover { border-color: var(--border-glow); transform: translateY(-2px); }
.scraper-card:hover::before { opacity: 1; }
.scraper-card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 30px rgba(108,92,231,0.1);
}
.scraper-card.selected::before { opacity: 1; }
.card-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
.card-name { font-weight: 600; font-size: 0.95rem; }
.card-id { font-family: var(--mono); font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; }
.card-badge {
  padding: 3px 10px; border-radius: 12px;
  font-size: 0.68rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em;
}
.badge-court { background: rgba(255,171,0,0.1); color: var(--amber); }
.badge-utility { background: rgba(0,229,255,0.1); color: var(--cyan); }
.badge-mortgage { background: rgba(108,92,231,0.1); color: var(--accent-glow); }
.badge-tax { background: rgba(0,230,118,0.1); color: var(--green); }
.badge-hoa { background: rgba(255,82,82,0.1); color: var(--red); }
.badge-generic { background: rgba(136,136,160,0.1); color: var(--text-dim); }
.badge-governance { background: rgba(162,155,254,0.1); color: var(--accent-glow); }
.card-meta {
  display: flex; gap: 16px; align-items: center;
  font-size: 0.72rem; color: var(--text-muted); font-family: var(--mono);
}
.card-meta-item { display: flex; align-items: center; gap: 4px; }
.auth-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
.auth-dot.yes { background: var(--amber); }
.auth-dot.no { background: var(--green); }

/* ── Execute Panel ────────────────────────────────────────────── */
.exec-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  display: none;
}
.exec-panel.open { display: block; animation: slideUp 0.3s ease-out; }
@keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.exec-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px;
  background: var(--surface2);
  border-bottom: 1px solid var(--border);
}
.exec-title { font-weight: 600; font-size: 0.9rem; display: flex; align-items: center; gap: 8px; }
.exec-portal-id { font-family: var(--mono); color: var(--accent-glow); font-weight: 400; }
.exec-close {
  background: none; border: none; color: var(--text-muted);
  font-size: 1.2rem; padding: 4px; line-height: 1;
  transition: color 0.15s;
}
.exec-close:hover { color: var(--red); }
.exec-body { display: flex; gap: 0; min-height: 300px; }
.exec-input-pane, .exec-output-pane { flex: 1; display: flex; flex-direction: column; }
.exec-input-pane { border-right: 1px solid var(--border); }
.pane-header {
  padding: 8px 16px;
  background: rgba(26,26,40,0.5);
  border-bottom: 1px solid var(--border);
  font-size: 0.7rem; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--text-muted); font-weight: 600;
  display: flex; align-items: center; justify-content: space-between;
}
.exec-textarea {
  flex: 1; padding: 16px;
  background: transparent; border: none; outline: none;
  color: var(--text); font-family: var(--mono); font-size: 0.82rem;
  resize: none; line-height: 1.6;
}
.exec-textarea::placeholder { color: var(--text-muted); }
.exec-output {
  flex: 1; padding: 16px;
  font-family: var(--mono); font-size: 0.78rem;
  line-height: 1.6; overflow-y: auto;
  white-space: pre-wrap; word-break: break-all;
}
.exec-output .line-success { color: var(--green); }
.exec-output .line-error { color: var(--red); }
.exec-output .line-info { color: var(--cyan); }
.exec-output .line-dim { color: var(--text-muted); }
.exec-output .json-key { color: var(--accent-glow); }
.exec-output .json-string { color: var(--green); }
.exec-output .json-number { color: var(--cyan); }
.exec-output .json-bool { color: var(--amber); }
.exec-output .json-null { color: var(--text-muted); }
.exec-actions {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
  background: rgba(26,26,40,0.5);
}
.exec-btn {
  padding: 8px 20px; border-radius: var(--radius-sm);
  border: none; font-weight: 600; font-size: 0.82rem;
  transition: all 0.15s; display: flex; align-items: center; gap: 6px;
}
.exec-btn-primary {
  background: linear-gradient(135deg, var(--accent), #8b5cf6);
  color: white;
}
.exec-btn-primary:hover { box-shadow: 0 4px 20px rgba(108,92,231,0.3); transform: translateY(-1px); }
.exec-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
.exec-btn-secondary {
  background: var(--surface2); border: 1px solid var(--border);
  color: var(--text-dim);
}
.exec-btn-secondary:hover { border-color: var(--border-glow); color: var(--text); }
.exec-timer { font-family: var(--mono); font-size: 0.72rem; color: var(--text-muted); }

/* ── Command Palette ──────────────────────────────────────────── */
.cmd-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(8px);
  display: none; place-items: start center; padding-top: 20vh;
}
.cmd-overlay.open { display: grid; animation: fadeIn 0.15s; }
@keyframes fadeIn { from { opacity: 0; } }
.cmd-box {
  width: 560px; max-width: 90vw;
  background: var(--surface);
  border: 1px solid var(--border-glow);
  border-radius: var(--radius);
  box-shadow: 0 24px 80px rgba(0,0,0,0.5);
  overflow: hidden;
  animation: cmdSlide 0.2s ease-out;
}
@keyframes cmdSlide { from { opacity: 0; transform: translateY(-12px) scale(0.98); } }
.cmd-input-wrap {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; border-bottom: 1px solid var(--border);
}
.cmd-search-icon { color: var(--text-muted); font-size: 1rem; }
.cmd-input {
  flex: 1; background: none; border: none; outline: none;
  color: var(--text); font-size: 0.95rem; font-family: var(--sans);
}
.cmd-input::placeholder { color: var(--text-muted); }
.cmd-results { max-height: 320px; overflow-y: auto; padding: 6px; }
.cmd-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: var(--radius-sm);
  cursor: pointer; transition: background 0.1s;
}
.cmd-item:hover, .cmd-item.active { background: var(--surface2); }
.cmd-item-icon { width: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem; }
.cmd-item-text { flex: 1; }
.cmd-item-name { font-size: 0.85rem; font-weight: 500; }
.cmd-item-desc { font-size: 0.7rem; color: var(--text-muted); }
.cmd-item-shortcut { font-family: var(--mono); font-size: 0.68rem; color: var(--text-muted); }
.cmd-footer {
  padding: 8px 14px; border-top: 1px solid var(--border);
  display: flex; gap: 16px; font-size: 0.68rem; color: var(--text-muted);
}
.cmd-footer kbd { font-family: var(--mono); background: var(--surface2); padding: 1px 5px; border-radius: 3px; }

/* ── Activity Feed ────────────────────────────────────────────── */
.feed { display: flex; flex-direction: column; gap: 4px; }
.feed-item {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 0; font-size: 0.78rem;
}
.feed-time { font-family: var(--mono); color: var(--text-muted); width: 52px; flex-shrink: 0; }
.feed-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.feed-dot.ok { background: var(--green); }
.feed-dot.err { background: var(--red); }
.feed-dot.info { background: var(--cyan); }
.feed-msg { color: var(--text-dim); }
.feed-msg strong { color: var(--text); font-weight: 600; }

/* ── Gaps Section ─────────────────────────────────────────────── */
.gaps-section { display: none; }
.gaps-section.has-gaps { display: block; }
.gap-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-radius: var(--radius-sm);
  background: var(--surface2); margin-bottom: 6px;
  font-size: 0.82rem;
}
.gap-id { font-family: var(--mono); font-weight: 600; color: var(--amber); }
.gap-count { font-family: var(--mono); font-size: 0.72rem; color: var(--text-muted); }

/* ── Loading / Spinner ────────────────────────────────────────── */
.spinner {
  width: 16px; height: 16px; border: 2px solid var(--border);
  border-top-color: var(--accent); border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Responsive ───────────────────────────────────────────────── */
@media (max-width: 900px) {
  .sidebar { display: none; }
  .topo-section { display: none; }
  .cards-grid { grid-template-columns: 1fr; }
  .exec-body { flex-direction: column; }
  .exec-input-pane { border-right: none; border-bottom: 1px solid var(--border); min-height: 150px; }
}

/* ── Scrollbar ────────────────────────────────────────────────── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--border-glow); }

/* ── Transitions ──────────────────────────────────────────────── */
.card-enter { animation: cardEnter 0.3s ease-out both; }
@keyframes cardEnter {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
</head>
<body>
<div class="ambient"></div>
<div class="grid-pattern"></div>

<div class="shell">
  <!-- ── Top Bar ──────────────────────────────────────────────── -->
  <header class="topbar">
    <div class="topbar-left">
      <div class="logo">
        <div class="logo-icon">CS</div>
        ChittyScrape <span>// Mission Control</span>
      </div>
      <div id="health-pill" class="health-pill">
        <span class="health-dot"></span>
        <span id="health-text">checking...</span>
      </div>
    </div>
    <div class="topbar-right">
      <button class="cmd-trigger" onclick="openCmd()" title="Command Palette">
        Search scrapers... <kbd>K</kbd>
      </button>
      <span id="version-tag" class="version-tag">v--</span>
    </div>
  </header>

  <!-- ── Main ─────────────────────────────────────────────────── -->
  <div class="main">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-section">
        <div class="sidebar-label">Categories</div>
        <div id="category-list" class="category-list">
          <button class="category-btn active" data-cat="all" onclick="filterCategory('all', this)">
            <span><span class="cat-icon">*</span>All Scrapers</span>
            <span id="count-all" class="category-count">0</span>
          </button>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-label">Quick Stats</div>
        <div class="stat-grid">
          <div class="stat-card">
            <div id="stat-total" class="stat-value cyan">--</div>
            <div class="stat-label">Scrapers</div>
          </div>
          <div class="stat-card">
            <div id="stat-categories" class="stat-value green">--</div>
            <div class="stat-label">Categories</div>
          </div>
          <div class="stat-card">
            <div id="stat-auth" class="stat-value amber">--</div>
            <div class="stat-label">Require Auth</div>
          </div>
          <div class="stat-card">
            <div id="stat-gaps" class="stat-value" style="color:var(--red)">--</div>
            <div class="stat-label">Gaps</div>
          </div>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-label">Activity Feed</div>
        <div id="feed" class="feed">
          <div class="feed-item">
            <span class="feed-time">--:--</span>
            <span class="feed-dot info"></span>
            <span class="feed-msg">Initializing...</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- Content -->
    <main class="content">
      <!-- Topology -->
      <section class="topo-section">
        <div class="topo-header">
          <span class="topo-title">Scraper Topology</span>
          <span style="font-size:0.7rem;color:var(--text-muted);font-family:var(--mono)">
            Click a node to select
          </span>
        </div>
        <div id="topo-canvas" class="topo-canvas"></div>
      </section>

      <!-- Cards -->
      <section>
        <div class="cards-header">
          <div>
            <div class="cards-title" id="cards-title">All Scrapers</div>
            <div class="cards-subtitle" id="cards-subtitle">Loading catalog...</div>
          </div>
        </div>
        <div id="cards-grid" class="cards-grid" style="margin-top:16px;"></div>
      </section>

      <!-- Execute Panel -->
      <section id="exec-panel" class="exec-panel">
        <div class="exec-header">
          <div class="exec-title">
            Execute <span id="exec-portal-id" class="exec-portal-id"></span>
          </div>
          <button class="exec-close" onclick="closeExec()">&times;</button>
        </div>
        <div class="exec-body">
          <div class="exec-input-pane">
            <div class="pane-header">
              <span>Request Body</span>
              <button class="exec-btn exec-btn-secondary" onclick="formatInput()" style="padding:3px 8px;font-size:0.68rem;">Format</button>
            </div>
            <textarea id="exec-input" class="exec-textarea" placeholder='{ "caseNumber": "2024-D-001234" }' spellcheck="false"></textarea>
          </div>
          <div class="exec-output-pane">
            <div class="pane-header">
              <span>Response</span>
              <span id="exec-timer" class="exec-timer"></span>
            </div>
            <div id="exec-output" class="exec-output">
              <span class="line-dim">// Select a scraper and press Execute to see results</span>
            </div>
          </div>
        </div>
        <div class="exec-actions">
          <div style="display:flex;gap:8px;">
            <button id="exec-run-btn" class="exec-btn exec-btn-primary" onclick="runScrape()">
              Execute
            </button>
            <button class="exec-btn exec-btn-secondary" onclick="clearOutput()">Clear</button>
          </div>
          <div id="exec-status" style="font-size:0.72rem;color:var(--text-muted);font-family:var(--mono);"></div>
        </div>
      </section>

      <!-- Gaps -->
      <section id="gaps-section" class="gaps-section">
        <div class="cards-header" style="margin-bottom:12px;">
          <div>
            <div class="cards-title" style="color:var(--amber);">Capability Gaps</div>
            <div class="cards-subtitle">Portals requested but not yet implemented</div>
          </div>
        </div>
        <div id="gaps-list"></div>
      </section>
    </main>
  </div>
</div>

<!-- ── Command Palette ──────────────────────────────────────── -->
<div id="cmd-overlay" class="cmd-overlay" onclick="if(event.target===this)closeCmd()">
  <div class="cmd-box">
    <div class="cmd-input-wrap">
      <span class="cmd-search-icon">&#x2315;</span>
      <input id="cmd-input" class="cmd-input" placeholder="Search scrapers, actions, or type a portal ID..." autocomplete="off" />
    </div>
    <div id="cmd-results" class="cmd-results"></div>
    <div class="cmd-footer">
      <span><kbd>&uarr;&darr;</kbd> Navigate</span>
      <span><kbd>Enter</kbd> Select</span>
      <span><kbd>Esc</kbd> Close</span>
    </div>
  </div>
</div>

<script>
// ── State ──────────────────────────────────────────────────────
let scrapers = [];
let selectedScraper = null;
let currentFilter = 'all';
let cmdIndex = 0;
const feedLog = [];

const CATEGORY_ICONS = {
  all: '*', court: '\u2696', utility: '\u26A1', mortgage: '\u{1F3E0}',
  tax: '\u{1F4B0}', hoa: '\u{1F3D8}', generic: '\u{1F4E6}', governance: '\u{1F3DB}'
};
const CATEGORY_LABELS = {
  court: 'Court', utility: 'Utility', mortgage: 'Mortgage',
  tax: 'Tax', hoa: 'HOA', generic: 'Generic', governance: 'Governance'
};

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  addFeed('info', 'Dashboard loaded');
  await Promise.all([loadHealth(), loadCapabilities()]);
});

// ── Health ─────────────────────────────────────────────────────
async function loadHealth() {
  try {
    const r = await fetch('/health');
    const d = await r.json();
    const pill = document.getElementById('health-pill');
    const text = document.getElementById('health-text');
    if (d.status === 'ok') {
      pill.className = 'health-pill';
      text.textContent = 'OPERATIONAL';
      document.getElementById('version-tag').textContent = 'v' + d.version;
      addFeed('ok', 'Service healthy (' + d.version + ')');
    } else {
      pill.className = 'health-pill down';
      text.textContent = 'DEGRADED';
      addFeed('err', 'Service degraded');
    }
  } catch (e) {
    document.getElementById('health-pill').className = 'health-pill down';
    document.getElementById('health-text').textContent = 'UNREACHABLE';
    addFeed('err', 'Health check failed');
  }
}

// ── Capabilities ───────────────────────────────────────────────
async function loadCapabilities() {
  try {
    const r = await fetch('/api/v1/capabilities');
    const d = await r.json();
    scrapers = d.scrapers || [];
    addFeed('ok', scrapers.length + ' scrapers loaded');
    renderCategories();
    renderCards();
    renderTopology();
    updateStats();
  } catch (e) {
    addFeed('err', 'Failed to load capabilities');
    document.getElementById('cards-subtitle').textContent = 'Failed to load catalog';
  }
}

// ── Categories ─────────────────────────────────────────────────
function renderCategories() {
  const cats = {};
  scrapers.forEach(s => { cats[s.category] = (cats[s.category] || 0) + 1; });
  const list = document.getElementById('category-list');
  document.getElementById('count-all').textContent = scrapers.length;
  Object.entries(cats).sort((a,b) => b[1]-a[1]).forEach(([cat, count]) => {
    const btn = document.createElement('button');
    btn.className = 'category-btn';
    btn.dataset.cat = cat;
    btn.onclick = () => filterCategory(cat, btn);
    btn.innerHTML =
      '<span><span class="cat-icon">' + (CATEGORY_ICONS[cat]||'?') + '</span>' +
      (CATEGORY_LABELS[cat]||cat) + '</span>' +
      '<span class="category-count">' + count + '</span>';
    list.appendChild(btn);
  });
}

function filterCategory(cat, btn) {
  currentFilter = cat;
  document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('cards-title').textContent =
    cat === 'all' ? 'All Scrapers' : (CATEGORY_LABELS[cat]||cat) + ' Scrapers';
  renderCards();
}

// ── Cards ──────────────────────────────────────────────────────
function renderCards() {
  const grid = document.getElementById('cards-grid');
  const filtered = currentFilter === 'all'
    ? scrapers
    : scrapers.filter(s => s.category === currentFilter);
  document.getElementById('cards-subtitle').textContent =
    filtered.length + ' scraper' + (filtered.length !== 1 ? 's' : '') + ' available';
  grid.innerHTML = '';
  filtered.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'scraper-card card-enter' + (selectedScraper?.id === s.id ? ' selected' : '');
    card.style.animationDelay = (i * 0.05) + 's';
    card.onclick = () => selectScraper(s, card);
    card.innerHTML =
      '<div class="card-top">' +
        '<div><div class="card-name">' + esc(s.name) + '</div>' +
        '<div class="card-id">' + esc(s.id) + '</div></div>' +
        '<span class="card-badge badge-' + s.category + '">' + esc(s.category) + '</span>' +
      '</div>' +
      '<div class="card-meta">' +
        '<span class="card-meta-item">v' + esc(s.version) + '</span>' +
        '<span class="card-meta-item"><span class="auth-dot ' + (s.requiresAuth?'yes':'no') + '"></span>' +
        (s.requiresAuth ? 'Auth required' : 'No auth') + '</span>' +
        (s.credentialKeys?.length
          ? '<span class="card-meta-item">' + s.credentialKeys.length + ' keys</span>' : '') +
      '</div>';
    grid.appendChild(card);
  });
}

function selectScraper(s, card) {
  selectedScraper = s;
  document.querySelectorAll('.scraper-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  const panel = document.getElementById('exec-panel');
  panel.classList.add('open');
  document.getElementById('exec-portal-id').textContent = s.id;
  document.getElementById('exec-input').placeholder = getPlaceholder(s.id);
  document.getElementById('exec-output').innerHTML =
    '<span class="line-dim">// Ready to execute <strong>' + esc(s.id) + '</strong></span>\\n' +
    '<span class="line-dim">// ' + esc(s.name) + ' | v' + esc(s.version) + ' | ' + esc(s.category) + '</span>\\n' +
    (s.requiresAuth ? '<span class="line-dim">// Requires auth: ' + (s.credentialKeys||[]).join(', ') + '</span>\\n' : '') +
    '<span class="line-dim">// Press Execute or Ctrl+Enter to run</span>';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  addFeed('info', 'Selected: <strong>' + s.id + '</strong>');
  // Highlight topology node
  document.querySelectorAll('.topo-node').forEach(n => {
    n.classList.toggle('active', n.dataset.id === s.id);
  });
}

function getPlaceholder(id) {
  const map = {
    'court-docket': '{ "caseNumber": "2024-D-001234" }',
    'cook-county-tax': '{ "pin": "12-34-567-890-0000" }',
    'mr-cooper': '{ "property": "123 Main St" }',
    'peoples-gas': '{ "accountNumber": "1234567890" }',
    'comed': '{ "accountNumber": "1234567890" }',
    'court-name-search': '{ "name": "Smith, John", "divisions": ["D"] }',
    'appfolio-hoa': '{ "portfolio": "propertyhill" }',
    'google-drive': '{ "query": "closing disclosure" }'
  };
  return map[id] || '{ }';
}

// ── Topology ───────────────────────────────────────────────────
function renderTopology() {
  const canvas = document.getElementById('topo-canvas');
  canvas.innerHTML = '';
  const w = canvas.offsetWidth || 700;
  const h = 220;
  const cx = w / 2, cy = h / 2;
  // Hub
  const hub = document.createElement('div');
  hub.className = 'topo-hub';
  hub.innerHTML = 'Chitty<br>Scrape';
  canvas.appendChild(hub);
  // Nodes
  const n = scrapers.length;
  scrapers.forEach((s, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI/2;
    const rx = Math.min(w * 0.38, 280);
    const ry = Math.min(h * 0.38, 80);
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    // Line
    const line = document.createElement('div');
    line.className = 'topo-line';
    const dx = x - cx, dy = y - cy;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    line.style.cssText =
      'left:' + cx + 'px;top:' + (cy+1) + 'px;width:' + len + 'px;transform:rotate(' + ang + 'deg);';
    canvas.appendChild(line);
    // Node
    const node = document.createElement('div');
    node.className = 'topo-node';
    node.dataset.id = s.id;
    node.style.cssText = 'left:' + (x-26) + 'px;top:' + (y-26) + 'px;';
    const shortName = s.id.replace('court-','ct-').replace('cook-county-','cc-')
      .replace('peoples-','p-').replace('appfolio-','af-').replace('google-','g-')
      .replace('court-name-','cn-');
    node.innerHTML = shortName;
    node.onclick = () => {
      const card = document.querySelector('.scraper-card[data-id="' + s.id + '"]');
      // Find matching card
      document.querySelectorAll('.scraper-card').forEach(c => {
        if (c.querySelector('.card-id')?.textContent === s.id) selectScraper(s, c);
      });
    };
    canvas.appendChild(node);
  });
}

// ── Execute ────────────────────────────────────────────────────
async function runScrape() {
  if (!selectedScraper) return;
  const btn = document.getElementById('exec-run-btn');
  const output = document.getElementById('exec-output');
  const timer = document.getElementById('exec-timer');
  const input = document.getElementById('exec-input').value.trim();
  // Validate JSON
  let body;
  try {
    body = input ? JSON.parse(input) : {};
  } catch (e) {
    output.innerHTML = '<span class="line-error">Invalid JSON: ' + esc(e.message) + '</span>';
    return;
  }
  // Token prompt
  const token = getToken();
  if (!token) {
    output.innerHTML =
      '<span class="line-error">No auth token set.</span>\\n' +
      '<span class="line-dim">Press Ctrl+Shift+T or use the command palette to set your token.</span>';
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Running...';
  output.innerHTML = '<span class="line-info">Executing ' + esc(selectedScraper.id) + '...</span>\\n';
  const start = performance.now();
  const tick = setInterval(() => {
    timer.textContent = ((performance.now() - start) / 1000).toFixed(1) + 's';
  }, 100);
  try {
    const r = await fetch('/api/scrape/' + selectedScraper.id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    clearInterval(tick);
    timer.textContent = elapsed + 's';
    const data = await r.json();
    output.innerHTML =
      '<span class="line-' + (data.success ? 'success' : 'error') + '">' +
      (data.success ? 'SUCCESS' : 'FAILED') + '</span> ' +
      '<span class="line-dim">HTTP ' + r.status + ' in ' + elapsed + 's</span>\\n\\n' +
      syntaxHighlight(JSON.stringify(data, null, 2));
    addFeed(data.success ? 'ok' : 'err', esc(selectedScraper.id) + ': ' +
      (data.success ? 'success' : (data.error || 'failed')) + ' (' + elapsed + 's)');
    document.getElementById('exec-status').textContent =
      (data.success ? 'Completed' : 'Failed') + ' at ' + new Date().toLocaleTimeString();
  } catch (e) {
    clearInterval(tick);
    output.innerHTML += '<span class="line-error">Network error: ' + esc(e.message) + '</span>';
    addFeed('err', esc(selectedScraper.id) + ': network error');
  }
  btn.disabled = false;
  btn.innerHTML = 'Execute';
}

function formatInput() {
  const ta = document.getElementById('exec-input');
  try { ta.value = JSON.stringify(JSON.parse(ta.value), null, 2); } catch {}
}
function clearOutput() {
  document.getElementById('exec-output').innerHTML =
    '<span class="line-dim">// Output cleared</span>';
  document.getElementById('exec-timer').textContent = '';
}
function closeExec() {
  document.getElementById('exec-panel').classList.remove('open');
  selectedScraper = null;
  document.querySelectorAll('.scraper-card').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.topo-node').forEach(n => n.classList.remove('active'));
}

// ── Token ──────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('chittyscrape_token'); }
function setToken() {
  const t = prompt('Enter your ChittyScrape service token:');
  if (t !== null) {
    localStorage.setItem('chittyscrape_token', t);
    addFeed('ok', 'Token saved');
  }
}

// ── Command Palette ────────────────────────────────────────────
function openCmd() {
  const overlay = document.getElementById('cmd-overlay');
  overlay.classList.add('open');
  const input = document.getElementById('cmd-input');
  input.value = '';
  input.focus();
  cmdIndex = 0;
  renderCmdResults('');
}
function closeCmd() {
  document.getElementById('cmd-overlay').classList.remove('open');
}
function renderCmdResults(query) {
  const results = document.getElementById('cmd-results');
  let items = [];
  // Actions
  items.push({ type: 'action', icon: '\u{1F511}', name: 'Set Auth Token', desc: 'Configure service token for API calls', action: setToken, shortcut: 'Ctrl+Shift+T' });
  items.push({ type: 'action', icon: '\u2764', name: 'Check Health', desc: 'Refresh service health status', action: loadHealth });
  items.push({ type: 'action', icon: '\u21BB', name: 'Reload Catalog', desc: 'Refresh scraper capabilities', action: loadCapabilities });
  // Scrapers
  scrapers.forEach(s => {
    items.push({ type: 'scraper', icon: CATEGORY_ICONS[s.category]||'?', name: s.name, desc: s.id + ' - ' + s.category, scraper: s });
  });
  // Filter
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(q) || (i.desc||'').toLowerCase().includes(q));
  }
  results.innerHTML = items.slice(0, 10).map((item, i) =>
    '<div class="cmd-item' + (i === cmdIndex ? ' active' : '') + '" data-idx="' + i + '" ' +
    'onmouseenter="cmdIndex=' + i + ';highlightCmd()" onclick="execCmd(' + i + ')">' +
      '<span class="cmd-item-icon">' + item.icon + '</span>' +
      '<div class="cmd-item-text">' +
        '<div class="cmd-item-name">' + esc(item.name) + '</div>' +
        '<div class="cmd-item-desc">' + esc(item.desc||'') + '</div>' +
      '</div>' +
      (item.shortcut ? '<span class="cmd-item-shortcut">' + item.shortcut + '</span>' : '') +
    '</div>'
  ).join('');
  window._cmdItems = items.slice(0, 10);
}
function highlightCmd() {
  document.querySelectorAll('.cmd-item').forEach((el, i) => {
    el.classList.toggle('active', i === cmdIndex);
  });
}
function execCmd(idx) {
  const item = window._cmdItems[idx];
  closeCmd();
  if (item.action) item.action();
  else if (item.scraper) {
    // Find card and select
    currentFilter = 'all';
    document.querySelectorAll('.category-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.cat === 'all');
    });
    renderCards();
    setTimeout(() => {
      const cards = document.querySelectorAll('.scraper-card');
      cards.forEach(c => {
        if (c.querySelector('.card-id')?.textContent === item.scraper.id) {
          selectScraper(item.scraper, c);
        }
      });
    }, 50);
  }
}

// ── Keyboard shortcuts ─────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + K — command palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openCmd();
  }
  // Ctrl+Shift+T — set token
  if (e.ctrlKey && e.shiftKey && e.key === 'T') {
    e.preventDefault();
    setToken();
  }
  // Ctrl+Enter — execute
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && selectedScraper) {
    e.preventDefault();
    runScrape();
  }
  // Escape
  if (e.key === 'Escape') {
    if (document.getElementById('cmd-overlay').classList.contains('open')) closeCmd();
    else closeExec();
  }
  // Command palette navigation
  if (document.getElementById('cmd-overlay').classList.contains('open')) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdIndex = Math.min(cmdIndex + 1, (window._cmdItems?.length||1) - 1);
      highlightCmd();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdIndex = Math.max(cmdIndex - 1, 0);
      highlightCmd();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execCmd(cmdIndex);
    }
  }
});
// Cmd palette search
document.getElementById('cmd-input')?.addEventListener('input', (e) => {
  cmdIndex = 0;
  renderCmdResults(e.target.value);
});

// ── Stats ──────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-total').textContent = scrapers.length;
  const cats = new Set(scrapers.map(s => s.category));
  document.getElementById('stat-categories').textContent = cats.size;
  document.getElementById('stat-auth').textContent = scrapers.filter(s => s.requiresAuth).length;
}

// ── Feed ───────────────────────────────────────────────────────
function addFeed(type, msg) {
  const feed = document.getElementById('feed');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML =
    '<span class="feed-time">' + time + '</span>' +
    '<span class="feed-dot ' + type + '"></span>' +
    '<span class="feed-msg">' + msg + '</span>';
  if (feed.children.length > 12) feed.removeChild(feed.lastChild);
  feed.insertBefore(item, feed.firstChild);
}

// ── Helpers ────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function syntaxHighlight(json) {
  return json.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"([^"]+)"(?=\s*:)/g, '<span class="json-key">"$1"</span>')
    .replace(/:\s*"([^"]*)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="json-bool">$1</span>')
    .replace(/:\s*(null)/g, ': <span class="json-null">$1</span>');
}
</script>
</body>
</html>`;
}
