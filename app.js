/* ============================================================
   SynthPad — app.js
   Web Audio API synth pad with effects, recording, sequencer
   ============================================================ */

'use strict';

// ── Audio Context ──────────────────────────────────────────
let audioCtx = null;
function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ── Master chain: gain → reverb → delay → distortion → filter → dest ──
let masterGain, reverbNode, reverbWet, delayNode, delayWet, distNode, distWet, filterNode, analyser, mediaRecorder;
let reverbBuffer = null;
let recordedChunks = [];
let recordingStartTime = 0;
let recTimerInterval = null;
let recordedBlob = null;

function buildMasterChain() {
  const ctx = getCtx();
  masterGain  = ctx.createGain(); masterGain.gain.value = 0.8;
  filterNode  = ctx.createBiquadFilter(); filterNode.type = 'lowpass'; filterNode.frequency.value = 20000;
  analyser    = ctx.createAnalyser(); analyser.fftSize = 256;

  // Reverb
  reverbNode  = ctx.createConvolver();
  reverbWet   = ctx.createGain(); reverbWet.gain.value = 0.2;
  buildReverbIR();

  // Delay
  delayNode   = ctx.createDelay(2); delayNode.delayTime.value = 0.35;
  delayWet    = ctx.createGain(); delayWet.gain.value = 0;
  const delayFB = ctx.createGain(); delayFB.gain.value = 0.4;

  // Distortion
  distNode    = ctx.createWaveShaper();
  distWet     = ctx.createGain(); distWet.gain.value = 0;
  updateDistCurve(0);

  // Routing: masterGain → filter → analyser → dest
  masterGain.connect(filterNode);
  filterNode.connect(analyser);
  analyser.connect(ctx.destination);

  // Reverb send
  masterGain.connect(reverbNode);
  reverbNode.connect(reverbWet);
  reverbWet.connect(ctx.destination);

  // Delay send
  masterGain.connect(delayNode);
  delayNode.connect(delayWet);
  delayWet.connect(ctx.destination);
  delayNode.connect(delayFB);
  delayFB.connect(delayNode);

  // Distortion send
  masterGain.connect(distNode);
  distNode.connect(distWet);
  distWet.connect(ctx.destination);

  // Recording
  const dest = ctx.createMediaStreamDestination();
  analyser.connect(dest);
  reverbWet.connect(dest); delayWet.connect(dest); distWet.connect(dest);
  mediaRecorder = new MediaRecorder(dest.stream);
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(recordedChunks, { type: 'audio/webm' });
    document.getElementById('playbackBtn').disabled = false;
    document.getElementById('downloadBtn').disabled = false;
    setRecStatus('Recorded ✓');
  };
}

function buildReverbIR() {
  const ctx = getCtx();
  const len = ctx.sampleRate * 2.5;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
  }
  reverbNode.buffer = ir;
}

function updateDistCurve(amount) {
  const n = 256, curve = new Float32Array(n), k = amount * 4;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
  }
  if (distNode) distNode.curve = curve;
}

// ── Pad Definitions ───────────────────────────────────────
const PAD_KEYS = ['1','2','3','4','q','w','e','r','a','s','d','f','z','x','c','v'];
const COLORS   = ['purple','cyan','amber','red','green','blue','pink','orange','purple','cyan','amber','red','green','blue','pink','orange'];

const PAD_DATA = {
  drums: [
    { name:'Kick',    emoji:'🥁', freq:60,  type:'sine',   dur:0.4, sweep:true  },
    { name:'Snare',   emoji:'🪘', freq:200, type:'noise',  dur:0.2, sweep:false },
    { name:'Hi-Hat',  emoji:'🎵', freq:800, type:'noise',  dur:0.08,sweep:false, hpf:true },
    { name:'Open Hat',emoji:'🎶', freq:800, type:'noise',  dur:0.4, sweep:false, hpf:true },
    { name:'Clap',    emoji:'👏', freq:300, type:'noise',  dur:0.15,sweep:false },
    { name:'Tom Hi',  emoji:'🥁', freq:120, type:'sine',   dur:0.3, sweep:true  },
    { name:'Tom Lo',  emoji:'🥁', freq:80,  type:'sine',   dur:0.4, sweep:true  },
    { name:'Rimshot', emoji:'🪗', freq:400, type:'square', dur:0.1, sweep:false },
    { name:'Cowbell', emoji:'🔔', freq:562, type:'square', dur:0.5, sweep:false },
    { name:'Shaker',  emoji:'🎵', freq:5000,type:'noise',  dur:0.12,sweep:false, hpf:true },
    { name:'Crash',   emoji:'💥', freq:700, type:'noise',  dur:1.2, sweep:false, hpf:true },
    { name:'Ride',    emoji:'🎷', freq:1200,type:'noise',  dur:0.8, sweep:false, hpf:true },
    { name:'Perc 1',  emoji:'🪗', freq:900, type:'sine',   dur:0.2, sweep:true  },
    { name:'Perc 2',  emoji:'🎸', freq:440, type:'triangle',dur:0.3,sweep:true  },
    { name:'Snap',    emoji:'🫰', freq:2000,type:'noise',  dur:0.05,sweep:false },
    { name:'Kick 2',  emoji:'🥁', freq:50,  type:'sine',   dur:0.6, sweep:true  },
  ],
  synth: [
    { name:'Bass C',  emoji:'🎹', freq:65.4, type:'sawtooth',dur:0.8 },
    { name:'Bass F',  emoji:'🎹', freq:87.3, type:'sawtooth',dur:0.8 },
    { name:'Lead A',  emoji:'🎸', freq:440,  type:'square',  dur:0.5 },
    { name:'Lead D',  emoji:'🎸', freq:293.7,type:'square',  dur:0.5 },
    { name:'Pad C',   emoji:'🌊', freq:261.6,type:'sine',    dur:2.0 },
    { name:'Pad E',   emoji:'🌊', freq:329.6,type:'sine',    dur:2.0 },
    { name:'Pad G',   emoji:'🌊', freq:392,  type:'sine',    dur:2.0 },
    { name:'Sub C',   emoji:'💫', freq:32.7, type:'sine',    dur:0.6 },
    { name:'Arp Hi',  emoji:'⚡', freq:880,  type:'triangle',dur:0.3 },
    { name:'Arp Lo',  emoji:'⚡', freq:220,  type:'triangle',dur:0.3 },
    { name:'Chord',   emoji:'🎵', freq:261.6,type:'sawtooth',dur:1.0, chord:true },
    { name:'Stab',    emoji:'🗡️', freq:440, type:'sawtooth',dur:0.15 },
    { name:'Pluck',   emoji:'🎸', freq:523.3,type:'triangle',dur:0.4 },
    { name:'Bell',    emoji:'🔔', freq:1046, type:'sine',    dur:1.5 },
    { name:'Drone',   emoji:'〰️', freq:110,  type:'sawtooth',dur:3.0 },
    { name:'Blip',    emoji:'👾', freq:1200, type:'square',  dur:0.08 },
  ],
  nature: [
    { name:'Rain',    emoji:'🌧️', freq:800, type:'noise',dur:1.5, lpf:1200 },
    { name:'Thunder', emoji:'⛈️', freq:80,  type:'noise',dur:2.0, lpf:300  },
    { name:'Wind',    emoji:'🌬️', freq:600, type:'noise',dur:2.0, lpf:900  },
    { name:'Ocean',   emoji:'🌊', freq:200, type:'noise',dur:2.5, lpf:500  },
    { name:'Fire',    emoji:'🔥', freq:300, type:'noise',dur:1.0, lpf:800  },
    { name:'Crickets',emoji:'🦗', freq:3000,type:'noise',dur:1.0, lpf:4000 },
    { name:'Birds',   emoji:'🐦', freq:2000,type:'sine', dur:0.5, sweep:true },
    { name:'Frog',    emoji:'🐸', freq:300, type:'sine', dur:0.3, sweep:true },
    { name:'Leaves',  emoji:'🍃', freq:4000,type:'noise',dur:0.5, lpf:6000 },
    { name:'Brook',   emoji:'💧', freq:1000,type:'noise',dur:1.5, lpf:2000 },
    { name:'Cave',    emoji:'🦇', freq:500, type:'noise',dur:2.0, lpf:700  },
    { name:'Volcano', emoji:'🌋', freq:50,  type:'noise',dur:1.0, lpf:200  },
    { name:'Storm',   emoji:'🌩️', freq:100, type:'noise',dur:2.0, lpf:400  },
    { name:'Hail',    emoji:'🧊', freq:6000,type:'noise',dur:0.4, lpf:8000 },
    { name:'Fog',     emoji:'🌫️', freq:400, type:'noise',dur:2.0, lpf:600  },
    { name:'Snow',    emoji:'❄️', freq:5000,type:'noise',dur:1.0, lpf:7000 },
  ],
  fx: [
    { name:'Laser',   emoji:'🔴', freq:2000,type:'sine',   dur:0.3, sweep:true, sweepEnd:200  },
    { name:'Zap',     emoji:'⚡', freq:800, type:'square', dur:0.2, sweep:true, sweepEnd:100  },
    { name:'Boom',    emoji:'💥', freq:100, type:'sine',   dur:0.8, sweep:true, sweepEnd:20   },
    { name:'Warp',    emoji:'🌀', freq:400, type:'sawtooth',dur:0.5,sweep:true, sweepEnd:2000 },
    { name:'Glitch',  emoji:'👾', freq:1000,type:'square', dur:0.15,sweep:false },
    { name:'Sci-Fi',  emoji:'🚀', freq:500, type:'sine',   dur:1.0, sweep:true, sweepEnd:1500 },
    { name:'Alarm',   emoji:'🚨', freq:880, type:'square', dur:0.4, sweep:false },
    { name:'Sonar',   emoji:'📡', freq:1000,type:'sine',   dur:0.8, sweep:true, sweepEnd:200  },
    { name:'Rewind',  emoji:'⏪', freq:2000,type:'sawtooth',dur:0.4,sweep:true, sweepEnd:200  },
    { name:'UFO',     emoji:'🛸', freq:300, type:'sine',   dur:1.5, sweep:true, sweepEnd:600  },
    { name:'Swoosh',  emoji:'💨', freq:1500,type:'noise',  dur:0.3  },
    { name:'Click',   emoji:'🖱️', freq:3000,type:'sine',  dur:0.04 },
    { name:'Ping',    emoji:'📶', freq:2000,type:'sine',   dur:0.6  },
    { name:'Pop',     emoji:'💬', freq:200, type:'sine',   dur:0.05 },
    { name:'Buzz',    emoji:'🐝', freq:150, type:'square', dur:0.3  },
    { name:'Rise',    emoji:'📈', freq:100, type:'sawtooth',dur:1.0,sweep:true, sweepEnd:2000 },
  ],
  custom: []
};

// ── State ─────────────────────────────────────────────────
let currentCategory = 'drums';
let selectedPadIndex = null;
let padSettings = {}; // per-pad overrides: { volume, pitch, loop }
let loopEnabled = false;
let loopSources = {};
let masterVolume = 0.8;
let masterPitch  = 0;    // semitones offset
let currentBpm   = 120;
let seqPlaying   = false;
let seqStep      = 0;
let seqInterval  = null;
let seqNumSteps  = 16;
let seqActiveSteps = {}; // "padIdx_step" => true
let customPads   = [];   // { name, buffer, url }
let showKeyboard = false;

// Synth sound trigger
function triggerPad(padIndex, padDef, fromSeq = false) {
  const ctx = getCtx();
  if (!masterGain) buildMasterChain();

  const settings = padSettings[padIndex] || {};
  const vol   = (settings.volume !== undefined ? settings.volume : 80) / 100;
  const pitch = (settings.pitch  !== undefined ? settings.pitch  : 0) + masterPitch;
  const loop  = settings.loop || loopEnabled;

  // If custom / uploaded
  if (padDef.buffer) {
    playBuffer(padDef.buffer, vol, pitch, loop, padIndex);
    return;
  }

  const freq    = padDef.freq * Math.pow(2, pitch / 12);
  const dur     = padDef.dur || 0.3;
  const output  = ctx.createGain();
  output.gain.setValueAtTime(vol * masterVolume, ctx.currentTime);
  output.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur * 1.2);
  output.connect(masterGain);

  if (padDef.type === 'noise') {
    const bufLen = ctx.sampleRate * dur;
    const nBuf   = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = nBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = nBuf;
    if (padDef.hpf) {
      const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = padDef.freq;
      src.connect(hpf); hpf.connect(output);
    } else if (padDef.lpf) {
      const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = padDef.lpf;
      src.connect(lpf); lpf.connect(output);
    } else { src.connect(output); }
    src.start(); src.stop(ctx.currentTime + dur);
  } else {
    const osc = ctx.createOscillator();
    osc.type = padDef.type || 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (padDef.sweep) {
      const endF = (padDef.sweepEnd || freq * 0.05) * Math.pow(2, pitch / 12);
      osc.frequency.exponentialRampToValueAtTime(Math.max(endF, 1), ctx.currentTime + dur);
    }
    if (padDef.chord) {
      // add major third + fifth
      const osc2 = ctx.createOscillator(); osc2.type = osc.type;
      osc2.frequency.value = freq * 1.259;
      const osc3 = ctx.createOscillator(); osc3.type = osc.type;
      osc3.frequency.value = freq * 1.498;
      osc2.connect(output); osc3.connect(output);
      osc2.start(); osc2.stop(ctx.currentTime + dur);
      osc3.start(); osc3.stop(ctx.currentTime + dur);
    }
    osc.connect(output);
    osc.start(); osc.stop(ctx.currentTime + dur);
  }

  animatePad(padIndex);
}

function playBuffer(buffer, vol, pitch, loop, padIndex) {
  const ctx = getCtx();
  if (loop && loopSources[padIndex]) {
    loopSources[padIndex].stop();
    delete loopSources[padIndex];
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  const rate = Math.pow(2, (pitch + masterPitch) / 12);
  src.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = vol * masterVolume;
  src.connect(g); g.connect(masterGain);
  src.start();
  if (loop) loopSources[padIndex] = src;
  else src.stop(ctx.currentTime + buffer.duration + 0.1);
  animatePad(padIndex);
}

// ── Pad Animation ─────────────────────────────────────────
function animatePad(idx) {
  const el = document.querySelector(`.pad[data-index="${idx}"]`);
  if (!el) return;
  el.classList.add('active');
  const r = document.createElement('span');
  r.className = 'ripple';
  r.style.cssText = 'left:50%;top:50%;margin-left:-20px;margin-top:-20px;';
  el.appendChild(r);
  setTimeout(() => { el.classList.remove('active'); r.remove(); }, 300);
}

// ── Build Pad Grid ────────────────────────────────────────
function buildPadGrid() {
  const grid = document.getElementById('padGrid');
  grid.innerHTML = '';
  const pads = currentCategory === 'custom' ? customPads : PAD_DATA[currentCategory];
  pads.forEach((pad, i) => {
    const key   = PAD_KEYS[i] || '';
    const color = COLORS[i % COLORS.length];
    const div   = document.createElement('div');
    div.className = 'pad has-sound';
    div.dataset.index = i;
    div.dataset.color = color;
    div.setAttribute('data-color', color);
    div.title = `${pad.name} [${key.toUpperCase()}]`;
    div.innerHTML = `
      <span class="pad-key">${key.toUpperCase()}</span>
      <span class="pad-emoji">${pad.emoji || '🎵'}</span>
      <span class="pad-name">${pad.name}</span>
      <div class="pad-progress" id="pp${i}"></div>`;
    div.addEventListener('mousedown', e => {
      e.preventDefault(); getCtx(); if (!masterGain) buildMasterChain();
      triggerPad(i, pad); selectPad(i, pad);
    });
    div.addEventListener('touchstart', e => {
      e.preventDefault(); getCtx(); if (!masterGain) buildMasterChain();
      triggerPad(i, pad); selectPad(i, pad);
    }, { passive: false });
    grid.appendChild(div);
  });
  buildKeyboardMap();
  buildSequencerGrid();
}

function selectPad(idx, padDef) {
  document.querySelectorAll('.pad').forEach(p => p.classList.remove('selected'));
  const el = document.querySelector(`.pad[data-index="${idx}"]`);
  if (el) el.classList.add('selected');
  selectedPadIndex = idx;
  const s = padSettings[idx] || { volume: 80, pitch: 0, loop: false };
  const volEl = document.getElementById('padVolume');
  const pitchEl = document.getElementById('padPitch');
  volEl.value   = s.volume !== undefined ? s.volume : 80;
  pitchEl.value = s.pitch  !== undefined ? s.pitch  : 0;
  document.getElementById('padLoop').checked = s.loop || false;
  document.getElementById('padVolVal').textContent   = `${volEl.value}%`;
  document.getElementById('padPitchVal').textContent = `${pitchEl.value}st`;
  document.getElementById('selectedPadName').textContent = padDef ? padDef.name : 'No pad selected';
  volEl.style.setProperty('--pct', `${(+volEl.value/100)*100}%`);
  pitchEl.style.setProperty('--pct', `${((+pitchEl.value+24)/48)*100}%`);
}

function buildKeyboardMap() {
  const grid = document.getElementById('keyboardMapGrid');
  grid.innerHTML = '';
  const pads = currentCategory === 'custom' ? customPads : PAD_DATA[currentCategory];
  pads.slice(0, 16).forEach((pad, i) => {
    const item = document.createElement('div');
    item.className = 'km-item';
    item.innerHTML = `<span class="km-key">${(PAD_KEYS[i]||'').toUpperCase()}</span><span class="km-name">${pad.name}</span>`;
    grid.appendChild(item);
  });
}

document.getElementById('categoryTabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentCategory = btn.dataset.category;
  selectedPadIndex = null; seqActiveSteps = {};
  buildPadGrid();
});

document.addEventListener('keydown', e => {
  if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const idx = PAD_KEYS.indexOf(e.key.toLowerCase());
  if (idx === -1) return;
  const pads = currentCategory === 'custom' ? customPads : PAD_DATA[currentCategory];
  if (!pads[idx]) return;
  getCtx(); if (!masterGain) buildMasterChain();
  triggerPad(idx, pads[idx]); selectPad(idx, pads[idx]);
});

document.getElementById('keyboardToggle').addEventListener('click', () => {
  showKeyboard = !showKeyboard;
  document.getElementById('keyboardMap').classList.toggle('hidden', !showKeyboard);
});

function initKnobs() {
  document.querySelectorAll('.knob').forEach(knob => {
    let startY, startVal;
    const update = delta => {
      const val = Math.min(100, Math.max(0, startVal - delta));
      knob.dataset.value = val;
      knob.style.setProperty('--pct', `${val}%`);
      if (knob.id === 'masterVolumeKnob') { masterVolume = val/100; if (masterGain) masterGain.gain.value = masterVolume; }
      else if (knob.id === 'masterPitchKnob') { masterPitch = Math.round((val/100)*48 - 24); }
      else if (knob.id === 'bpmKnob') {
        currentBpm = Math.round(60 + val * 1.8);
        document.getElementById('bpmDisplay').textContent = currentBpm;
        if (seqPlaying) { clearInterval(seqInterval); startSequencer(); }
      }
    };
    knob.addEventListener('mousedown', e => {
      startY = e.clientY; startVal = +knob.dataset.value;
      const mm = ev => update(ev.clientY - startY);
      const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
      window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
    });
    knob.addEventListener('touchstart', e => {
      startY = e.touches[0].clientY; startVal = +knob.dataset.value;
      const tm = ev => update(ev.touches[0].clientY - startY);
      const te = () => { window.removeEventListener('touchmove', tm); window.removeEventListener('touchend', te); };
      window.addEventListener('touchmove', tm, { passive: true }); window.addEventListener('touchend', te);
    }, { passive: true });
    knob.style.setProperty('--pct', `${knob.dataset.value}%`);
  });
}

function initFxSliders() {
  [
    { id:'reverbSlider',    val:'reverbVal',    cb: v => { if(reverbWet) reverbWet.gain.value = v/100*0.8; } },
    { id:'delaySlider',     val:'delayVal',     cb: v => { if(delayWet) delayWet.gain.value = v/100*0.6; } },
    { id:'distortionSlider',val:'distortionVal',cb: v => { if(distWet){ distWet.gain.value = v/100*0.7; updateDistCurve(v/100*200); } } },
    { id:'filterSlider',    val:'filterVal',    cb: v => { if(filterNode) filterNode.frequency.value = 200 + v/100*19800; } },
  ].forEach(({ id, val, cb }) => {
    const el = document.getElementById(id);
    const upd = () => { const v = +el.value; document.getElementById(val).textContent = `${v}%`; el.style.setProperty('--pct', `${v}%`); if (masterGain) cb(v); };
    el.addEventListener('input', upd); upd();
  });
}

function initPadSettings() {
  const volEl = document.getElementById('padVolume'), pitchEl = document.getElementById('padPitch'), loopEl = document.getElementById('padLoop');
  const sync = () => {
    if (selectedPadIndex === null) return;
    padSettings[selectedPadIndex] = { volume: +volEl.value, pitch: +pitchEl.value, loop: loopEl.checked };
    document.getElementById('padVolVal').textContent   = `${volEl.value}%`;
    document.getElementById('padPitchVal').textContent = `${pitchEl.value}st`;
    volEl.style.setProperty('--pct', `${volEl.value}%`);
    pitchEl.style.setProperty('--pct', `${((+pitchEl.value+24)/48)*100}%`);
  };
  volEl.addEventListener('input', sync); pitchEl.addEventListener('input', sync); loopEl.addEventListener('change', sync);
}

document.getElementById('recordBtn').addEventListener('click', () => {
  getCtx(); if (!masterGain) buildMasterChain();
  const btn = document.getElementById('recordBtn');
  if (mediaRecorder.state === 'inactive') {
    recordedChunks = []; mediaRecorder.start();
    btn.classList.add('recording'); btn.innerHTML = '<span class="rec-dot"></span> STOP';
    recordingStartTime = Date.now(); setRecStatus('Recording...');
    recTimerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - recordingStartTime) / 1000);
      document.getElementById('recTimer').textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }, 500);
  } else {
    mediaRecorder.stop(); btn.classList.remove('recording');
    btn.innerHTML = '<span class="rec-dot"></span> REC'; clearInterval(recTimerInterval); setRecStatus('Processing...');
  }
});
document.getElementById('playbackBtn').addEventListener('click', () => { if (!recordedBlob) return; new Audio(URL.createObjectURL(recordedBlob)).play(); setRecStatus('Playing...'); });
document.getElementById('downloadBtn').addEventListener('click', () => { if (!recordedBlob) return; const a=document.createElement('a'); a.href=URL.createObjectURL(recordedBlob); a.download=`synthpad_${Date.now()}.webm`; a.click(); toast('Download started 🎵'); });
function setRecStatus(msg) { document.getElementById('recStatus').textContent = msg; }

document.getElementById('loopToggle').addEventListener('click', () => {
  loopEnabled = !loopEnabled;
  const btn = document.getElementById('loopToggle');
  btn.textContent = loopEnabled ? '🔁 Loop ON' : '🔁 Loop OFF';
  btn.classList.toggle('active', loopEnabled);
  if (!loopEnabled) { Object.values(loopSources).forEach(s => { try { s.stop(); } catch(e){} }); loopSources = {}; }
  toast(loopEnabled ? 'Loop enabled' : 'Loop disabled');
});

function buildSequencerGrid() {
  const grid = document.getElementById('sequencerGrid');
  grid.innerHTML = '';
  const pads = currentCategory === 'custom' ? customPads : PAD_DATA[currentCategory];
  pads.slice(0, 8).forEach((pad, pi) => {
    const row = document.createElement('div'); row.className = 'seq-row';
    const label = document.createElement('div'); label.className = 'seq-row-label'; label.textContent = pad.name.slice(0,5); row.appendChild(label);
    const stepsDiv = document.createElement('div'); stepsDiv.className = 'seq-steps-row'; stepsDiv.id = `seqRow${pi}`;
    for (let s = 0; s < seqNumSteps; s++) {
      const step = document.createElement('div'); step.className = 'seq-step';
      const key = `${pi}_${s}`;
      if (seqActiveSteps[key]) step.classList.add('active');
      step.addEventListener('click', () => { seqActiveSteps[key] = !seqActiveSteps[key]; step.classList.toggle('active', !!seqActiveSteps[key]); });
      stepsDiv.appendChild(step);
    }
    row.appendChild(stepsDiv); grid.appendChild(row);
  });
}

function startSequencer() {
  const ms = (60 / currentBpm / 4) * 1000;
  seqInterval = setInterval(() => {
    document.querySelectorAll('.seq-step.current').forEach(el => el.classList.remove('current'));
    const pads = currentCategory === 'custom' ? customPads : PAD_DATA[currentCategory];
    pads.slice(0, 8).forEach((pad, pi) => {
      const el = document.querySelector(`#seqRow${pi} .seq-step:nth-child(${seqStep+1})`);
      if (el) el.classList.add('current');
      if (seqActiveSteps[`${pi}_${seqStep}`]) triggerPad(pi, pad, true);
    });
    seqStep = (seqStep + 1) % seqNumSteps;
  }, ms);
}

document.getElementById('seqPlayBtn').addEventListener('click', () => {
  getCtx(); if (!masterGain) buildMasterChain(); seqPlaying = !seqPlaying;
  const btn = document.getElementById('seqPlayBtn');
  if (seqPlaying) { seqStep = 0; startSequencer(); btn.textContent = '⏹'; btn.classList.add('playing'); toast('Sequencer ▶'); }
  else { clearInterval(seqInterval); document.querySelectorAll('.seq-step.current').forEach(el => el.classList.remove('current')); btn.textContent = '▶'; btn.classList.remove('playing'); }
});
document.getElementById('seqSteps').addEventListener('change', e => { seqNumSteps = +e.target.value; seqActiveSteps = {}; if (seqPlaying) { clearInterval(seqInterval); startSequencer(); } buildSequencerGrid(); });
document.getElementById('seqClearBtn').addEventListener('click', () => { seqActiveSteps = {}; document.querySelectorAll('.seq-step').forEach(el => el.classList.remove('active')); toast('Sequencer cleared'); });

const uploadZone = document.getElementById('uploadZone'), fileInput = document.getElementById('fileInput');
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', e => handleFiles(e.target.files));

async function handleFiles(files) {
  const ctx = getCtx();
  for (const file of files) {
    if (!file.type.startsWith('audio/')) { toast(`Skipped: ${file.name}`); continue; }
    try {
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 12);
      customPads.push({ name, emoji: '🎵', buffer: decoded });
      const item = document.createElement('div'); item.className = 'upload-item';
      item.innerHTML = `<span>✅</span>${file.name.slice(0,24)}`; document.getElementById('uploadList').appendChild(item);
      toast(`Loaded: ${name}`);
    } catch(err) { toast(`Error: ${file.name}`); }
  }
  if (currentCategory === 'custom') buildPadGrid();
}

const canvas = document.getElementById('waveformCanvas'), canvasCtx = canvas.getContext('2d');
function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);
  const W = canvas.width, H = canvas.height;
  canvasCtx.clearRect(0,0,W,H); canvasCtx.fillStyle='rgba(0,0,0,0.3)'; canvasCtx.fillRect(0,0,W,H);
  if (!analyser) { canvasCtx.strokeStyle='rgba(168,85,247,0.2)'; canvasCtx.lineWidth=1.5; canvasCtx.beginPath(); canvasCtx.moveTo(0,H/2); canvasCtx.lineTo(W,H/2); canvasCtx.stroke(); return; }
  const data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteTimeDomainData(data);
  const grad = canvasCtx.createLinearGradient(0,0,W,0); grad.addColorStop(0,'#a855f7'); grad.addColorStop(.5,'#06b6d4'); grad.addColorStop(1,'#a855f7');
  canvasCtx.beginPath(); canvasCtx.strokeStyle=grad; canvasCtx.lineWidth=2; canvasCtx.shadowColor='#a855f7'; canvasCtx.shadowBlur=10;
  const sw = W/data.length; let x=0;
  data.forEach((v,i) => { const y=(v/128)*(H/2); i===0?canvasCtx.moveTo(x,y):canvasCtx.lineTo(x,y); x+=sw; });
  canvasCtx.lineTo(W,H/2); canvasCtx.stroke();
}

let toastTimer;
function toast(msg) { const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2200); }

function initParticles() {
  const c = document.getElementById('bgParticles');
  for (let i=0;i<20;i++) {
    const p=document.createElement('div'), sz=Math.random()*3+1, dur=8+Math.random()*12, tx=Math.round(Math.random()*60-30), ty=Math.round(Math.random()*60-30);
    const st=document.createElement('style'); st.textContent=`@keyframes fp${i}{0%{transform:translate(0,0)}100%{transform:translate(${tx}px,${ty}px)}}`; document.head.appendChild(st);
    p.style.cssText=`position:absolute;width:${sz}px;height:${sz}px;border-radius:50%;background:rgba(168,85,247,${(Math.random()*0.2+0.05).toFixed(2)});left:${(Math.random()*100).toFixed(1)}%;top:${(Math.random()*100).toFixed(1)}%;animation:fp${i} ${dur}s ease-in-out infinite alternate;animation-delay:${(Math.random()*-8).toFixed(1)}s;`;
    c.appendChild(p);
  }
}

function init() {
  initParticles(); buildPadGrid(); initKnobs(); initFxSliders(); initPadSettings(); drawVisualizer();
  document.getElementById('bpmDisplay').textContent = currentBpm;
  document.getElementById('themeToggle').addEventListener('click', () => toast('Studio dark theme 🎛️'));
}
document.addEventListener('DOMContentLoaded', init);

// Landing page login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('emailInput');
  const btn = document.querySelector('.landing-btn');
  const email = input.value;
  if (!email) return;

  btn.textContent = 'Loading...';
  btn.disabled = true;

  try {
    // Send email notification to smanoj11@gmail.com via Web3Forms
    await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        access_key: '37e98b07-01b8-43bd-b283-1911b591832d',
        subject: 'New SynthPad User! 🎹',
        from_name: 'SynthPad App',
        email: 'smanoj11@gmail.com',
        message: `A new user has started using SynthPad!\n\nUser Email: ${email}`
      })
    });
  } catch (err) {
    console.error('Notification failed', err);
  }
  
  // Hide landing page
  document.getElementById('landingPage').classList.add('hidden');
  
  // Initialize audio / unlock Web Audio API on first user gesture
  getCtx(); 
  toast(`Welcome! Logged in as ${email}`);
});
