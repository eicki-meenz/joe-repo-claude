'use strict';
/* Dranbleiben – Offline-Habit-Tracker (PWA). Alle Daten liegen lokal (localStorage). */

const KEY = 'dranbleiben.v1';
const DAY = 864e5;
const COLORS = ['#22c55e', '#0a84ff', '#ff9f0a', '#bf5af2', '#ff375f', '#14b8a6', '#eab308', '#a16207'];
const EMOJIS = ['💊', '🏋️', '🧘', '🏃', '💧', '📖', '🥗', '😴', '🦷', '🧠', '🚴', '🏊', '✍️', '🎸', '🌿', '☀️', '🧹', '📞', '💰', '🧴', '🥩', '🚶', '❄️', '🧺'];
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const PERIOD = {
  week: { this: 'diese Woche', unit: ['Woche', 'Wochen'] },
  month: { this: 'diesen Monat', unit: ['Monat', 'Monate'] },
  quarter: { this: 'dieses Quartal', unit: ['Quartal', 'Quartale'] },
};

/* ---------- Persistenz ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'; } catch { return 'Europe/Berlin'; } };

function defaultState() {
  return { v: 1, habits: [], entries: [], pauses: [], settings: { dayStartHour: 4, tzMode: 'auto', tz: deviceTz(), lastBackup: null, hideInstall: false } };
}
function migrate(s) {
  const d = defaultState();
  s = s && typeof s === 'object' ? s : d;
  s.habits = Array.isArray(s.habits) ? s.habits : [];
  s.entries = Array.isArray(s.entries) ? s.entries : [];
  s.pauses = Array.isArray(s.pauses) ? s.pauses : [];
  s.settings = Object.assign(d.settings, s.settings || {});
  s.v = 1;
  return s;
}
function seed(s) {
  const t = dayOf(Date.now(), s.settings);
  const mk = (name, emoji, color, schedule) => ({ id: uid(), name, emoji, color, schedule, created: t, archived: false });
  s.habits.push(
    mk('Kreatin', '💊', COLORS[1], { type: 'daily' }),
    mk('Workout', '🏋️', COLORS[2], { type: 'interval', min: 3, max: 5 }),
    mk('Stretching', '🧘', COLORS[3], { type: 'interval', min: 2, max: 4 }),
  );
}
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { console.warn(e); }
  const s = defaultState(); seed(s); return s;
}
let state = load();
let _ctx = null;
function save() {
  _ctx = null;
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('⚠️ Speichern fehlgeschlagen – bitte Backup exportieren'); }
}
save();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}

/* ---------- Tage ----------
   Ein „logischer Tag“ beginnt um dayStartHour (Standard 4 Uhr) in der gewählten Zeitzone.
   Einträge speichern ihren Tag beim Anlegen fest – Zeitzonenwechsel verschieben nichts rückwirkend. */
function dayOf(ts, st = state.settings) {
  const d = new Date(ts - (st.dayStartHour || 0) * 36e5);
  const o = { year: 'numeric', month: '2-digit', day: '2-digit' };
  if (st.tzMode === 'fixed' && st.tz) o.timeZone = st.tz;
  let p;
  try { p = new Intl.DateTimeFormat('en-US', o).formatToParts(d); }
  catch { delete o.timeZone; p = new Intl.DateTimeFormat('en-US', o).formatToParts(d); }
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
const dn = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const ds = n => new Date(n * DAY).toISOString().slice(0, 10);
const wd = n => (new Date(n * DAY).getUTCDay() + 6) % 7; // Mo = 0
const todayN = () => dn(dayOf(Date.now()));
const fmtDay = (n, opt = { weekday: 'short', day: 'numeric', month: 'numeric' }) =>
  new Intl.DateTimeFormat('de-DE', Object.assign({ timeZone: 'UTC' }, opt)).format(new Date(n * DAY));
function rel(n, T) {
  const d = T - n;
  if (d <= 0) return 'heute';
  if (d === 1) return 'gestern';
  if (d === 2) return 'vorgestern';
  return `vor ${d} Tagen`;
}
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

function periodBounds(period, n) {
  if (period === 'week') { const s = n - wd(n); return [s, s + 6]; }
  const d = new Date(n * DAY), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (period === 'month') return [Date.UTC(y, m, 1) / DAY, Date.UTC(y, m + 1, 1) / DAY - 1];
  const q = m - (m % 3);
  return [Date.UTC(y, q, 1) / DAY, Date.UTC(y, q + 3, 1) / DAY - 1];
}

/* ---------- Kontext (abgeleitete Daten, gecacht bis zum nächsten save) ---------- */
function ctx() {
  const T = todayN();
  if (_ctx && _ctx.today === T) return _ctx;
  const days = new Map(), byDay = new Map();
  for (const e of state.entries) {
    const n = dn(e.day);
    if (!days.has(e.h)) { days.set(e.h, []); byDay.set(e.h, new Map()); }
    days.get(e.h).push(n); byDay.get(e.h).set(n, e);
  }
  for (const a of days.values()) a.sort((x, y) => x - y);
  _ctx = { today: T, days, byDay, paused: new Set(state.pauses.map(dn)) };
  return _ctx;
}
function effElapsed(a, b, paused) { // Tage zwischen a und b ohne Pausetage
  let d = b - a;
  for (let x = a + 1; x <= b; x++) if (paused.has(x)) d--;
  return d;
}
function firstDay(h, c) {
  const a = c.days.get(h.id); const cr = dn(h.created);
  return a && a.length ? Math.min(cr, a[0]) : cr;
}
const activeHabits = () => state.habits.filter(h => !h.archived);

/* ---------- Status: s = 0 (grün) … 1 (rot), null = neutral ---------- */
function statusAt(h, D, incl, c) {
  const all = c.days.get(h.id) || [];
  const days = all.filter(x => (incl ? x <= D : x < D));
  const last = days.length ? days[days.length - 1] : null;
  const doneToday = incl && last === D;
  const paused = c.paused;
  const sc = h.schedule;
  const r = (() => {
    switch (sc.type) {
      case 'daily': return intervalStatus(1, 1, last, D, doneToday, paused, true);
      case 'interval': return intervalStatus(sc.min, sc.max, last, D, doneToday, paused, false);
      case 'weekdays': return weekdayStatus(h, sc.days || [], days, last, D, doneToday, c);
      case 'period': return periodStatus(sc.period, sc.times, days, D, incl, doneToday, paused);
      default: return { s: null, ok: true, text: last == null ? 'Noch nie' : (doneToday ? 'Heute erledigt' : `Zuletzt ${rel(last, D)}`) };
    }
  })();
  r.last = last; r.doneToday = doneToday;
  r.paused = paused.has(D);
  return r;
}
function intervalStatus(min, max, last, D, doneToday, paused, daily) {
  if (doneToday) return { s: 0, ok: true, text: 'Heute erledigt' };
  if (last == null) return { s: 0.45, text: 'Noch nie – heute starten?' };
  if (paused.has(D)) return { s: 0.05, ok: true, text: 'Pause-Tag' };
  const d = effElapsed(last, D, paused);
  if (d < min) {
    const a = min - d, b = max - d;
    return { s: 0.12 * d / min, ok: true, text: a === b ? `Wieder fällig in ${plural(a, 'Tag', 'Tagen')}` : `Wieder fällig in ${a}–${b} Tagen` };
  }
  if (d <= max) {
    const s = max === min ? 0.45 : 0.35 + 0.35 * (d - min) / (max - min);
    const text = daily || d === max ? (daily ? 'Heute fällig' : 'Heute fällig – letzter Tag') : `Fällig · noch ${plural(max - d, 'Tag', 'Tage')} Luft`;
    return { s, text };
  }
  const o = d - max;
  return { s: Math.min(1, 0.8 + 0.06 * (o - 1)), text: daily && o === 1 ? 'Gestern verpasst – heute zurück?' : `Überfällig seit ${plural(o, 'Tag', 'Tagen')}` };
}
function weekdayWindowDone(days, P, next) { return days.some(x => x >= P && x < next); }
function nextSched(sched, n) { let x = n + 1; for (let i = 0; i < 8; i++, x++) if (sched.includes(wd(x))) return x; return n + 7; }
function prevSched(sched, n, start, paused) { let x = n - 1; while (x >= start && (!sched.includes(wd(x)) || paused.has(x))) x--; return x >= start ? x : null; }
function weekdayStatus(h, sched, days, last, D, doneToday, c) {
  if (!sched.length) return { s: null, ok: true, text: last == null ? 'Noch nie' : `Zuletzt ${rel(last, D)}` };
  const isSched = sched.includes(wd(D));
  if (doneToday) return { s: 0, ok: true, text: isSched ? 'Heute erledigt' : 'Heute erledigt (Bonus)' };
  if (c.paused.has(D)) return { s: 0.05, ok: true, text: 'Pause-Tag' };
  const P = prevSched(sched, D, firstDay(h, c), c.paused);
  const missed = P != null && !weekdayWindowDone(days, P, D);
  if (isSched) return missed ? { s: 0.85, text: `Heute fällig · ${WD[wd(P)]} verpasst` } : { s: 0.45, text: 'Heute fällig' };
  if (missed) return { s: 0.8, text: `${WD_LONG[wd(P)]} verpasst – nachholen?` };
  const nx = nextSched(sched, D);
  return { s: 0.05, ok: true, text: nx === D + 1 ? 'Nächstes Mal: morgen' : `Nächstes Mal: ${WD_LONG[wd(nx)]}` };
}
function periodStatus(period, times, days, D, incl, doneToday, paused) {
  const [a, b] = periodBounds(period, D);
  const cnt = days.filter(x => x >= a && x <= D).length;
  const P = PERIOD[period];
  if (cnt >= times) return { s: 0, ok: true, text: `${cap(P.this)} geschafft (${cnt}/${times})` };
  const remaining = times - cnt;
  let left = b - D + 1;
  for (let x = D; x <= b; x++) if (paused.has(x)) left--;
  let s;
  if (left <= 0 || remaining > left) s = 1;
  else {
    const ratio = (remaining / left) / (times / (b - a + 1));
    s = Math.max(0, Math.min(1, 0.15 + 0.3 * Math.log2(Math.max(ratio, 0.5))));
  }
  return { s, ok: s < 0.3, text: `${cnt}/${times} ${P.this} · noch ${plural(Math.max(left, 0), 'Tag', 'Tage')}` };
}
const cap = s => s[0].toUpperCase() + s.slice(1);
function statusColor(s) { return s == null ? '#8e8e93' : `hsl(${Math.round(130 * (1 - s))} 68% 45%)`; }

/* ---------- Serien ---------- */
function streak(h, c) {
  const days = c.days.get(h.id) || [];
  const T = c.today, paused = c.paused, sc = h.schedule;
  if (sc.type === 'daily' || sc.type === 'interval') {
    const max = sc.type === 'daily' ? 1 : sc.max;
    let run = 0, best = 0, prev = null;
    for (const x of days) {
      if (x > T) continue;
      run = prev != null && effElapsed(prev, x, paused) <= max ? run + 1 : 1;
      best = Math.max(best, run); prev = x;
    }
    const cur = prev != null && effElapsed(prev, T, paused) <= max ? run : 0;
    return { cur, best, unit: sc.type === 'daily' ? ['Tag', 'Tage'] : ['Mal', 'Mal'] };
  }
  if (sc.type === 'weekdays' && sc.days && sc.days.length) {
    let run = 0, best = 0;
    for (let n = firstDay(h, c); n <= T; n++) {
      if (!sc.days.includes(wd(n)) || paused.has(n)) continue;
      const nx = nextSched(sc.days, n);
      if (weekdayWindowDone(days, n, nx)) { run++; best = Math.max(best, run); }
      else if (nx <= T) run = 0; // Fenster abgelaufen
    }
    return { cur: run, best, unit: ['Mal', 'Mal'] };
  }
  if (sc.type === 'period') {
    let run = 0, best = 0;
    let [a, b] = periodBounds(sc.period, firstDay(h, c));
    while (a <= T) {
      const cnt = days.filter(x => x >= a && x <= b).length;
      if (cnt >= sc.times) { run++; best = Math.max(best, run); }
      else if (b < T) run = 0;
      [a, b] = periodBounds(sc.period, b + 1);
    }
    return { cur: run, best, unit: PERIOD[sc.period].unit };
  }
  return { cur: days.length, best: null, unit: ['Mal', 'Mal'], total: true };
}
function greenShare(h, c, N = 30) { // Anteil Tage „nicht überfällig“ (rot) in den letzten N Tagen
  const T = c.today;
  let good = 0, tot = 0;
  for (let D = Math.max(firstDay(h, c), T - N + 1); D <= T; D++) {
    if (c.paused.has(D)) continue;
    const st = statusAt(h, D, D === T, c);
    if (st.s == null) return null;
    tot++; if (st.s < 0.8) good++;
  }
  return tot ? Math.round(100 * good / tot) : null;
}
function comebacks(h) { return state.entries.filter(e => e.h === h.id && e.cb).length; }

/* ---------- Aktionen ---------- */
function toggleToday(id, btn) {
  const h = state.habits.find(x => x.id === id); if (!h) return;
  const c = ctx(), T = c.today, day = ds(T);
  const ex = state.entries.find(e => e.h === id && e.day === day);
  if (ex) {
    state.entries = state.entries.filter(e => e !== ex); save(); render();
    toast(`${h.emoji} Eintrag von heute entfernt`, [['Rückgängig', () => { state.entries.push(ex); save(); render(); }]]);
    return;
  }
  const before = statusAt(h, T, true, c);
  const hadEntries = (c.days.get(id) || []).length > 0;
  const cb = hadEntries && before.s != null && before.s >= 0.8 && !before.paused;
  const e = { id: uid(), h: id, day, ts: Date.now(), note: '', cb };
  state.entries.push(e); save(); render();
  const st = streak(h, ctx());
  const n = comebacks(h);
  let msg;
  if (cb) msg = n > 1 ? `Wieder im Sattel 🐎 Comeback Nr. ${n}` : 'Wieder im Sattel 🐎 Starkes Comeback!';
  else if ([3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365].includes(st.cur)) msg = `🔥 ${st.cur} ${st.unit[1]} in Folge!`;
  else msg = pick(['Erledigt ✓', 'Stark 💪', 'Weiter so!', 'Läuft 🔥', 'Sauber ✓', 'Gemacht ✓']);
  haptic();
  confetti(btn, cb || st.cur >= 7 ? 90 : 36);
  toast(`${h.emoji} ${msg}`, [['Notiz', () => openSheet({ type: 'note', id: e.id })], ['Rückgängig', () => { state.entries = state.entries.filter(x => x !== e); save(); render(); }]]);
}
const pick = a => a[Math.floor(Math.random() * a.length)];

/* ---------- Effekte ---------- */
const hapticEl = document.getElementById('haptic');
function haptic() {
  try { if (navigator.vibrate) navigator.vibrate(12); else hapticEl.click(); } catch {}
}
const fx = document.getElementById('fx'), g2 = fx.getContext('2d');
let parts = [], raf = 0;
function confetti(el, n) {
  const dpr = window.devicePixelRatio || 1;
  fx.width = innerWidth * dpr; fx.height = innerHeight * dpr; g2.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const cols = ['#22c55e', '#facc15', '#f97316', '#0a84ff', '#bf5af2', '#ff375f'];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3, v = 4 + Math.random() * 7;
    parts.push({ x: x0, y: y0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 3 + Math.random() * 4, c: pick(cols), rot: Math.random() * 6, vr: (Math.random() - .5) * .4, life: 70 + Math.random() * 30 });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}
function tick() {
  g2.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.life-- > 0);
  for (const p of parts) {
    p.vy += 0.22; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    g2.save(); g2.globalAlpha = Math.min(1, p.life / 30); g2.translate(p.x, p.y); g2.rotate(p.rot);
    g2.fillStyle = p.c; g2.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g2.restore();
  }
  raf = parts.length ? requestAnimationFrame(tick) : 0;
}

/* ---------- Toast ---------- */
const toastEl = document.getElementById('toast');
let toastTimer = 0, toastActions = [];
function toast(text, actions = []) {
  toastActions = actions;
  toastEl.innerHTML = `<span class="grow">${esc(text)}</span>` + actions.map((a, i) => `<button data-action="toast" data-i="${i}">${esc(a[0])}</button>`).join('');
  toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4500);
}

/* ---------- Rendering ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const view = document.getElementById('view');
const sheetEl = document.getElementById('sheet');
const ui = { tab: 'today', sheet: null };
const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  view.innerHTML = ui.tab === 'today' ? renderToday() : ui.tab === 'stats' ? renderStats() : renderSettings();
  if (ui.sheet && ui.sheet.type === 'detail') renderSheet(); // Formulare nicht überschreiben
}

function scheduleText(sc) {
  switch (sc.type) {
    case 'daily': return 'Täglich';
    case 'interval': return sc.min === sc.max ? `Alle ${sc.min} Tage` : `Alle ${sc.min}–${sc.max} Tage`;
    case 'weekdays': return (sc.days || []).slice().sort().map(d => WD[d]).join(', ') || 'Wochentage';
    case 'period': return `${sc.times}× pro ${PERIOD[sc.period].unit[0]}`;
    default: return 'Ohne Rhythmus';
  }
}

function card(h, c) {
  const st = statusAt(h, c.today, true, c);
  const sk = streak(h, c);
  const col = statusColor(st.doneToday ? 0 : st.s);
  let sub = `<b>${esc(st.text)}</b>`;
  if (st.last != null && !st.doneToday && h.schedule.type !== 'none' && !/^Zuletzt/.test(st.text)) sub += ` · zuletzt ${rel(st.last, c.today)}`;
  const streakHtml = sk.total ? (sk.cur ? `<span class="streak">${sk.cur}×</span>` : '')
    : sk.cur > 0 ? `<span class="streak ${sk.cur >= 3 ? 'hot' : ''}">🔥 ${sk.cur}</span>` : '';
  const spectrum = st.s != null && !st.ok && !st.doneToday ? `<div class="spectrum"><i style="left:${Math.round(st.s * 100)}%"></i></div>` : '';
  return `<div class="card ${st.doneToday ? 'done' : ''}" style="--c:${col};--tint:${h.color}26">
    <button class="card-main" data-action="open" data-id="${h.id}">
      <span class="emoji">${esc(h.emoji)}</span>
      <span class="txt"><span class="name">${esc(h.name)}</span><span class="status">${sub}</span></span>
      ${streakHtml}
    </button>
    <button class="check ${st.doneToday ? 'on' : ''}" data-action="toggle" data-id="${h.id}" aria-label="${esc(h.name)} heute abhaken"><span>${CHECK_SVG}</span></button>
    ${spectrum}
  </div>`;
}

function renderToday() {
  const c = ctx(), T = c.today;
  const hs = activeHabits().map(h => ({ h, st: statusAt(h, T, true, c) }));
  const due = hs.filter(x => !x.st.ok && !x.st.doneToday).sort((a, b) => b.st.s - a.st.s);
  const rest = hs.filter(x => x.st.ok || x.st.doneToday)
    .sort((a, b) => (a.st.doneToday - b.st.doneToday) || ((b.st.s ?? -1) - (a.st.s ?? -1)));
  const doneN = hs.filter(x => x.st.doneToday).length;
  const total = doneN + due.length;
  const frac = total ? doneN / total : 1;
  const hr = new Date().getHours();
  const greet = hr < 5 ? 'Gute Nacht' : hr < 11 ? 'Guten Morgen' : hr < 17 ? 'Hallo' : hr < 23 ? 'Guten Abend' : 'Gute Nacht';
  const C = 2 * Math.PI * 24;
  let html = `<div class="head">
    <div class="grow"><h1>${greet}</h1><div class="date">${fmtDay(T, { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
    <div class="ring" title="Heute erledigt"><svg viewBox="0 0 56 56"><circle class="bg" cx="28" cy="28" r="24"/><circle class="fg" cx="28" cy="28" r="24" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg><b>${doneN}/${total}</b></div>
    <button class="iconbtn" data-action="new" aria-label="Neues Habit">+</button>
  </div>`;
  if (c.paused.has(T)) html += `<div class="banner pause"><span>🌴</span><span class="grow"><b>Pause-Tag.</b> Serien und Intervalle sind heute eingefroren.</span><button data-action="pauseToday" style="color:#fff;font-weight:600">Aufheben</button></div>`;
  if (!isStandalone() && !state.settings.hideInstall) html += `<div class="banner"><span>📲</span><span class="grow">Installieren: in Safari <b>Teilen</b> → <b>Zum Home-Bildschirm</b>. Danach läuft die App offline.</span><button class="link" data-action="hideInstall">OK</button></div>`;
  const lb = state.settings.lastBackup;
  const daysSinceBackup = lb ? Math.floor((Date.now() - lb) / DAY) : null;
  if (state.entries.length >= 10 && (daysSinceBackup == null || daysSinceBackup >= 14))
    html += `<div class="banner"><span>☁️</span><span class="grow">${lb ? `Letztes Backup vor ${daysSinceBackup} Tagen.` : 'Noch kein Backup.'} In iCloud sichern?</span><button class="link" data-action="export">Sichern</button></div>`;
  if (!hs.length) return html + `<div class="empty"><div style="font-size:48px">🌱</div><p>Noch keine Habits.<br>Tippe auf <b>+</b>, um eins anzulegen.</p></div>`;
  if (due.length) html += `<h2 class="sec">Jetzt dran</h2>` + due.map(x => card(x.h, c)).join('');
  else html += `<div class="banner"><span>🎉</span><span class="grow"><b>Alles im grünen Bereich.</b> Nichts ist fällig.</span></div>`;
  if (rest.length) html += `<h2 class="sec">Im grünen Bereich</h2>` + rest.map(x => card(x.h, c)).join('');
  return html;
}

function heatmap(c, h, weeks = 17) {
  const T = c.today;
  const end = T + (6 - wd(T)), start = end - weeks * 7 + 1;
  const counts = new Map();
  if (h) (c.days.get(h.id) || []).forEach(n => counts.set(n, 1));
  else state.entries.forEach(e => { if (state.habits.find(x => x.id === e.h && !x.archived)) { const n = dn(e.day); counts.set(n, (counts.get(n) || 0) + 1); } });
  const maxC = h ? 1 : Math.max(1, activeHabits().length);
  let cells = '', months = '', lastM = -1;
  for (let w = 0; w < weeks; w++) {
    const m = new Date((start + w * 7) * DAY).getUTCMonth();
    months += `<span>${m !== lastM ? fmtDay(start + w * 7, { month: 'short' }).replace('.', '') : ''}</span>`;
    lastM = m;
  }
  for (let n = start; n <= end; n++) {
    let cls = '';
    if (n > T) cls = 'f';
    else if (counts.get(n)) { const r = counts.get(n) / maxC; cls = h ? 'l3' : r > 0.66 ? 'l3' : r > 0.33 ? 'l2' : 'l1'; }
    else if (c.paused.has(n)) cls = 'p';
    if (n === T) cls += ' t';
    cells += `<i class="${cls}" title="${ds(n)}"></i>`;
  }
  return `<div class="heat-wrap" style="--hc:${h ? h.color : 'var(--accent)'}">
    <div class="heat-months" style="grid-template-columns:repeat(${weeks},1fr)">${months}</div>
    <div class="heat-body"><div class="heat-days"><span>Mo</span><span></span><span>Mi</span><span></span><span>Fr</span><span></span><span>So</span></div>
    <div class="heat">${cells}</div></div>
    <div class="legend"><span>■ erledigt</span><span>▨ Pause</span><span>□ heute umrandet</span></div></div>`;
}

function renderStats() {
  const c = ctx(), T = c.today, hs = activeHabits();
  const [wa] = periodBounds('week', T);
  const week = state.entries.filter(e => { const n = dn(e.day); return n >= wa && n <= T && hs.some(h => h.id === e.h); }).length;
  const shares = hs.map(h => greenShare(h, c)).filter(x => x != null);
  const avg = shares.length ? Math.round(shares.reduce((a, b) => a + b, 0) / shares.length) : '–';
  const cbs = state.entries.filter(e => e.cb).length;
  const bestStreak = Math.max(0, ...hs.map(h => streak(h, c).best || 0));
  let html = `<div class="head"><div class="grow"><h1>Statistik</h1><div class="date">Alle Habits</div></div></div>
  <div class="tiles">
    <div class="tile"><b>${week}</b><span>Check-ins diese Woche</span></div>
    <div class="tile"><b>${avg}${avg === '–' ? '' : '%'}</b><span>Grün-Quote (30 Tage)</span></div>
    <div class="tile"><b>${cbs}</b><span>Comebacks 🐎</span></div>
    <div class="tile"><b>${bestStreak}</b><span>Längste Serie</span></div>
  </div>
  <h2 class="sec">Aktivität</h2>${heatmap(c, null)}
  <h2 class="sec">Pro Habit</h2>
  <div class="group"><div class="srow"><span>Habit</span><span>Serie</span><span>Rekord</span><span>Grün</span></div>`;
  for (const h of hs) {
    const sk = streak(h, c), gs = greenShare(h, c);
    html += `<button class="srow" style="width:100%;text-align:left" data-action="open" data-id="${h.id}"><span>${esc(h.emoji)} ${esc(h.name)}</span><span>${sk.total ? '–' : sk.cur}</span><span>${sk.best ?? '–'}</span><span>${gs == null ? '–' : gs + '%'}</span></button>`;
  }
  html += `</div><p class="hint"><b>Grün</b> = Anteil der letzten 30 Tage, an denen das Habit nicht überfällig war. Ein verpasster Tag kostet ein paar Prozent, setzt aber nichts auf null. <b>Comeback</b> = du hast ein überfälliges Habit wieder aufgenommen.</p>`;
  return html;
}

function pauseRanges() {
  const ns = [...new Set(state.pauses.map(dn))].sort((a, b) => a - b);
  const out = [];
  for (const n of ns) { const l = out[out.length - 1]; if (l && n === l[1] + 1) l[1] = n; else out.push([n, n]); }
  return out;
}
function tzOptions(cur) {
  let list = [];
  try { list = Intl.supportedValuesOf('timeZone'); } catch {}
  if (!list.length) list = ['Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney'];
  if (!list.includes(cur)) list.unshift(cur);
  return list.map(z => `<option ${z === cur ? 'selected' : ''}>${esc(z)}</option>`).join('');
}

function renderSettings() {
  const s = state.settings, c = ctx(), T = c.today;
  const lb = s.lastBackup ? new Date(s.lastBackup).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : 'noch nie';
  const archived = state.habits.filter(h => h.archived);
  const ranges = pauseRanges().filter(r => r[1] >= T - 60);
  return `<div class="head"><div class="grow"><h1>Einstellungen</h1></div></div>
  <h2 class="sec">Tag &amp; Reisen</h2>
  <div class="group">
    <div class="row"><div class="lbl">Neuer Tag beginnt um<small>Alles davor zählt noch zum Vortag</small></div>
      <select data-set="dayStartHour">${[0, 1, 2, 3, 4, 5, 6].map(h => `<option value="${h}" ${+s.dayStartHour === h ? 'selected' : ''}>${h}:00</option>`).join('')}</select></div>
    <div class="row"><div class="lbl">Zeitzone<small>${s.tzMode === 'fixed' ? 'Fest – Reisen verschieben deine Tage nicht' : 'Automatisch nach iPhone (aktuell ' + esc(deviceTz()) + ')'}</small></div>
      <select data-set="tzMode"><option value="auto" ${s.tzMode !== 'fixed' ? 'selected' : ''}>Automatisch</option><option value="fixed" ${s.tzMode === 'fixed' ? 'selected' : ''}>Fest</option></select></div>
    ${s.tzMode === 'fixed' ? `<div class="row"><div class="lbl">Feste Zeitzone</div><select data-set="tz" style="max-width:55%">${tzOptions(s.tz)}</select></div>` : ''}
  </div>
  <p class="hint">Bei kurzen Reisen über Zeitzonen: <b>Fest</b> auf deine Heimat stellen. Dann bleibt dein Tagesrhythmus stabil. Bei längeren Aufenthalten zurück auf Automatisch. Bereits erfasste Einträge bleiben immer auf ihrem Tag.</p>
  <h2 class="sec">Pause-/Reisetage</h2>
  <div class="group">
    <div class="row"><div class="lbl">Heute ist Pause-Tag<small>Serien frieren ein, Intervalle laufen nicht weiter</small></div>
      <button class="btn small ${c.paused.has(T) ? '' : 'sec'}" data-action="pauseToday">${c.paused.has(T) ? 'An' : 'Aus'}</button></div>
    <div class="row"><input type="date" id="pFrom" value="${ds(T)}"><span>bis</span><input type="date" id="pTo" value="${ds(T + 2)}"><button class="btn small" data-action="addPause">+</button></div>
    ${ranges.map(r => `<div class="row"><div class="lbl">🌴 ${fmtDay(r[0])}${r[1] !== r[0] ? ' – ' + fmtDay(r[1]) : ''}</div><button class="btn small danger" data-action="delPause" data-a="${r[0]}" data-b="${r[1]}">Entfernen</button></div>`).join('')}
  </div>
  <p class="hint">Für Flugtage, Krankheit oder Urlaub. Pausen gelten für alle Habits.</p>
  <h2 class="sec">Backup</h2>
  <div class="group">
    <div class="row"><button class="rowbtn" data-action="export">☁️ Backup exportieren</button></div>
    <div class="row"><button class="rowbtn" data-action="import">📥 Backup importieren</button></div>
  </div>
  <p class="hint">Letztes Backup: <b>${lb}</b>. Beim Export öffnet sich das Teilen-Menü: <b>In Dateien sichern</b> → <b>iCloud Drive</b>. Deine Daten liegen nur auf diesem iPhone. Wer die App löscht, löscht auch die Daten.</p>
  ${archived.length ? `<h2 class="sec">Archiviert</h2><div class="group">${archived.map(h => `<div class="row"><div class="lbl">${esc(h.emoji)} ${esc(h.name)}</div><button class="btn small sec" data-action="unarchive" data-id="${h.id}">Zurückholen</button></div>`).join('')}</div>` : ''}
  <h2 class="sec">Sonstiges</h2>
  <div class="group"><div class="row"><button class="rowbtn danger" data-action="wipe">Alle Daten löschen</button></div></div>
  <p class="hint" style="text-align:center">Dranbleiben · v1 · offline</p>`;
}

/* ---------- Sheets ---------- */
function openSheet(s) { ui.sheet = s; renderSheet(); }
function closeSheet() { ui.sheet = null; sheetEl.hidden = true; sheetEl.innerHTML = ''; }
function renderSheet() {
  const s = ui.sheet; if (!s) return;
  let inner = '';
  if (s.type === 'detail') inner = renderDetail(s.id);
  else if (s.type === 'edit') inner = renderEditor(s.id);
  else if (s.type === 'note') inner = renderNote(s.id);
  if (!inner) { closeSheet(); return; }
  const scroll = sheetEl.querySelector('.sheet')?.scrollTop || 0;
  sheetEl.innerHTML = `<div class="sheet"><div class="grab"></div>${inner}</div>`;
  sheetEl.hidden = false;
  sheetEl.querySelector('.sheet').scrollTop = scroll;
}

function renderDetail(id) {
  const h = state.habits.find(x => x.id === id); if (!h) return '';
  const c = ctx(), T = c.today, st = statusAt(h, T, true, c), sk = streak(h, c), gs = greenShare(h, c);
  const ents = state.entries.filter(e => e.h === id).sort((a, b) => dn(b.day) - dn(a.day) || (b.ts || 0) - (a.ts || 0));
  const col = statusColor(st.doneToday ? 0 : st.s);
  const lastTxt = st.last == null ? 'noch nie' : rel(st.last, T) + (st.last < T - 2 ? ` (${fmtDay(st.last)})` : '');
  return `<div class="sheet-head"><span class="emoji" style="--tint:${h.color}26">${esc(h.emoji)}</span><h3>${esc(h.name)}</h3><button class="x" data-action="close">Fertig</button></div>
  <div><span class="pill ${st.s == null ? 'neutral' : ''}" style="--c:${col}">${esc(st.text)}</span> <span class="hint">${esc(scheduleText(h.schedule))}</span></div>
  <div class="tiles">
    <div class="tile"><b>${lastTxt}</b><span>Zuletzt</span></div>
    <div class="tile"><b>${sk.total ? ents.length : sk.cur} <small style="font-size:14px">${sk.total ? '×' : sk.unit[sk.cur === 1 ? 0 : 1]}</small></b><span>${sk.total ? 'Gesamt' : 'Aktuelle Serie'}</span></div>
    ${sk.total ? '' : `<div class="tile"><b>${sk.best}</b><span>Rekord-Serie</span></div><div class="tile"><b>${gs == null ? '–' : gs + '%'}</b><span>Grün-Quote (30 T.)</span></div>`}
    <div class="tile"><b>${comebacks(h)}</b><span>Comebacks 🐎</span></div>
    <div class="tile"><b>${ents.length}</b><span>Einträge gesamt</span></div>
  </div>
  ${heatmap(c, h)}
  <h2 class="sec">Nachtragen</h2>
  <div class="group">
    <div class="row"><input type="date" id="bfDay" value="${ds(T - 1)}" max="${ds(T)}" style="flex:1"><button class="btn small" data-action="backfill" data-id="${h.id}">Eintragen</button></div>
    <div class="row"><input type="text" id="bfNote" placeholder="Notiz (optional)" style="flex:1"></div>
  </div>
  <h2 class="sec">Verlauf</h2>
  <div class="group">${ents.length ? ents.slice(0, 60).map(e => `<div class="row entry"><div class="grow"><div>${fmtDay(dn(e.day), { weekday: 'short', day: 'numeric', month: 'short', year: dn(e.day) < T - 300 ? 'numeric' : undefined })}${e.ts && !e.bf ? ` · ${new Date(e.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''} ${e.cb ? '<span class="cb">Comeback</span>' : ''}</div>${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</div>
    <button class="del" data-action="note" data-id="${e.id}" aria-label="Notiz">✎</button><button class="del" data-action="delEntry" data-id="${e.id}" aria-label="Löschen">×</button></div>`).join('') : '<div class="row hint">Noch keine Einträge.</div>'}</div>
  <button class="btn sec" data-action="edit" data-id="${h.id}">Bearbeiten</button>`;
}

function renderEditor(id) {
  const h = id ? state.habits.find(x => x.id === id) : null;
  if (id && !h) return '';
  const sc = h ? h.schedule : { type: 'daily' };
  const d = ui.draft || (ui.draft = { emoji: h ? h.emoji : pick(EMOJIS), color: h ? h.color : COLORS[state.habits.length % COLORS.length] });
  const types = [['daily', 'Täglich'], ['weekdays', 'Wochentage'], ['interval', 'Alle X–Y Tage'], ['period', 'X× pro Zeitraum'], ['none', 'Ohne Rhythmus']];
  return `<div class="sheet-head"><h3>${h ? 'Habit bearbeiten' : 'Neues Habit'}</h3><button class="x" data-action="close">Abbrechen</button></div>
  <form id="editor" data-type="${sc.type}" autocomplete="off">
    <div class="group">
      <div class="row"><input type="text" class="emoji-in" name="emoji" value="${esc(d.emoji)}" maxlength="8"><input type="text" name="name" placeholder="Name, z. B. Kreatin" value="${esc(h ? h.name : '')}" maxlength="40"></div>
    </div>
    <div class="group"><div class="emojis">${EMOJIS.map(e => `<button type="button" data-action="pickEmoji" data-e="${e}">${e}</button>`).join('')}</div></div>
    <div class="group"><div class="colors">${COLORS.map(cl => `<button type="button" class="${cl === d.color ? 'on' : ''}" style="--sw:${cl}" data-action="pickColor" data-c="${cl}" aria-label="Farbe"></button>`).join('')}</div></div>
    <h2 class="sec">Rhythmus</h2>
    <div class="group">
      <div class="chips types">${types.map(([v, l]) => `<label><input type="radio" name="type" value="${v}" ${sc.type === v ? 'checked' : ''}><span class="chip">${l}</span></label>`).join('')}</div>
      <div class="chips f-weekdays">${WD.map((w, i) => `<label><input type="checkbox" name="wd" value="${i}" ${(sc.days || [0, 2, 4]).includes(i) ? 'checked' : ''}><span class="chip">${w}</span></label>`).join('')}</div>
      <div class="row f-interval"><div class="lbl">Alle</div><input type="number" name="min" min="1" max="365" value="${sc.min || 3}" inputmode="numeric"><span>bis</span><input type="number" name="max" min="1" max="365" value="${sc.max || 5}" inputmode="numeric"><span>Tage</span></div>
      <div class="row f-period"><input type="number" name="times" min="1" max="90" value="${sc.times || 3}" inputmode="numeric"><div class="lbl">× pro</div>
        <select name="period">${['week', 'month', 'quarter'].map(p => `<option value="${p}" ${(sc.period || 'week') === p ? 'selected' : ''}>${PERIOD[p].unit[0]}</option>`).join('')}</select></div>
    </div>
    <p class="hint" id="typeHint"></p>
    <button class="btn" type="submit">${h ? 'Speichern' : 'Anlegen'}</button>
  </form>
  ${h ? `<button class="btn sec" data-action="archive" data-id="${h.id}">Archivieren</button><button class="btn danger" data-action="delHabit" data-id="${h.id}">Löschen</button>` : ''}`;
}
const TYPE_HINTS = {
  daily: 'Jeden Tag einmal, z. B. Kreatin. Grün = heute erledigt, gelb = heute fällig, rot = verpasst.',
  weekdays: 'An festen Wochentagen. Einen verpassten Termin kannst du bis zum nächsten Termin nachholen.',
  interval: 'Flexibler Abstand, z. B. Workout alle 3–5 Tage. Vor X: grün. Zwischen X und Y: gelb bis orange. Nach Y: rot.',
  period: 'Eine Anzahl pro Woche, Monat oder Quartal, egal an welchen Tagen. Die Farbe richtet sich danach, wie knapp es noch wird.',
  none: 'Kein Soll, nur „zuletzt am …“. Gut für Dinge, die du nur im Blick behalten willst.',
};

function renderNote(entryId) {
  const e = state.entries.find(x => x.id === entryId); if (!e) return '';
  const h = state.habits.find(x => x.id === e.h);
  return `<div class="sheet-head"><h3>Notiz · ${esc(h ? h.emoji + ' ' + h.name : '')}</h3><button class="x" data-action="saveNote" data-id="${e.id}">Sichern</button></div>
  <p class="hint">${fmtDay(dn(e.day), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
  <textarea id="noteText" placeholder="z. B. Beine + Rücken, 45 Min.">${esc(e.note)}</textarea>
  <button class="btn" data-action="saveNote" data-id="${e.id}">Sichern</button>`;
}

/* ---------- Backup ---------- */
async function exportBackup() {
  const data = JSON.stringify(Object.assign({ app: 'dranbleiben', exportedAt: new Date().toISOString() }, state), null, 1);
  const name = `dranbleiben-backup-${dayOf(Date.now())}.json`;
  const file = new File([data], name, { type: 'application/json' });
  const mark = () => { state.settings.lastBackup = Date.now(); save(); render(); toast('☁️ Backup erstellt'); };
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); mark(); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  mark();
}
document.getElementById('importFile').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    if (!obj || !Array.isArray(obj.habits) || !Array.isArray(obj.entries)) throw new Error('Kein gültiges Backup');
    if (!confirm(`Backup mit ${obj.habits.length} Habits und ${obj.entries.length} Einträgen laden? Die aktuellen Daten werden ersetzt.`)) return;
    delete obj.app; delete obj.exportedAt;
    state = migrate(obj); save(); render(); toast('📥 Backup geladen');
  } catch (e) { alert('Import fehlgeschlagen: ' + e.message); }
});

/* ---------- Events ---------- */
function readEditor(form) {
  const fd = new FormData(form);
  const type = fd.get('type');
  const name = String(fd.get('name') || '').trim();
  if (!name) { alert('Bitte einen Namen eingeben.'); return null; }
  const sc = { type };
  if (type === 'weekdays') { sc.days = fd.getAll('wd').map(Number).sort(); if (!sc.days.length) { alert('Bitte mindestens einen Wochentag wählen.'); return null; } }
  if (type === 'interval') {
    let a = Math.max(1, parseInt(fd.get('min'), 10) || 1), b = Math.max(1, parseInt(fd.get('max'), 10) || a);
    if (b < a) [a, b] = [b, a];
    sc.min = a; sc.max = b;
  }
  if (type === 'period') { sc.times = Math.max(1, parseInt(fd.get('times'), 10) || 1); sc.period = fd.get('period'); }
  return { name, emoji: String(fd.get('emoji') || '').trim() || '⭐', schedule: sc };
}

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-action]'); if (!el) return;
  if (ev.target === sheetEl) return;
  const a = el.dataset.action, id = el.dataset.id;
  switch (a) {
    case 'tab': ui.tab = el.dataset.tab; closeSheet(); render(); scrollTo(0, 0); break;
    case 'toggle': toggleToday(id, el); break;
    case 'open': openSheet({ type: 'detail', id }); break;
    case 'new': ui.draft = null; openSheet({ type: 'edit', id: null }); updateHint(); break;
    case 'edit': ui.draft = null; openSheet({ type: 'edit', id }); updateHint(); break;
    case 'close': closeSheet(); break;
    case 'toast': { const f = toastActions[+el.dataset.i]; toastEl.hidden = true; f && f(); break; }
    case 'pickEmoji': ui.draft.emoji = el.dataset.e; sheetEl.querySelector('[name=emoji]').value = el.dataset.e; break;
    case 'pickColor': ui.draft.color = el.dataset.c; sheetEl.querySelectorAll('.colors button').forEach(b => b.classList.toggle('on', b === el)); break;
    case 'note': openSheet({ type: 'note', id }); setTimeout(() => document.getElementById('noteText')?.focus(), 300); break;
    case 'saveNote': {
      const e = state.entries.find(x => x.id === id);
      if (e) { e.note = document.getElementById('noteText').value.trim(); save(); }
      const h = e && state.habits.find(x => x.id === e.h);
      if (h) openSheet({ type: 'detail', id: h.id }); else closeSheet();
      render(); break;
    }
    case 'delEntry': {
      const e = state.entries.find(x => x.id === id);
      if (e && confirm(`Eintrag vom ${fmtDay(dn(e.day))} löschen?`)) { state.entries = state.entries.filter(x => x !== e); save(); render(); }
      break;
    }
    case 'backfill': {
      const v = document.getElementById('bfDay').value; if (!v) return;
      const n = dn(v); if (n > ctx().today) { alert('Zukunft geht (noch) nicht 😉'); return; }
      const note = document.getElementById('bfNote').value.trim();
      const ex = state.entries.find(e => e.h === id && e.day === v);
      if (ex) { if (note) ex.note = ex.note ? ex.note + '\n' + note : note; toast('Für diesen Tag gab es schon einen Eintrag – Notiz ergänzt'); }
      else { state.entries.push({ id: uid(), h: id, day: v, ts: Date.now(), bf: true, note, cb: false }); toast(`✓ Nachgetragen für ${fmtDay(n)}`); }
      save(); render(); break;
    }
    case 'archive': { const h = state.habits.find(x => x.id === id); h.archived = true; save(); closeSheet(); render(); toast(`${h.emoji} archiviert – in den Einstellungen wiederherstellbar`); break; }
    case 'unarchive': { const h = state.habits.find(x => x.id === id); h.archived = false; save(); render(); break; }
    case 'delHabit': {
      const h = state.habits.find(x => x.id === id);
      if (confirm(`„${h.name}“ mit allen Einträgen endgültig löschen?`)) { state.habits = state.habits.filter(x => x !== h); state.entries = state.entries.filter(e => e.h !== id); save(); closeSheet(); render(); }
      break;
    }
    case 'pauseToday': {
      const t = ds(ctx().today);
      if (state.pauses.includes(t)) state.pauses = state.pauses.filter(x => x !== t); else state.pauses.push(t);
      save(); render(); break;
    }
    case 'addPause': {
      const f = document.getElementById('pFrom').value, t = document.getElementById('pTo').value; if (!f || !t) return;
      let a = dn(f), b = dn(t); if (b < a) [a, b] = [b, a];
      if (b - a > 120) { alert('Maximal 120 Tage am Stück.'); return; }
      for (let n = a; n <= b; n++) if (!state.pauses.includes(ds(n))) state.pauses.push(ds(n));
      save(); render(); break;
    }
    case 'delPause': { const a2 = +el.dataset.a, b2 = +el.dataset.b; state.pauses = state.pauses.filter(p => { const n = dn(p); return n < a2 || n > b2; }); save(); render(); break; }
    case 'hideInstall': state.settings.hideInstall = true; save(); render(); break;
    case 'export': exportBackup(); break;
    case 'import': document.getElementById('importFile').click(); break;
    case 'wipe':
      if (confirm('Wirklich ALLE Habits und Einträge löschen?') && confirm('Sicher? Das lässt sich nicht rückgängig machen.')) { state = defaultState(); save(); render(); }
      break;
  }
});
sheetEl.addEventListener('click', ev => { if (ev.target === sheetEl) closeSheet(); });
function updateHint() {
  const f = document.getElementById('editor'); const hint = document.getElementById('typeHint');
  if (f && hint) hint.textContent = TYPE_HINTS[f.dataset.type] || '';
}
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.name === 'type' && t.form) { t.form.dataset.type = t.value; updateHint(); return; }
  if (t.name === 'emoji' && ui.draft) ui.draft.emoji = t.value;
  if (t.dataset.set) {
    const k = t.dataset.set; state.settings[k] = k === 'dayStartHour' ? +t.value : t.value;
    if (k === 'tzMode' && t.value === 'fixed' && !state.settings.tz) state.settings.tz = deviceTz();
    save(); render();
  }
});
document.addEventListener('submit', ev => {
  if (ev.target.id !== 'editor') return;
  ev.preventDefault();
  const v = readEditor(ev.target); if (!v) return;
  const id = ui.sheet.id;
  if (id) { const h = state.habits.find(x => x.id === id); Object.assign(h, v, { color: ui.draft.color }); }
  else state.habits.push(Object.assign({ id: uid(), created: ds(ctx().today), archived: false, color: ui.draft.color }, v));
  ui.draft = null; save();
  if (id) openSheet({ type: 'detail', id }); else closeSheet();
  render(); if (!id) toast(`${v.emoji} ${v.name} angelegt`);
});

// Bei Rückkehr in die App (z. B. nach Mitternacht/4 Uhr) neu rendern
document.addEventListener('visibilitychange', () => { if (!document.hidden) { _ctx = null; render(); } });
setInterval(() => { if (!document.hidden && ctx().today !== todayN()) { _ctx = null; render(); } }, 60e3);

render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});

// Für Tests
window.__app = { get state() { return state; }, set state(s) { state = migrate(s); save(); render(); }, statusAt, streak, greenShare, ctx, dn, ds, todayN, render };
