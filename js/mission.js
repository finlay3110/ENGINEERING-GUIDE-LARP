// ============================================================================
// MISSION SETUP + ACTION LOG
//
// Loads after js/app.js and uses the shared handles it puts on window.UCN.
//
// Note on escaping: everything the reference tables render is authored in this
// repo, but the log renders names, mission titles and free-text notes typed by
// the user. Every interpolation of that data goes through esc().
// ============================================================================
const { SHIP_DATA, activateTab, setModuleVisibility, setShip } = window.UCN;

const STORE_KEY = 'ucn-mission-v1';
const SCHEMA = 'ucn.engineering.log/1';
const DEFAULT_SPARES = 5;

// group:     which SHIP_DATA group supplies this kind's targets, if any.
// tile:      the stat tile showing a running count, for the few kinds worth
//            watching at a glance mid-mission. Reactor repairs and hull
//            readings are deliberately absent: they belong in the log, not on
//            the dashboard.
// countable: appears in the totals of a written report. Broader than `tile` -
//            reactor repairs are worth counting afterwards even though they
//            do not warrant a tile.
// instant:   logged at a point in time rather than timed from start to end.
const KINDS = {
  ocp: { label: 'OCP repair', group: 'OCPs', tile: 'statOcp', countable: true },
  crystal: { label: 'Crystal repair', group: 'Crystals', tile: 'statCrystal', countable: true },
  conduit: { label: 'Conduit repair', group: 'Destabilisation Conduits', tile: 'statConduit', countable: true },
  reactor: { label: 'Reactor repair', group: null, tile: null, countable: true },
  cellSwap: { label: 'Power cell swapped', group: null, tile: 'statSwap', countable: true, instant: true },
  hull: { label: 'Hull integrity', group: null, tile: null, countable: false, instant: true },
  note: { label: 'Note', group: null, tile: null, countable: false, instant: true },
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------------------------------------------------------------- state ----

function blankState() {
  return {
    schema: SCHEMA,
    operator: { name: '', rank: '' },
    mission: { name: '', type: '', startedAt: '' },
    ship: 'havock',
    modules: { power: true, damage: true },
    spares: DEFAULT_SPARES,
    entries: [],
  };
}

let state = blankState();

function load() {
  // Storage can throw outright in private modes and embedded webviews, so a
  // failure here has to leave the app usable rather than blank.
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state = {
      ...blankState(),
      ...saved,
      operator: { ...blankState().operator, ...saved.operator },
      mission: { ...blankState().mission, ...saved.mission },
      modules: { ...blankState().modules, ...saved.modules },
      entries: Array.isArray(saved.entries) ? saved.entries.map(migrate) : [],
    };
  } catch {
    state = blankState();
  }
}

/** Bring a stored entry up to the current shape. The swap action shipped
 *  briefly as "crystalSwap" before the part was correctly named a power cell;
 *  without this, those entries would render as a raw kind string and stop
 *  counting towards the tile. */
function migrate(entry) {
  if (entry?.kind === 'crystalSwap') return { ...entry, kind: 'cellSwap' };
  return entry;
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Out of quota or storage denied. The in-memory log still works for this
    // session; say so once rather than failing silently on every keystroke.
    note(setupSaved, 'Could not save to this device — the log will be lost if you reload.');
  }
}

// ---------------------------------------------------------------- time -----

const pad = n => String(n).padStart(2, '0');

function clockTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fullTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function duration(entry) {
  // Instant events carry equal start and end times, which would otherwise
  // format as a misleading "0m 00s" repair.
  if (KINDS[entry.kind]?.instant) return null;
  if (!entry.startedAt || !entry.endedAt) return null;
  const ms = new Date(entry.endedAt) - new Date(entry.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}

/** Value for a datetime-local input, which wants local time with no zone. */
function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ------------------------------------------------------------- elements ----

const $ = id => document.getElementById(id);

const setupForm = $('setupForm');
const opName = $('opName');
const opRank = $('opRank');
const missionStart = $('missionStart');
const missionName = $('missionName');
const missionType = $('missionType');
const setupShip = $('setupShip');
const modPower = $('modPower');
const modDamage = $('modDamage');
const nowBtn = $('nowBtn');
const newMissionBtn = $('newMissionBtn');
const clearSessionBtn = $('clearSessionBtn');
const setupSaved = $('setupSaved');

const logSummary = $('logSummary');
const damageActions = $('damageActions');
const damageDisabledNote = $('damageDisabledNote');
const manualRepairBtn = $('manualRepairBtn');
const noteBtn = $('noteBtn');
const activeList = $('activeList');
const activeCount = $('activeCount');
const loggedCount = $('loggedCount');
const logTableBody = $('logTableBody');
const spareStat = $('spareStat');
const statSpares = $('statSpares');
const spareMinus = $('spareMinus');
const sparePlus = $('sparePlus');
const exportNote = $('exportNote');
const exportChartBtn = $('exportChartBtn');
const cellSwapBtn = $('cellSwapBtn');
const hullBtn = $('hullBtn');
const hullDialog = $('hullDialog');
const hullForm = $('hullForm');
const hullValue = $('hullValue');
const hullQuick = $('hullQuick');
const hullError = $('hullError');
const hullClose = $('hullClose');

const dialog = $('repairDialog');
const dialogTitle = $('repairDialogTitle');
const dialogSub = $('repairDialogSub');
const dialogBody = $('repairDialogBody');
const dialogFoot = $('repairDialogFoot');
const dialogBack = $('dialogBack');
const dialogClose = $('dialogClose');
const dialogConfirm = $('dialogConfirm');

let noteTimer;
function note(el, message) {
  if (!el) return;
  el.textContent = message;
  clearTimeout(noteTimer);
  if (message) noteTimer = setTimeout(() => { el.textContent = ''; }, 4000);
}

// ---------------------------------------------------------- ship targets ---

/** Repair targets for a kind on the current ship, read from the reference data
 *  so the log can never drift from what Damage Control lists. */
function targetsFor(kind) {
  const group = KINDS[kind]?.group;
  if (!group) return [];
  const ship = SHIP_DATA[state.ship];
  const found = ship?.groups.find(g => g.title === group);
  return found ? found.rows.map(([label, location]) => ({ label, location })) : [];
}

const shipName = () => SHIP_DATA[state.ship]?.name || state.ship;

// -------------------------------------------------------------- entries ----

function startRepair(kind, target) {
  const entry = {
    id: uid(),
    kind,
    target: target?.label ?? '',
    location: target?.location ?? '',
    ship: state.ship,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  state.entries.push(entry);
  // A spare is committed when the repair starts, not when it finishes - the
  // part has left the locker either way.
  if (kind === 'ocp') state.spares = Math.max(0, state.spares - 1);
  save();
  render();
  return entry;
}

function completeEntry(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry || entry.endedAt) return;
  entry.endedAt = new Date().toISOString();
  save();
  render();
}

function deleteEntry(id) {
  const i = state.entries.findIndex(e => e.id === id);
  if (i === -1) return;
  // Deleting a mis-logged OCP repair puts its spare back.
  if (state.entries[i].kind === 'ocp') state.spares = Math.min(99, state.spares + 1);
  state.entries.splice(i, 1);
  save();
  render();
}

/** Log something that happens at a moment rather than over a period. */
function logInstant(kind, fields = {}) {
  const now = new Date().toISOString();
  state.entries.push({
    id: uid(),
    kind,
    target: '',
    location: '',
    ship: state.ship,
    startedAt: now,
    endedAt: now,
    ...fields,
  });
  save();
  render();
}

const activeEntries = () => state.entries.filter(e => !e.endedAt);

/** Most recent hull reading, or null if none has been taken. */
function latestHull() {
  return state.entries
    .filter(e => e.kind === 'hull' && typeof e.value === 'number')
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null;
}

// --------------------------------------------------------------- render ----

function renderStats() {
  for (const [kind, meta] of Object.entries(KINDS)) {
    if (!meta.tile) continue;
    const el = $(meta.tile);
    if (el) el.textContent = state.entries.filter(e => e.kind === kind).length;
  }
  statSpares.textContent = state.spares;
  spareStat.classList.toggle('is-low', state.spares <= 1);
  spareStat.classList.toggle('is-out', state.spares === 0);
}

function renderSummary() {
  const { name, rank } = state.operator;
  const who = [rank, name].filter(Boolean).join(' ');
  const bits = [];
  if (who) bits.push(esc(who));
  if (state.mission.name) bits.push(esc(state.mission.name));
  if (state.mission.type) bits.push(esc(state.mission.type));
  bits.push(esc(shipName()));
  if (state.mission.startedAt) bits.push(esc(fullTime(state.mission.startedAt)));

  logSummary.innerHTML = bits.length
    ? bits.join(' &middot; ')
    : 'No mission details yet — fill in the Setup tab.';
}

function renderActive() {
  const rows = activeEntries();
  activeCount.textContent = rows.length;

  if (!rows.length) {
    activeList.innerHTML = '<p class="empty">Nothing in progress.</p>';
    return;
  }

  activeList.innerHTML = rows.map(e => `
    <div class="active-item" data-id="${esc(e.id)}">
      <div class="active-main">
        <span class="active-kind">${esc(KINDS[e.kind]?.label || e.kind)}</span>
        <span class="active-target">${esc(e.target || e.note || '')}</span>
        ${e.location ? `<span class="active-loc">${esc(e.location)}</span>` : ''}
      </div>
      <div class="active-side">
        <span class="active-start">Started ${esc(clockTime(e.startedAt))}</span>
        <button type="button" class="pill-btn solid sm" data-complete="${esc(e.id)}">Complete</button>
        <button type="button" class="mini-btn ghost" data-delete="${esc(e.id)}" aria-label="Discard this entry">&times;</button>
      </div>
    </div>
  `).join('');
}

/** The human-readable pieces of an entry, in display order. Shared by the log
 *  table and the PDF so the two cannot describe an entry differently. */
function detailParts(e) {
  const parts = [];
  if (typeof e.value === 'number') parts.push(`${e.value}%`);
  if (e.target) parts.push(e.target);
  if (e.location) parts.push(e.location);
  if (e.note) parts.push(e.note);
  return parts;
}

function renderLog() {
  const rows = [...state.entries].sort(
    (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
  );
  loggedCount.textContent = rows.length;

  if (!rows.length) {
    logTableBody.innerHTML =
      '<tr><td colspan="5" class="empty">Nothing logged yet.</td></tr>';
    return;
  }

  logTableBody.innerHTML = rows.map(e => {
    const dur = duration(e);
    const detail = detailParts(e).map(esc).join(' — ');
    // An instant event happened at a time; it did not run from one to another.
    const instant = KINDS[e.kind]?.instant;
    const time = instant
      ? esc(clockTime(e.startedAt))
      : e.endedAt
        ? `${esc(clockTime(e.startedAt))} → ${esc(clockTime(e.endedAt))}`
        : `${esc(clockTime(e.startedAt))} → <em>running</em>`;
    return `<tr class="${e.endedAt ? '' : 'row-active'}">
      <td data-label="Time">${time}</td>
      <td data-label="Action">${esc(KINDS[e.kind]?.label || e.kind)}</td>
      <td data-label="Detail">${detail || '—'}</td>
      <td data-label="Duration">${dur ? esc(dur) : '—'}</td>
      <td data-label="" class="row-tools">
        ${e.endedAt ? '' : `<button type="button" class="mini-btn" data-complete="${esc(e.id)}">End</button>`}
        <button type="button" class="mini-btn ghost" data-delete="${esc(e.id)}" aria-label="Delete entry">&times;</button>
      </td>
    </tr>`;
  }).join('');
}

function renderModules() {
  setModuleVisibility(state.modules);
  const on = state.modules.damage;
  damageActions.hidden = !on;
  damageDisabledNote.hidden = on;
  // The OCP spares counter only means anything alongside damage control.
  spareStat.hidden = !on;
}

function render() {
  renderModules();
  renderStats();
  renderSummary();
  renderActive();
  renderLog();
}

// ---------------------------------------------------------------- setup ----

/** Setting a select to a value it has no option for silently blanks it, so a
 *  stored type from an older list is kept as an extra option rather than
 *  disappearing from the mission the next time Setup is opened. */
function setMissionType(value) {
  if (value && ![...missionType.options].some(o => o.value === value)) {
    missionType.add(new Option(`${value} (not a current type)`, value));
  }
  missionType.value = value;
}

function fillSetupForm() {
  opName.value = state.operator.name;
  opRank.value = state.operator.rank;
  missionName.value = state.mission.name;
  setMissionType(state.mission.type);
  missionStart.value = state.mission.startedAt ? toLocalInput(state.mission.startedAt) : '';
  setupShip.value = state.ship;
  modPower.checked = state.modules.power;
  modDamage.checked = state.modules.damage;
}

function readSetupForm() {
  state.operator.name = opName.value.trim();
  state.operator.rank = opRank.value.trim();
  state.mission.name = missionName.value.trim();
  state.mission.type = missionType.value.trim();
  // datetime-local has no zone; treat what was typed as local wall time.
  state.mission.startedAt = missionStart.value
    ? new Date(missionStart.value).toISOString()
    : '';
  state.ship = setupShip.value;
  state.modules.power = modPower.checked;
  state.modules.damage = modDamage.checked;
  setShip(state.ship);
  save();
  render();
}

setupForm.addEventListener('input', readSetupForm);
setupForm.addEventListener('change', readSetupForm);
setupForm.addEventListener('submit', e => e.preventDefault());

nowBtn.addEventListener('click', () => {
  missionStart.value = toLocalInput(new Date().toISOString());
  readSetupForm();
  note(setupSaved, 'Start time set.');
});

// Starting the next watch, not wiping the device: the operator, their ship and
// their section choices carry over, while everything specific to the mission
// that just ended is cleared.
newMissionBtn.addEventListener('click', () => {
  const count = state.entries.length;
  if (count) {
    const warning =
      `Start a new mission? This clears the mission name and type and deletes ` +
      `${count} logged ${count === 1 ? 'action' : 'actions'}, and resets spare OCPs to ` +
      `${DEFAULT_SPARES}.\n\nYour name, rank, ship and section choices are kept.\n\n` +
      `Export the log first if you need to keep it — this cannot be undone.`;
    if (!confirm(warning)) return;
  }

  state.mission = { name: '', type: '', startedAt: new Date().toISOString() };
  state.entries = [];
  state.spares = DEFAULT_SPARES;

  save();
  fillSetupForm();
  render();
  note(setupSaved, 'New mission started.');
});

clearSessionBtn.addEventListener('click', () => {
  const count = state.entries.length;
  const warning = count
    ? `Clear all mission details and delete ${count} logged ${count === 1 ? 'action' : 'actions'}? This cannot be undone.`
    : 'Clear all mission details?';
  if (!confirm(warning)) return;
  state = blankState();
  try { localStorage.removeItem(STORE_KEY); } catch { /* nothing to clean up */ }
  fillSetupForm();
  setShip(state.ship);
  render();
  note(setupSaved, 'Mission data cleared.');
});

// Keep the Damage Control tab's own ship picker in step with Setup.
document.getElementById('shipSelect')?.addEventListener('change', e => {
  state.ship = e.target.value;
  setupShip.value = state.ship;
  save();
  render();
});

// --------------------------------------------------------------- dialog ----

let dialogStep = null;

function openDialog() {
  showRoot();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog() {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function showRoot() {
  dialogStep = null;
  dialogTitle.textContent = 'Manual repair';
  dialogSub.textContent = `${shipName()} — what needs repairing?`;
  dialogBack.hidden = true;
  dialogFoot.hidden = true;
  dialogBody.innerHTML = `
    <div class="choice-grid">
      <button type="button" class="choice" data-kind="ocp">
        <strong>OCP</strong><small>Uses a spare — ${state.spares} left</small>
      </button>
      <button type="button" class="choice" data-kind="crystal">
        <strong>Crystals</strong><small>${targetsFor('crystal').length} locations</small>
      </button>
      <button type="button" class="choice" data-kind="conduit">
        <strong>Destabilisation conduits</strong><small>Select one or more</small>
      </button>
      <button type="button" class="choice" data-kind="reactor">
        <strong>Reactor</strong><small>Starts timing straight away</small>
      </button>
    </div>`;
  dialogBody.querySelector('.choice')?.focus();
}

function showTargets(kind) {
  dialogStep = kind;
  const targets = targetsFor(kind);
  dialogTitle.textContent = KINDS[kind].label;
  dialogBack.hidden = false;

  if (kind === 'conduit') {
    dialogSub.textContent = 'Conduits usually drop in groups — tick every one that is offline, then confirm.';
    dialogFoot.hidden = false;
    dialogBody.innerHTML = `<div class="check-list">${targets.map((t, i) => `
      <label class="check">
        <input type="checkbox" value="${esc(t.label)}" data-loc="${esc(t.location)}"${i === 0 ? '' : ''}>
        <span><strong>Conduit ${esc(t.label)}</strong><small>${esc(t.location)}</small></span>
      </label>`).join('')}</div>`;
    dialogBody.querySelector('input')?.focus();
    updateConfirm();
    return;
  }

  dialogSub.textContent = kind === 'ocp'
    ? `Starts the repair clock and uses a spare. ${state.spares} left.`
    : 'Starts the repair clock.';
  dialogFoot.hidden = true;
  dialogBody.innerHTML = `<div class="choice-grid">${targets.map(t => `
    <button type="button" class="choice" data-target="${esc(t.label)}" data-loc="${esc(t.location)}">
      <strong>${esc(t.label)}</strong><small>${esc(t.location)}</small>
    </button>`).join('')}</div>`;
  dialogBody.querySelector('.choice')?.focus();
}

function updateConfirm() {
  const n = dialogBody.querySelectorAll('input:checked').length;
  dialogConfirm.disabled = n === 0;
  dialogConfirm.textContent = n > 1 ? `Confirm ${n} conduits` : 'Confirm';
}

dialogBody.addEventListener('change', () => {
  if (dialogStep === 'conduit') updateConfirm();
});

dialogBody.addEventListener('click', e => {
  const kindBtn = e.target.closest('[data-kind]');
  if (kindBtn) {
    const kind = kindBtn.dataset.kind;
    if (kind === 'reactor') {
      startRepair('reactor', { label: 'Reactor', location: '' });
      closeDialog();
      note(exportNote, 'Reactor repair started.');
    } else {
      showTargets(kind);
    }
    return;
  }

  const targetBtn = e.target.closest('[data-target]');
  if (targetBtn && dialogStep) {
    startRepair(dialogStep, {
      label: targetBtn.dataset.target,
      location: targetBtn.dataset.loc,
    });
    closeDialog();
    note(exportNote, `${KINDS[dialogStep].label} started: ${targetBtn.dataset.target}.`);
  }
});

dialogConfirm.addEventListener('click', () => {
  const picked = [...dialogBody.querySelectorAll('input:checked')];
  if (!picked.length) return;
  // One entry per conduit so the running total counts each repair, but they
  // share a start time because they went offline together.
  const startedAt = new Date().toISOString();
  picked.forEach(input => {
    state.entries.push({
      id: uid(),
      kind: 'conduit',
      target: input.value,
      location: input.dataset.loc || '',
      ship: state.ship,
      startedAt,
      endedAt: null,
    });
  });
  save();
  render();
  closeDialog();
  note(exportNote, `${picked.length} conduit ${picked.length === 1 ? 'repair' : 'repairs'} started.`);
});

dialogBack.addEventListener('click', showRoot);
dialogClose.addEventListener('click', closeDialog);
manualRepairBtn.addEventListener('click', openDialog);

noteBtn.addEventListener('click', () => {
  const text = prompt('Log a note');
  if (!text || !text.trim()) return;
  logInstant('note', { note: text.trim() });
});

// A cell swap is its own action, not a repair: one tap, no target menu and
// no repair clock, because the swap is the whole event.
cellSwapBtn.addEventListener('click', () => {
  logInstant('cellSwap');
  note(exportNote, `Power cell swap logged at ${clockTime(new Date().toISOString())}.`);
});

// ---------------------------------------------------------------- hull -----

function openHull() {
  hullError.textContent = '';
  const last = latestHull();
  hullValue.value = last ? last.value : '';
  if (typeof hullDialog.showModal === 'function') hullDialog.showModal();
  else hullDialog.setAttribute('open', '');
  hullValue.focus();
  hullValue.select();
}

function closeHull() {
  if (typeof hullDialog.close === 'function') hullDialog.close();
  else hullDialog.removeAttribute('open');
}

hullBtn.addEventListener('click', openHull);
hullClose.addEventListener('click', closeHull);

hullQuick.addEventListener('click', e => {
  const btn = e.target.closest('[data-value]');
  if (!btn) return;
  hullValue.value = btn.dataset.value;
  hullError.textContent = '';
});

hullForm.addEventListener('submit', e => {
  e.preventDefault();
  const raw = hullValue.value.trim();
  const n = Number(raw);
  // A number input reports '' for text it cannot parse, so an empty value here
  // covers both "typed nothing" and "typed something unparseable".
  if (raw === '' || !Number.isFinite(n)) {
    hullError.textContent = 'Enter the hull integrity as a number from 0 to 100.';
    return;
  }
  if (n < 0 || n > 100) {
    hullError.textContent = 'Hull integrity is a percentage — it has to be between 0 and 100.';
    return;
  }
  logInstant('hull', { value: Math.round(n) });
  closeHull();
  note(exportNote, `Hull integrity logged at ${Math.round(n)}%.`);
});

// Complete and delete buttons exist in both the in-progress list and the log
// table, so both are handled by one delegated listener each.
document.addEventListener('click', e => {
  const done = e.target.closest('[data-complete]');
  if (done) completeEntry(done.dataset.complete);
  const del = e.target.closest('[data-delete]');
  if (del && confirm('Delete this entry?')) deleteEntry(del.dataset.delete);
});

spareMinus.addEventListener('click', () => {
  state.spares = Math.max(0, state.spares - 1);
  save(); renderStats();
});
sparePlus.addEventListener('click', () => {
  state.spares = Math.min(99, state.spares + 1);
  save(); renderStats();
});

// --------------------------------------------------------------- export ----

function exportPayload() {
  return {
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    operator: { ...state.operator },
    mission: { ...state.mission },
    ship: { id: state.ship, name: shipName() },
    modules: { ...state.modules },
    spares: { start: DEFAULT_SPARES, remaining: state.spares, used: Math.max(0, DEFAULT_SPARES - state.spares) },
    hull: {
      latest: latestHull()?.value ?? null,
      latestAt: latestHull()?.startedAt ?? null,
      readings: state.entries
        .filter(e => e.kind === 'hull' && typeof e.value === 'number')
        .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
        .map(e => ({ at: e.startedAt, value: e.value })),
    },
    totals: Object.fromEntries(
      Object.keys(KINDS).map(k => [k, state.entries.filter(e => e.kind === k).length])
    ),
    entries: state.entries.map(e => ({
      id: e.id,
      kind: e.kind,
      target: e.target || null,
      location: e.location || null,
      note: e.note || null,
      value: typeof e.value === 'number' ? e.value : null,
      ship: e.ship,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
      // Instant events carry endedAt === startedAt, which would export as a
      // zero-second repair rather than a point in time.
      durationSeconds: KINDS[e.kind]?.instant || !e.endedAt
        ? null
        : Math.max(0, Math.round((new Date(e.endedAt) - new Date(e.startedAt)) / 1000)),
    })),
  };
}

// ---------------------------------------------------------- hull chart -----

/** Hull readings oldest first — the series the chart plots. */
function hullSeries() {
  return state.entries
    .filter(e => e.kind === 'hull' && typeof e.value === 'number')
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
}

// Two palettes: the dark one matches the app for the standalone PNG, the light
// one is for the PDF, which is printed on a white page.
const CHART_THEMES = {
  dark: {
    bg: '#152238', panel: '#1C2A46', grid: '#2A3A5C', text: '#EAF0FB',
    muted: '#8FA0BE', line: '#4FA8C9', warn: '#E39A3E', danger: '#EE7B7B',
  },
  light: {
    bg: '#FFFFFF', panel: '#F4F6FA', grid: '#D3DAE6', text: '#14171F',
    muted: '#59627A', line: '#17708F', warn: '#9A6410', danger: '#A82F2F',
  },
};

/**
 * Draw the hull integrity series onto a canvas and return it.
 * Returns null when there is nothing to plot.
 */
function renderHullChart({ theme = 'dark', width = 760, height = 340, scale = 2 } = {}) {
  const series = hullSeries();
  if (!series.length) return null;

  const c = CHART_THEMES[theme] || CHART_THEMES.dark;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';

  const font = (size, weight = 400) =>
    `${weight} ${size}px "Exo 2", system-ui, -apple-system, sans-serif`;

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, width, height);

  // Header
  const who = [state.operator.rank, state.operator.name].filter(Boolean).join(' ');
  ctx.fillStyle = c.text;
  ctx.font = font(15, 700);
  ctx.fillText('Hull Integrity', 24, 26);
  ctx.fillStyle = c.muted;
  ctx.font = font(11);
  ctx.fillText(
    [state.mission.name, shipName(), who].filter(Boolean).join(' · '),
    24, 45
  );

  const pad = { top: 66, right: 22, bottom: 40, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const x = i => {
    // Position by timestamp so uneven reading intervals show honestly. When
    // every reading shares a timestamp the span is zero, so fall back to even
    // spacing rather than dividing by zero.
    if (series.length === 1) return pad.left + plotW / 2;
    const t0 = new Date(series[0].startedAt).getTime();
    const t1 = new Date(series[series.length - 1].startedAt).getTime();
    const span = t1 - t0;
    const frac = span > 0
      ? (new Date(series[i].startedAt).getTime() - t0) / span
      : i / (series.length - 1);
    return pad.left + frac * plotW;
  };
  const y = v => pad.top + (1 - v / 100) * plotH;

  // Danger and caution bands, so a low reading reads as low at a glance.
  ctx.fillStyle = c.danger;
  ctx.globalAlpha = 0.10;
  ctx.fillRect(pad.left, y(25), plotW, y(0) - y(25));
  ctx.fillStyle = c.warn;
  ctx.fillRect(pad.left, y(50), plotW, y(25) - y(50));
  ctx.globalAlpha = 1;

  // Gridlines
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = c.muted;
  ctx.font = font(10);
  ctx.textAlign = 'right';
  for (const v of [0, 25, 50, 75, 100]) {
    const gy = Math.round(y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(pad.left + plotW, gy);
    ctx.stroke();
    ctx.fillText(`${v}%`, pad.left - 8, gy);
  }

  // Series line
  if (series.length > 1) {
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    series.forEach((e, i) => (i ? ctx.lineTo(x(i), y(e.value)) : ctx.moveTo(x(i), y(e.value))));
    ctx.stroke();
  }

  // Points, coloured by band
  series.forEach((e, i) => {
    ctx.fillStyle = e.value <= 25 ? c.danger : e.value <= 50 ? c.warn : c.line;
    ctx.beginPath();
    ctx.arc(x(i), y(e.value), series.length > 40 ? 2.5 : 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Time labels: at most six, so they never collide.
  ctx.fillStyle = c.muted;
  ctx.font = font(10);
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.ceil(series.length / 6));
  series.forEach((e, i) => {
    if (i % step && i !== series.length - 1) return;
    ctx.fillText(clockTime(e.startedAt), x(i), height - pad.bottom + 16);
  });

  // Latest reading, called out.
  const last = series[series.length - 1];
  ctx.textAlign = 'right';
  ctx.fillStyle = last.value <= 25 ? c.danger : last.value <= 50 ? c.warn : c.text;
  ctx.font = font(15, 700);
  ctx.fillText(`${last.value}%`, width - pad.right, 26);
  ctx.fillStyle = c.muted;
  ctx.font = font(10);
  ctx.fillText(
    `${series.length} reading${series.length === 1 ? '' : 's'} · latest ${clockTime(last.startedAt)}`,
    width - pad.right, 45
  );

  ctx.textAlign = 'left';
  return canvas;
}

function fileStem() {
  const bits = ['ucn-log', state.mission.name || 'mission', shipName()];
  return bits.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The chart on its own, as a PNG. Deliberately not a one-page PDF: a PNG drops
// straight into a debrief or a chat window, and it needs no PDF library, so it
// works even if that never loads.
exportChartBtn.addEventListener('click', () => {
  const canvas = renderHullChart({ theme: 'dark', width: 900, height: 400, scale: 2 });
  if (!canvas) {
    note(exportNote, 'No hull readings logged yet — nothing to chart.');
    return;
  }
  canvas.toBlob(blob => {
    if (!blob) {
      note(exportNote, 'Could not build the chart image.');
      return;
    }
    download(blob, `${fileStem()}-hull.png`);
    note(exportNote, 'Hull chart exported.');
  }, 'image/png');
});

$('exportJsonBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
  download(blob, `${fileStem()}.json`);
  note(exportNote, 'JSON exported.');
});

// jsPDF is 360KB, and most sessions never export, so it is only fetched when
// the button is actually pressed.
let jsPdfLoading;
function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  jsPdfLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf?.jsPDF);
    s.onerror = () => reject(new Error('failed to load PDF library'));
    document.head.appendChild(s);
  });
  return jsPdfLoading;
}

$('exportPdfBtn').addEventListener('click', async () => {
  note(exportNote, 'Building PDF…');
  let jsPDF;
  try {
    jsPDF = await loadJsPdf();
  } catch {
    note(exportNote, 'Could not load the PDF library. Export JSON instead.');
    return;
  }
  if (!jsPDF) {
    note(exportNote, 'Could not load the PDF library. Export JSON instead.');
    return;
  }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 40;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = M;

  const line = (text, { size = 10, bold = false, gap = 14, colour = [20, 20, 20] } = {}) => {
    if (y > H - M) { doc.addPage(); y = M; }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...colour);
    doc.text(String(text), M, y);
    y += gap;
  };

  line('UCN Engineering Action Log', { size: 16, bold: true, gap: 20 });

  const who = [state.operator.rank, state.operator.name].filter(Boolean).join(' ');
  line(`Operator: ${who || '—'}`);
  line(`Mission: ${state.mission.name || '—'}${state.mission.type ? ` (${state.mission.type})` : ''}`);
  line(`Ship: ${shipName()}`);
  line(`Mission start: ${state.mission.startedAt ? fullTime(state.mission.startedAt) : '—'}`);
  line(`Exported: ${fullTime(new Date().toISOString())}`);
  y += 6;

  line('Totals', { size: 12, bold: true, gap: 16 });
  for (const [kind, meta] of Object.entries(KINDS)) {
    // Wider than the on-screen tiles: reactor repairs are worth counting in a
    // written report even though they do not need watching mid-mission.
    if (!meta.countable) continue;
    const n = state.entries.filter(e => e.kind === kind).length;
    // "Power cell swapped" is already past tense; appending an s to every
    // label would read as "Power cell swappeds".
    line(`${meta.label}${meta.label.endsWith('d') ? '' : 's'}: ${n}`);
  }
  line(`Spare OCPs remaining: ${state.spares} of ${DEFAULT_SPARES}`);

  const hull = latestHull();
  const readings = state.entries.filter(e => e.kind === 'hull' && typeof e.value === 'number');
  line(hull
    ? `Hull integrity: ${hull.value}% at ${clockTime(hull.startedAt)} (${readings.length} reading${readings.length === 1 ? '' : 's'})`
    : 'Hull integrity: not recorded');
  y += 10;

  // Hull chart, on the light palette because the page is white. Skipped
  // entirely when no readings were taken rather than printing an empty axis.
  const chart = renderHullChart({ theme: 'light', width: 760, height: 340, scale: 2 });
  if (chart) {
    const imgW = W - M * 2;
    const imgH = imgW * (340 / 760);
    if (y + imgH > H - M) { doc.addPage(); y = M; }
    try {
      // The compression argument matters enormously here: jsPDF stores the
      // bitmap raw without it, which took this report from 29KB to 4MB.
      // PNG rather than JPEG so the thin plot lines and labels stay sharp.
      doc.addImage(chart.toDataURL('image/png'), 'PNG', M, y, imgW, imgH, undefined, 'FAST');
      y += imgH + 18;
    } catch {
      // An unembeddable image should cost the chart, not the whole report.
      line('Hull chart unavailable.', { colour: [120, 120, 120] });
    }
  }

  line('Entries', { size: 12, bold: true, gap: 16 });

  const cols = [M, M + 96, M + 190, M + 330, M + 430];
  const header = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    ['Started', 'Ended', 'Action', 'Detail', 'Duration']
      .forEach((h, i) => doc.text(h, cols[i], y));
    y += 6;
    doc.setDrawColor(200);
    doc.line(M, y, W - M, y);
    y += 12;
  };
  header();

  const sorted = [...state.entries].sort(
    (a, b) => new Date(a.startedAt) - new Date(b.startedAt)
  );

  if (!sorted.length) {
    line('No actions logged.', { colour: [120, 120, 120] });
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    for (const e of sorted) {
      if (y > H - M - 20) { doc.addPage(); y = M; header(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); }
      doc.setTextColor(20, 20, 20);
      const detail = detailParts(e).join(' — ');
      doc.text(clockTime(e.startedAt), cols[0], y);
      // Instant events have equal start and end times; repeating the clock
      // would read as a zero-length repair rather than a point in time.
      doc.text(
        KINDS[e.kind]?.instant ? '—' : (e.endedAt ? clockTime(e.endedAt) : 'running'),
        cols[1], y
      );
      doc.text(KINDS[e.kind]?.label || e.kind, cols[2], y);
      doc.text(doc.splitTextToSize(detail || '—', 95)[0] || '—', cols[3], y);
      doc.text(duration(e) || '—', cols[4], y);
      y += 14;
    }
  }

  doc.save(`${fileStem()}.pdf`);
  note(exportNote, 'PDF exported.');
});

// ----------------------------------------------------------------- init ----

load();
fillSetupForm();
setShip(state.ship);
render();
