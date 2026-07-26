// ============ TAB SWITCHING (top bar + bottom mobile bar, kept in sync) ============
const allTabBtns = document.querySelectorAll('.tab-btn, .bottom-tab-btn');
const panels = document.querySelectorAll('.panel');

function activateTab(name){
  allTabBtns.forEach(b=>{
    const isMatch = b.dataset.tab === name;
    b.classList.toggle('active', isMatch);
    b.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    // Roving tabindex: only the selected tab in each bar is a tab stop, so
    // Tab moves past the tablist and the arrow keys move within it.
    b.tabIndex = isMatch ? 0 : -1;
  });
  panels.forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
}

allTabBtns.forEach(btn=>{
  btn.addEventListener('click', ()=> activateTab(btn.dataset.tab));

  btn.addEventListener('keydown', e=>{
    const KEYS = {ArrowRight:1, ArrowDown:1, ArrowLeft:-1, ArrowUp:-1};
    const isEdge = e.key === 'Home' || e.key === 'End';
    if(!(e.key in KEYS) && !isEdge) return;
    e.preventDefault();

    // Move within the bar the focused tab belongs to, so the visible bar
    // (top on desktop, bottom on phone) is the one that gets focus.
    const bar = [...btn.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
    const from = bar.indexOf(btn);
    const to = isEdge
      ? (e.key === 'Home' ? 0 : bar.length - 1)
      : (from + KEYS[e.key] + bar.length) % bar.length;

    activateTab(bar[to].dataset.tab);
    bar[to].focus();
  });
});

// ============ WARP GUIDE DATA ============
// distance: number of sectors, or Infinity for the all-distance fallback setup
const WARP_TABLE = [
  { distance:5,  warpLevel:'Warp 4', warpPower:'210%', warpCoolant:'100%', reactorPower:'100%', reactorCoolant:'0%',  topSpeed:'8.40U/s', travelTime:'~21s' },
  { distance:10, warpLevel:'Warp 3', warpPower:'135%', warpCoolant:'100%', reactorPower:'100%', reactorCoolant:'0%',  topSpeed:'4.05U/s', travelTime:'57s' },
  { distance:15, warpLevel:'Warp 2', warpPower:'160%', warpCoolant:'100%', reactorPower:'100%', reactorCoolant:'0%',  topSpeed:'3.20U/s', travelTime:'1m 39s' },
  { distance:20, warpLevel:'Warp 2', warpPower:'155%', warpCoolant:'100%', reactorPower:'100%', reactorCoolant:'0%',  topSpeed:'3.10U/s', travelTime:'2m 14s' },
  { distance:25, warpLevel:'Warp 2', warpPower:'150%', warpCoolant:'100%', reactorPower:'100%', reactorCoolant:'0%',  topSpeed:'3.00U/s', travelTime:'2m 52s' },
  { distance:30, warpLevel:'Warp 2', warpPower:'145%', warpCoolant:'100%', reactorPower:'100%', reactorCoolant:'0%',  topSpeed:'2.90U/s', travelTime:'3m 32s' },
  { distance:35, warpLevel:'Warp 2', warpPower:'145%', warpCoolant:'100%', reactorPower:'100%', reactorCoolant:'0%',  topSpeed:'2.90U/s', travelTime:'4m 07s' },
  { distance:40, warpLevel:'Warp 2', warpPower:'145%', warpCoolant:'100%', reactorPower:'100%', reactorCoolant:'0%',  topSpeed:'2.90U/s', travelTime:'4m 40s' },
  { distance:45, warpLevel:'Warp 2', warpPower:'140%', warpCoolant:'100%', reactorPower:'100%', reactorCoolant:'0%',  topSpeed:'2.80U/s', travelTime:'5m 26s' },
  { distance:50, warpLevel:'Warp 2', warpPower:'140%', warpCoolant:'100%', reactorPower:'100%', reactorCoolant:'0%',  topSpeed:'2.80U/s', travelTime:'6m 02s' },
  { distance:Infinity, warpLevel:'Warp 1', warpPower:'125%', warpCoolant:'55%', reactorPower:'170%', reactorCoolant:'45%', topSpeed:'1.25U/s', travelTime:'—' },
];

const warpBody = document.getElementById('warpTableBody');
const sectorInput = document.getElementById('sectorInput');
const sectorClear = document.getElementById('sectorClear');
const warpNote = document.getElementById('warpNote');
const warpIntro = document.getElementById('warpIntro');
const modeBtns = document.querySelectorAll('.mode-btn');
const distanceControls = document.getElementById('distanceControls');
const levelControls = document.getElementById('levelControls');
const warpLevelBtns = document.querySelectorAll('#warpLevelBtns button');

let warpMode = 'distance'; // 'distance' | 'level' | 'all'
let selectedLevel = null;  // '1' | '2' | '3' | '4'

const MODE_INTROS = {
  distance: 'Enter a distance to see the recommended warp setup. If your distance falls between two tabled entries, both bracketing rows are shown. Leave blank to see the all-distance (∞) setup.',
  level: 'Pick a warp level to see every tabled distance that uses it.',
  all: 'Every tabled distance and its recommended setup, in order.'
};

function distLabel(row){
  return row.distance === Infinity ? '∞' : row.distance + ' sectors';
}

function renderRow(row, cls){
  return `<tr class="${cls || ''}">
    <td data-label="Distance">${distLabel(row)}</td>
    <td data-label="Warp Level">${row.warpLevel}</td>
    <td data-label="Warp Power">${row.warpPower}</td>
    <td data-label="Warp Coolant">${row.warpCoolant}</td>
    <td data-label="Reactor Power">${row.reactorPower}</td>
    <td data-label="Reactor Coolant">${row.reactorCoolant}</td>
    <td data-label="Top Speed">${row.topSpeed}</td>
    <td data-label="Travel Time">${row.travelTime}</td>
  </tr>`;
}

function renderByDistance(){
  const raw = sectorInput.value.trim();

  // A number input reports value === '' for input it holds but cannot parse
  // ('-', '.', '1e', '1-2'), which is indistinguishable from an empty field
  // unless badInput is checked. Without this, a half-typed number silently
  // renders the infinity setup as though it were the answer.
  // (Pure letters never get this far - the browser drops those keystrokes.)
  if(sectorInput.validity && sectorInput.validity.badInput){
    warpBody.innerHTML = '';
    warpNote.textContent = 'That is not a number \u2014 enter a sector count, e.g. 6.';
    return;
  }

  if(raw === ''){
    const infRow = WARP_TABLE[WARP_TABLE.length - 1];
    warpBody.innerHTML = renderRow(infRow, 'exact-highlight');
    warpNote.textContent = 'Showing the all-distance (\u221E) setup. Enter a sector count above for a distance-specific recommendation.';
    return;
  }

  const n = Number(raw);
  if(!Number.isFinite(n) || n <= 0){
    warpBody.innerHTML = '';
    warpNote.textContent = 'Enter a positive number of sectors.';
    return;
  }

  const tabled = WARP_TABLE.filter(r => r.distance !== Infinity);
  const exact = tabled.find(r => r.distance === n);

  if(exact){
    warpBody.innerHTML = renderRow(exact, 'exact-highlight');
    warpNote.textContent = `Exact match for ${n} sectors.`;
    return;
  }

  if(n < tabled[0].distance){
    warpBody.innerHTML = renderRow(tabled[0], 'bracket-highlight');
    warpNote.textContent = `${n} sectors is below the shortest tabled distance (${tabled[0].distance}) \u2014 showing the nearest entry.`;
    return;
  }

  if(n > tabled[tabled.length - 1].distance){
    const last = tabled[tabled.length - 1];
    const inf = WARP_TABLE[WARP_TABLE.length - 1];
    warpBody.innerHTML = renderRow(last, 'bracket-highlight') + renderRow(inf, 'bracket-highlight');
    warpNote.textContent = `${n} sectors is beyond the longest tabled distance (${last.distance}) \u2014 showing the longest tabled entry and the all-distance (\u221E) setup.`;
    return;
  }

  // n is inside the tabled range and not an exact match, so a bracketing
  // pair is guaranteed to exist by this point.
  let lower, upper;
  for(let i = 0; i < tabled.length - 1; i++){
    if(tabled[i].distance <= n && tabled[i+1].distance >= n){
      lower = tabled[i];
      upper = tabled[i+1];
      break;
    }
  }
  warpBody.innerHTML = renderRow(lower, 'bracket-highlight') + renderRow(upper, 'bracket-highlight');
  warpNote.textContent = `${n} sectors falls between ${lower.distance} and ${upper.distance} sectors \u2014 showing both bracketing setups.`;
}

function renderByLevel(){
  if(!selectedLevel){
    warpBody.innerHTML = '';
    warpNote.textContent = 'Choose a warp level above.';
    return;
  }
  const label = 'Warp ' + selectedLevel;
  const matches = WARP_TABLE.filter(r => r.warpLevel === label);
  if(matches.length === 0){
    warpBody.innerHTML = '';
    warpNote.textContent = `No tabled distances use ${label}.`;
    return;
  }
  warpBody.innerHTML = matches.map(r => renderRow(r, 'bracket-highlight')).join('');

  // The infinity row is a distance-agnostic fallback rather than a tabled
  // distance, so saying "all tabled distances" would contradict the row on
  // screen - Warp 1 matches nothing but that fallback.
  const tabledMatches = matches.filter(r => r.distance !== Infinity);
  if(tabledMatches.length === 0){
    warpNote.textContent = `${label} is only used by the all-distance (∞) setup — no specific tabled distance uses it.`;
  } else if(matches.length > tabledMatches.length){
    warpNote.textContent = `Showing all tabled distances that use ${label}, plus the all-distance (∞) setup.`;
  } else {
    warpNote.textContent = `Showing all tabled distances that use ${label}.`;
  }
}

function renderAll(){
  warpBody.innerHTML = WARP_TABLE.map(r => renderRow(r)).join('');
  warpNote.textContent = `Showing all ${WARP_TABLE.length} tabled setups.`;
}

function renderWarpTable(){
  if(warpMode === 'distance') renderByDistance();
  else if(warpMode === 'level') renderByLevel();
  else renderAll();
}

modeBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    modeBtns.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    modeBtns.forEach(b=>b.setAttribute('aria-pressed', String(b === btn)));
    warpMode = btn.dataset.mode;
    warpIntro.innerHTML = MODE_INTROS[warpMode];
    distanceControls.style.display = (warpMode === 'distance') ? 'flex' : 'none';
    levelControls.style.display = (warpMode === 'level') ? 'flex' : 'none';
    renderWarpTable();
  });
});

warpLevelBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    warpLevelBtns.forEach(b=>{
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    selectedLevel = btn.dataset.level;
    renderWarpTable();
  });
});

sectorInput.addEventListener('input', renderWarpTable);
sectorClear.addEventListener('click', ()=>{ sectorInput.value=''; renderWarpTable(); });

warpIntro.innerHTML = MODE_INTROS[warpMode];
renderWarpTable();

// ============ DAMAGE CONTROL DATA ============
const SHIP_DATA = {
  havock:{
    name:'UCS Havock',
    map:'ship-maps/HAVOCK_SHIP_MAP.pdf',
    groups:[
      {
        title:'OCPs',
        rows:[
          ['Navigation', 'Bridge (by helm)'],
          ['Impulse', 'Engineering Corridor (by engineering aux screen)'],
          ['Missiles', 'Engineering Corridor (middle)'],
        ]
      },
      {
        title:'Crystals',
        note:'Charger located in the Ready Room',
        rows:[
          ['Beams', 'Ready Room'],
          ['Shields (Fore/Front)', 'Bridge'],
          ['Shields (Aft/Rear)', 'Engineering (mid)'],
        ]
      },
      {
        title:'Destabilisation Conduits',
        rows:[
          ['1', 'Bridge'],
          ['2', 'Ready Room'],
          ['3', 'Engineering (by OCP locker)'],
          ['4', 'Engineering (by aux engineering screen)'],
          ['5', 'Ready Room'],
        ]
      }
    ]
  },
  takanami:{
    name:'UCS Takanami',
    map:'ship-maps/Takanami_Ship_Map.pdf',
    groups:[
      {
        title:'OCPs',
        rows:[
          ['Navigation', 'Bridge (by nav station)'],
          ['Impulse', 'Midship'],
          ['Missiles', 'Aft Engineering'],
        ]
      },
      {
        title:'Crystals',
        note:'Charger located in Medbay',
        rows:[
          ['Beams', 'Medbay'],
          ['Shields (Fore/Front)', 'Bridge'],
          ['Shields (Aft/Rear)', 'Engineering'],
        ]
      },
      {
        title:'Destabilisation Conduits',
        rows:[
          ['1', 'Bridge'],
          ['2', 'Engineering'],
          ['3', 'Cargo Bay'],
          ['4', 'Midship (by aux engineering screen)'],
          ['5', 'Medbay'],
        ]
      }
    ]
  }
};

const shipSelect = document.getElementById('shipSelect');
const viewMapBtn = document.getElementById('viewMapBtn');
const dcGroups = document.getElementById('dcGroups');

function renderShip(){
  const ship = SHIP_DATA[shipSelect.value];
  dcGroups.innerHTML = ship.groups.map(g => `
    <div class="dc-card">
      <h3>${g.title}</h3>
      ${g.note ? `<p class="dc-note">${g.note}</p>` : ''}
      ${g.rows.map(([k,v]) => `<div class="dc-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
    </div>
  `).join('');
}

viewMapBtn.addEventListener('click', ()=>{
  const ship = SHIP_DATA[shipSelect.value];
  window.open(ship.map, '_blank', 'noopener');
});

shipSelect.addEventListener('change', renderShip);
renderShip();
