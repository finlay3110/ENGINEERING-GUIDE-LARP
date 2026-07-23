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

function distLabel(row){
  return row.distance === Infinity ? '&infin;' : row.distance + ' sectors';
}

function renderRow(row, cls){
  return `<tr class="${cls || ''}">
    <td>${distLabel(row)}</td>
    <td>${row.warpLevel}</td>
    <td>${row.warpPower}</td>
    <td>${row.warpCoolant}</td>
    <td>${row.reactorPower}</td>
    <td>${row.reactorCoolant}</td>
    <td>${row.topSpeed}</td>
    <td>${row.travelTime}</td>
  </tr>`;
}

function renderWarpTable(){
  const raw = sectorInput.value.trim();

  if(raw === ''){
    // default: show the all-distance (infinite) fallback setup
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

  // find the two bracketing rows
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
