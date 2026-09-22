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
// A second, independently-written copy of the same state. localStorage writes
// are not guaranteed atomic against an interrupted flush (an app killed by
// the OS mid-write, on a phone, is exactly the kind of interruption this tool
// has to survive), so a single corrupted key would otherwise mean load()
// silently resetting to blank with no way back. The backup lags the primary
// by nothing under normal operation - both are written every save() - but a
// torn write is very unlikely to hit both keys at once.
const BACKUP_KEY = STORE_KEY + '-backup';
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

// ------------------------------------------------------- canon operations --

// Named missions with a known type, the way a player would recognise
// "OPERATION TEDDER" as Military on sight. Typing or picking one of these
// exactly (matching is case-insensitive) tells Setup what kind of mission it
// is; anything else typed into Mission Name is simply an ordinary free-text
// name - this list is a convenience layered on top of free text, never a
// restriction on it.
const OPERATIONS = [
  ['OPERATION TEDDER', 'Military'],
  ['ITHAKA MINING FACILITY', 'Military'],
  ['OPERATION ALCHEMIST', 'Military'],
  ['OPERATION CLAYMORE', 'Military'],
  ['OPERATION COPIAPO', 'Military'],
  ['OPERATION HANUMAN', 'Military'],
  ['OPERATION MENDICANT', 'Military'],
  ['OPERATION QUICKSTEP', 'Military'],
  ['OPERATION SILK ROAD', 'Military'],
  ['OPERATION TECUMSEH', 'Military'],
  ['OPERATION VIA MARIS', 'Military'],
  ['OPERATION AMUNDSEN', 'Exploration'],
  ['OPERATION OBELISK', 'Exploration'],
  ['OPERATION SARGASSO', 'Exploration'],
  ['OPERATION ADAMAN', 'Exploration'],
  ['OPERATION MARCONI', 'Exploration'],
  ['OPERATION SISTEMA', 'Exploration'],
  ['OPERATION VANGUARD', 'Exploration'],
  ['OPERATION REDENTOR', 'Diplomacy'],
  ['OPERATION BARATARIA', 'Diplomacy'],
  ['OPERATION CLARITY', 'Diplomacy'],
  ['OPERATION KISMET', 'Diplomacy'],
  ['OPERATION PHILBY', 'Diplomacy'],
  ['OPERATION PITCHFORK', 'Diplomacy'],
  ['TERRA NOVAN DIPLOMATIC INCIDENT', 'Diplomacy'],
  ['OPERATION ANTIMONY', 'Intrigue'],
  ['OPERATION CAMINO', 'Intrigue'],
  ['OPERATION EURYDICE', 'Intrigue'],
  ['OPERATION MOCKINGBIRD', 'Intrigue'],
  ['OPERATION TELEGRAM', 'Intrigue'],
  ['OPERATION ARGUS', 'Intrigue'],
  ['OPERATION RECOIL', 'Intrigue'],
];

const OPERATION_TYPE_BY_NAME = new Map(
  OPERATIONS.map(([name, type]) => [name.toUpperCase(), type])
);

/** The canon type for a mission name, or null when it isn't a listed
 *  operation - the ordinary case for a free-text mission name. */
function operationType(name) {
  return OPERATION_TYPE_BY_NAME.get(String(name || '').trim().toUpperCase()) || null;
}

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

/** Parse a stored value, returning null for "nothing there" as well as for
 *  "there but unreadable" - the caller tells those apart by checking `raw`
 *  itself, since which one it is changes what the user should be told. */
function tryParse(raw) {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return {
      ...blankState(),
      ...saved,
      operator: { ...blankState().operator, ...saved.operator },
      mission: { ...blankState().mission, ...saved.mission },
      modules: { ...blankState().modules, ...saved.modules },
      entries: Array.isArray(saved.entries) ? saved.entries.map(migrate) : [],
    };
  } catch {
    return null;
  }
}

function load() {
  // Storage can throw outright in private modes and embedded webviews, so a
  // failure here has to leave the app usable rather than blank.
  let primaryRaw = null;
  try {
    primaryRaw = localStorage.getItem(STORE_KEY);
    const parsed = tryParse(primaryRaw);
    if (parsed) { state = parsed; return; }
  } catch {
    // Reading itself threw; fall through to the backup exactly as if the
    // primary had been unparseable.
  }

  // The primary key existed but did not parse (or reading it threw) - this is
  // corruption, most likely a write interrupted by the app or OS, not "never
  // used before". Try the backup before giving up on the mission entirely.
  if (primaryRaw) {
    let backupRaw = null;
    try { backupRaw = localStorage.getItem(BACKUP_KEY); } catch { /* also gone */ }
    const fromBackup = tryParse(backupRaw);
    if (fromBackup) {
      state = fromBackup;
      pendingStorageNotice = {
        kind: 'recovered',
        message: 'The saved mission was unreadable and has been restored from a backup — check the log looks right.',
      };
      return;
    }
    pendingStorageNotice = {
      kind: 'corrupted',
      message: 'The saved mission was unreadable and no backup could be recovered. Starting a blank mission.',
    };
  }

  state = blankState();
}

/** Bring a stored entry up to the current shape. The swap action shipped
 *  briefly as "crystalSwap" before the part was correctly named a power cell;
 *  without this, those entries would render as a raw kind string and stop
 *  counting towards the tile. */
function migrate(entry) {
  if (entry?.kind === 'crystalSwap') return { ...entry, kind: 'cellSwap' };
  return entry;
}

// A notice discovered during load(), before the DOM/banner exist yet. Flushed
// once init wires up the banner element.
let pendingStorageNotice = null;

function save() {
  const json = JSON.stringify(state);
  try {
    localStorage.setItem(STORE_KEY, json);
  } catch {
    // Out of quota, storage denied (Safari Private Browsing caps it at zero),
    // or a managed device locking it down. The in-memory session still works,
    // but nothing here survives a reload - and this can keep failing on every
    // single keystroke, so a banner that stays up (rather than the old
    // approach of a message on the Setup tab, invisible from every other tab)
    // is the only honest way to tell the user before they lose real work.
    showStorageBanner(
      'write-failure',
      'Not saving to this device — your changes will be lost if you reload or close this tab. Export now to keep them.'
    );
    return;
  }
  // Mirror to the backup key. A failure here does not block the primary save
  // - the backup is a bonus, not a requirement - but it is worth knowing
  // about if it keeps happening, since it means recovery from corruption
  // would not be possible either.
  try {
    localStorage.setItem(BACKUP_KEY, json);
  } catch { /* primary save already succeeded; backup is best-effort */ }

  // Only clears a write-failure notice. A cross-tab warning or a
  // just-recovered-from-corruption notice is not resolved by this save
  // succeeding - if anything, writing now is the moment most likely to
  // silently overwrite whatever another tab has, so it stays up.
  hideStorageBanner('write-failure');
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
const operationNamesList = $('operationNames');
const operationHint = $('operationHint');
const operationHintText = $('operationHintText');
const operationHintApply = $('operationHintApply');
const missionType = $('missionType');
const setupShip = $('setupShip');

// Populated once from OPERATIONS - the single source of truth the hint logic
// below also reads from, so the suggestions offered while typing can never
// drift from the names that are actually recognised.
operationNamesList.innerHTML = OPERATIONS
  .map(([name]) => `<option value="${esc(name)}"></option>`)
  .join('');
const modPower = $('modPower');
const modDamage = $('modDamage');
const nowBtn = $('nowBtn');
const newMissionBtn = $('newMissionBtn');
const clearSessionBtn = $('clearSessionBtn');
const setupSaved = $('setupSaved');

const storageBanner = $('storageBanner');
const storageBannerText = $('storageBannerText');
const storageBannerExport = $('storageBannerExport');
const storageBannerReload = $('storageBannerReload');
const storageBannerDismiss = $('storageBannerDismiss');

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
const completeAllBtn = $('completeAllBtn');
const toast = $('toast');
const toastText = $('toastText');
const toastUndo = $('toastUndo');
const editDialog = $('editDialog');
const editForm = $('editForm');
const editDialogSub = $('editDialogSub');
const editTargetField = $('editTargetField');
const editTarget = $('editTarget');
const editValueField = $('editValueField');
const editValue = $('editValue');
const editStart = $('editStart');
const editEndField = $('editEndField');
const editEnd = $('editEnd');
const editClearEnd = $('editClearEnd');
const editError = $('editError');
const editClose = $('editClose');
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

// One timeout per element rather than one shared variable, so a note() call
// on, say, exportNote cannot cancel-and-replace the pending clear for an
// unrelated element like setupSaved - the earlier text would otherwise either
// vanish early or, worse, hang around forever once the shared timer had been
// retargeted at someone else.
const noteTimers = new WeakMap();
function note(el, message) {
  if (!el) return;
  el.textContent = message;
  clearTimeout(noteTimers.get(el));
  if (message) noteTimers.set(el, setTimeout(() => { el.textContent = ''; }, 4000));
}

// ------------------------------------------------------ storage health -----

// Which kind of problem the banner is currently showing, if any, and which
// kind the user last dismissed - so a fresh failure of the SAME kind that
// keeps recurring (e.g. every keystroke while storage is unwritable) does not
// fight a dismissal the user already made, but a genuinely different problem
// still gets through.
let bannerKind = null;
let bannerDismissedKind = null;

function showStorageBanner(kind, message, { reload = false } = {}) {
  bannerKind = kind;
  if (bannerDismissedKind === kind) return;
  storageBannerText.textContent = message;
  storageBannerReload.hidden = !reload;
  storageBanner.hidden = false;
}

/** Clear the banner, but only if it is currently showing `onlyKind` - so, for
 *  instance, a write succeeding can retire a "not saving" notice without also
 *  swallowing an unrelated cross-tab warning that happens to be showing. */
function hideStorageBanner(onlyKind) {
  if (onlyKind && bannerKind !== onlyKind) return;
  storageBanner.hidden = true;
  bannerKind = null;
  bannerDismissedKind = null;
}

storageBannerDismiss.addEventListener('click', () => {
  bannerDismissedKind = bannerKind;
  storageBanner.hidden = true;
});

storageBannerExport.addEventListener('click', () => exportJsonNow());
storageBannerReload.addEventListener('click', () => location.reload());

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

/** Whole seconds since an ISO timestamp, never negative. */
function elapsedSeconds(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

function formatElapsed(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function renderActive() {
  const rows = activeEntries();
  activeCount.textContent = rows.length;
  // Closing several repairs one at a time is the usual case after a group of
  // conduits drops together, so offer it once there is more than one.
  completeAllBtn.hidden = rows.length < 2;

  if (!rows.length) {
    activeList.innerHTML = '<p class="empty">Nothing in progress.</p>';
    stopElapsedTimer();
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
        <span class="active-elapsed" data-elapsed="${esc(e.startedAt)}"
              role="timer" aria-label="Time running">${esc(formatElapsed(elapsedSeconds(e.startedAt)))}</span>
        <span class="active-start">from ${esc(clockTime(e.startedAt))}</span>
        <button type="button" class="pill-btn solid sm" data-complete="${esc(e.id)}">Complete</button>
        <button type="button" class="mini-btn" data-edit="${esc(e.id)}" aria-label="Edit this entry">Edit</button>
        <button type="button" class="mini-btn ghost" data-delete="${esc(e.id)}" aria-label="Discard this entry">&times;</button>
      </div>
    </div>
  `).join('');

  startElapsedTimer();
}

// ------------------------------------------------------- elapsed ticking ---

let elapsedTimer = null;

/** Update the running clocks in place. Rewriting the list every second would
 *  destroy focus and any in-flight tap. */
function tickElapsed() {
  const cells = activeList.querySelectorAll('[data-elapsed]');
  if (!cells.length) {
    stopElapsedTimer();
    return;
  }
  cells.forEach(cell => {
    cell.textContent = formatElapsed(elapsedSeconds(cell.dataset.elapsed));
  });
}

function startElapsedTimer() {
  // Only tick while the log is actually on screen: a background tab is
  // throttled anyway, and re-rendering costs battery for nothing.
  if (elapsedTimer || document.hidden) return;
  if (!document.getElementById('panel-log')?.classList.contains('active')) return;
  elapsedTimer = setInterval(tickElapsed, 1000);
}

function stopElapsedTimer() {
  if (!elapsedTimer) return;
  clearInterval(elapsedTimer);
  elapsedTimer = null;
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
        <button type="button" class="mini-btn" data-edit="${esc(e.id)}" aria-label="Edit entry">Edit</button>
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

/** Same reasoning as setMissionType: Rank moved from free text to a fixed
 *  list, and a select silently blanks any value it has no option for. A rank
 *  saved under the old free-text field is kept as an extra option rather than
 *  disappearing the next time Setup is opened. */
function setOpRank(value) {
  if (value && ![...opRank.options].some(o => o.value === value)) {
    opRank.add(new Option(`${value} (not a current rank)`, value));
  }
  opRank.value = value;
}

/**
 * Recognise a canon operation name in Mission Name and surface its type.
 *
 * Only fills Mission Type in when it is currently blank - once it holds any
 * value, whether set by hand a moment ago or by this function, typing never
 * silently overwrites it again, so a value the user can already see on
 * screen is never changed without their say-so. When the name matches a
 * known operation but the type disagrees, a one-click "Use X" makes the
 * canon type a tap away instead of forcing it.
 */
function updateOperationHint() {
  const matched = operationType(missionName.value);

  if (!matched) {
    operationHint.hidden = true;
    return;
  }

  if (!missionType.value) setMissionType(matched);

  const inSync = missionType.value === matched;
  operationHint.hidden = false;
  operationHint.classList.toggle('is-matched', inSync);
  operationHint.classList.toggle('is-mismatch', !inSync);
  operationHintApply.hidden = inSync;

  if (inSync) {
    operationHintText.textContent = `Known operation — ${matched}.`;
  } else {
    operationHintText.textContent = `Known operation — canon type is ${matched}.`;
    operationHintApply.textContent = `Use ${matched}`;
  }
}

operationHintApply.addEventListener('click', () => {
  const matched = operationType(missionName.value);
  if (!matched) return;
  setMissionType(matched);
  readSetupForm();
});

function fillSetupForm() {
  opName.value = state.operator.name;
  setOpRank(state.operator.rank);
  missionName.value = state.mission.name;
  setMissionType(state.mission.type);
  missionStart.value = state.mission.startedAt ? toLocalInput(state.mission.startedAt) : '';
  setupShip.value = state.ship;
  modPower.checked = state.modules.power;
  modDamage.checked = state.modules.damage;
  updateOperationHint();
}

function readSetupForm() {
  state.operator.name = opName.value.trim();
  state.operator.rank = opRank.value.trim();
  state.mission.name = missionName.value.trim();
  updateOperationHint(); // may fill a blank Mission Type from a known name
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
  try {
    localStorage.removeItem(STORE_KEY);
    // Otherwise a stale backup could resurrect the cleared mission the next
    // time the primary write happens to fail and load() falls back to it.
    localStorage.removeItem(BACKUP_KEY);
  } catch { /* nothing to clean up */ }
  hideStorageBanner();
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
  if (del) deleteWithUndo(del.dataset.delete);

  const edit = e.target.closest('[data-edit]');
  if (edit) openEdit(edit.dataset.edit);
});

completeAllBtn.addEventListener('click', () => {
  const running = activeEntries();
  if (!running.length) return;
  const at = new Date().toISOString();
  running.forEach(entry => { entry.endedAt = at; });
  save();
  render();
  note(exportNote, `Completed ${running.length} repairs.`);
});

// ---------------------------------------------------------------- undo -----

let undoTimer = null;
let pending = null;

function hideToast() {
  toast.hidden = true;
  clearTimeout(undoTimer);
  undoTimer = null;
  pending = null;
}

/**
 * Delete straight away and offer an undo, rather than asking first.
 *
 * A confirm dialog mid-mission gets dismissed on reflex and protects nobody;
 * an undo costs one tap only when the delete was actually wrong.
 */
function deleteWithUndo(id) {
  const index = state.entries.findIndex(e => e.id === id);
  if (index === -1) return;

  const entry = state.entries[index];
  pending = { entry, index, spare: entry.kind === 'ocp' };

  state.entries.splice(index, 1);
  if (pending.spare) state.spares = Math.min(99, state.spares + 1);
  save();
  render();

  toastText.textContent = `${KINDS[entry.kind]?.label || entry.kind} deleted.`;
  toast.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideToast, 9000);
}

toastUndo.addEventListener('click', () => {
  if (!pending) return;
  // Back to where it was, so the log does not reshuffle on undo.
  state.entries.splice(Math.min(pending.index, state.entries.length), 0, pending.entry);
  if (pending.spare) state.spares = Math.max(0, state.spares - 1);
  save();
  render();
  hideToast();
});

// ---------------------------------------------------------------- edit -----

let editingId = null;

/** "HH:MM:SS" for a time input. */
function toTimeInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Apply a "HH:MM[:SS]" wall time to the date the entry already carries, so
 *  correcting a time never silently moves the entry to today. */
function withTime(iso, value) {
  const [h, m, s] = value.split(':').map(Number);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || Number.isNaN(h) || Number.isNaN(m)) return null;
  d.setHours(h, m, Number.isFinite(s) ? s : 0, 0);
  return d.toISOString();
}

function openEdit(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  editingId = id;
  editError.textContent = '';

  const meta = KINDS[entry.kind] || {};
  editDialogSub.textContent = `${meta.label || entry.kind} — logged ${fullTime(entry.startedAt)}`;

  const isHull = entry.kind === 'hull';
  const isNote = entry.kind === 'note';
  editValueField.hidden = !isHull;
  editTargetField.hidden = isHull;
  // An instant event has no separate end to correct.
  editEndField.hidden = !!meta.instant;

  editTarget.value = isNote ? (entry.note || '') : (entry.target || '');
  editTarget.previousElementSibling.textContent = isNote ? 'Note' : 'Detail';
  editValue.value = isHull && typeof entry.value === 'number' ? entry.value : '';
  editStart.value = toTimeInput(entry.startedAt);
  editEnd.value = entry.endedAt ? toTimeInput(entry.endedAt) : '';

  if (typeof editDialog.showModal === 'function') editDialog.showModal();
  else editDialog.setAttribute('open', '');
}

function closeEdit() {
  editingId = null;
  if (typeof editDialog.close === 'function') editDialog.close();
  else editDialog.removeAttribute('open');
}

editClose.addEventListener('click', closeEdit);
editClearEnd.addEventListener('click', () => { editEnd.value = ''; });

editForm.addEventListener('submit', e => {
  e.preventDefault();
  const entry = state.entries.find(en => en.id === editingId);
  if (!entry) return closeEdit();

  const meta = KINDS[entry.kind] || {};

  if (!editStart.value) {
    editError.textContent = 'A start time is required.';
    return;
  }
  const startedAt = withTime(entry.startedAt, editStart.value);
  if (!startedAt) {
    editError.textContent = 'That start time could not be read.';
    return;
  }

  let endedAt = null;
  if (meta.instant) {
    // Instant events keep start and end together by definition.
    endedAt = startedAt;
  } else if (editEnd.value) {
    endedAt = withTime(entry.endedAt || entry.startedAt, editEnd.value);
    if (!endedAt) {
      editError.textContent = 'That end time could not be read.';
      return;
    }
    if (new Date(endedAt) < new Date(startedAt)) {
      editError.textContent = 'The repair cannot end before it started.';
      return;
    }
  }

  if (entry.kind === 'hull') {
    const n = Number(editValue.value);
    if (editValue.value === '' || !Number.isFinite(n) || n < 0 || n > 100) {
      editError.textContent = 'Hull integrity is a percentage from 0 to 100.';
      return;
    }
    entry.value = Math.round(n);
  } else if (entry.kind === 'note') {
    entry.note = editTarget.value.trim();
  } else {
    entry.target = editTarget.value.trim();
  }

  entry.startedAt = startedAt;
  entry.endedAt = endedAt;

  save();
  render();
  closeEdit();
  note(exportNote, 'Entry updated.');
});

// ------------------------------------------------------------ wake lock ----

let wakeLock = null;

/**
 * Keep the screen on while the log is open.
 *
 * Repairs are timed against this screen, and a phone locking mid-repair means
 * unlocking it in a dark, busy compartment. The lock is dropped whenever the
 * log is not the visible panel so it never holds the screen awake pointlessly.
 */
async function updateWakeLock() {
  const wanted = !document.hidden &&
    document.getElementById('panel-log')?.classList.contains('active');

  if (!wanted) {
    if (wakeLock) {
      try { await wakeLock.release(); } catch { /* already gone */ }
      wakeLock = null;
    }
    return;
  }

  if (wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    // The system drops the lock on its own when the page is hidden; clear the
    // handle so the next visit re-requests instead of assuming it still holds.
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // Refused, unsupported, or the battery saver says no.
    wakeLock = null;
  }
}

/** The log tab becoming visible drives both the ticking clock and the lock. */
function onLogVisibilityChanged() {
  if (document.getElementById('panel-log')?.classList.contains('active') && !document.hidden) {
    tickElapsed();
    startElapsedTimer();
  } else {
    stopElapsedTimer();
  }
  updateWakeLock();
}

document.addEventListener('visibilitychange', onLogVisibilityChanged);
document.querySelectorAll('[role="tab"]').forEach(tab => {
  tab.addEventListener('click', onLogVisibilityChanged);
  tab.addEventListener('keydown', () => setTimeout(onLogVisibilityChanged, 0));
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

// Named rather than inline so the storage-health banner's "Export now" button
// can trigger the exact same export - the one moment a user most needs it is
// while storage is failing, and that shortcut has to do precisely what the
// regular button does.
function exportJsonNow() {
  const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
  download(blob, `${fileStem()}.json`);
  note(exportNote, 'JSON exported.');
}

$('exportJsonBtn').addEventListener('click', exportJsonNow);

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

/** Shape the mission for the report builder: the PDF module owns layout, this
 *  owns what the words say. */
function reportData() {
  const who = [state.operator.rank, state.operator.name].filter(Boolean).join(' ');
  const readings = hullSeries();
  const used = Math.max(0, DEFAULT_SPARES - state.spares);

  return {
    meta: [
      ['Operator', who],
      ['Mission', state.mission.name],
      ['Type', state.mission.type],
      ['Ship', shipName()],
      ['Mission start', state.mission.startedAt ? fullTime(state.mission.startedAt) : ''],
      ['Exported', fullTime(new Date().toISOString())],
    ],

    totals: Object.entries(KINDS)
      .filter(([, meta]) => meta.countable)
      .map(([kind, meta]) => [
        meta.label + (meta.label.endsWith('d') ? '' : 's'),
        String(state.entries.filter(e => e.kind === kind).length),
      ]),

    sparesLine: `${state.spares} of ${DEFAULT_SPARES} remaining` +
      (used ? `, ${used} used during this mission.` : '. None used.'),

    hullSummary: readings.length
      ? `${readings.length} reading${readings.length === 1 ? '' : 's'} taken. ` +
        `Latest ${readings[readings.length - 1].value}% at ` +
        `${clockTime(readings[readings.length - 1].startedAt)}.`
      : '',
    hullPoints: readings.map(e => ({ value: e.value, label: clockTime(e.startedAt) })),
    hullRows: readings.map(e => [clockTime(e.startedAt), e.value + '%']),

    logRows: [...state.entries]
      .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
      .map(e => {
        const instant = KINDS[e.kind]?.instant;
        return [
          clockTime(e.startedAt),
          instant ? '—' : (e.endedAt ? clockTime(e.endedAt) : 'Running'),
          KINDS[e.kind]?.label || e.kind,
          detailParts(e).join(' — ') || '—',
          duration(e) || '—',
        ];
      }),

    // Free text typed by the operator. The report draws it as text and nothing
    // more; anything that looks like an instruction inside it is content.
    notes: state.entries
      .filter(e => e.kind === 'note' && e.note)
      .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
      .map(e => ({ title: clockTime(e.startedAt), text: e.note })),
  };
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

  try {
    const { buildMissionReport } = await import('./pdf-report.js');
    const doc = await buildMissionReport(jsPDF, reportData(), {
      logoUrl: 'assets/ucn-logo-white.png',
    });
    doc.save(`${fileStem()}.pdf`);
    note(exportNote, 'PDF exported.');
  } catch (err) {
    note(exportNote, 'Could not build the PDF. Export JSON instead.');
    console.error(err);
  }
});

// -------------------------------------------------------------- storage ----

/**
 * Ask the browser not to evict this origin's data.
 *
 * Without this, localStorage is "best effort": a browser under storage
 * pressure can clear it with no warning and no recovery, which for this tool
 * means losing a mission log part-way through an event. The request is
 * granted silently on an installed app and is harmless when refused.
 */
async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch {
    // Unsupported or blocked. The log still works, it is just evictable.
  }
}

// ------------------------------------------------------- cross-tab watch ---

/**
 * Warn when another tab or window writes to the same mission.
 *
 * localStorage has no built-in sync between contexts: this tool now installs
 * as a home-screen app, and an installed app plus a leftover browser tab are
 * two independent instances of the same origin, each with its own in-memory
 * `state`, each happily calling save() on its own schedule. Without this,
 * whichever one saves last silently wins and the other's edits are gone with
 * no error, no warning - which is exactly the failure mode this exists to
 * catch. The storage event only ever fires in the OTHER context, never the
 * one that made the write, so this can never trigger on our own saves.
 */
window.addEventListener('storage', e => {
  if (e.key !== STORE_KEY) return;
  // Ignore a write that happens to match what we already have - most likely
  // another tab loading the same untouched mission, not a real divergence.
  if (e.newValue === JSON.stringify(state)) return;
  showStorageBanner(
    'cross-tab',
    'This mission changed in another tab or window. Reload to see the latest — further changes here may overwrite it.',
    { reload: true }
  );
});

// ----------------------------------------------------------------- init ----

load();
fillSetupForm();
setShip(state.ship);
render();
requestPersistentStorage();
onLogVisibilityChanged();

// Surface anything load() found on the way in, now that the banner exists.
if (pendingStorageNotice) {
  showStorageBanner(pendingStorageNotice.kind, pendingStorageNotice.message);
  pendingStorageNotice = null;
}
