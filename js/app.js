// ============ TAB SWITCHING ============
const tabBtns = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.panel');

tabBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    tabBtns.forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
    panels.forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected','true');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
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
  { distance:Infinity, warpLevel:'Warp 1', warpPower:'125%', warpCoolant:'55%', reactorPower:'170%', reactorCoolant:'45%', topSpeed:'1.25U/s', travelTime:'&mdash;' },
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
  distance: 'Enter a distance to see the recommended warp setup. If your distance falls between two tabled entries, both bracketing rows are shown. Leave blank to see the all-distance (&infin;) setup.',
  level: 'Pick a warp level to see every tabled distance that uses it.',
  all: 'Every tabled distance and its recommended setup, in order.'
};

function distLabel(row){
  return row.distance === Infinity ? '&infin;' : row.distance + ' sectors';
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

  let lower = tabled[0], upper = tabled[tabled.length - 1];
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
  warpNote.textContent = `Showing all tabled distances that use ${label}.`;
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
    warpMode = btn.dataset.mode;
    warpIntro.innerHTML = MODE_INTROS[warpMode];
    distanceControls.style.display = (warpMode === 'distance') ? 'flex' : 'none';
    levelControls.style.display = (warpMode === 'level') ? 'flex' : 'none';
    renderWarpTable();
  });
});

warpLevelBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    warpLevelBtns.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    selectedLevel = btn.dataset.level;
    renderWarpTable();
  });
});

sectorInput.addEventListener('input', renderWarpTable);
sectorClear.addEventListener('click', ()=>{ sectorInput.value=''; renderWarpTable(); });
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
  window.open(ship.map, '_blank');
});

shipSelect.addEventListener('change', renderShip);
renderShip();
