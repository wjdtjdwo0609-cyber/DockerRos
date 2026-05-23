// Socket Picking Bridge — Intel5 본 프로젝트의 라인 이벤트를 시뮬에 표시.
//
// 멀티 채널 지원:
//   /socket_picking/r1/...  → r1 색상으로 표시
//   /socket_picking/r2/...  → r2 색상으로 표시
//   /socket_picking/r3/...  → 로드셀 + 분류 이벤트
//
// app.js와 별개로 동작 — 자체 ROS 연결, 기존 코드 영향 없음.

import ROSLIB from 'roslib';

const ROSBRIDGE_URL = 'ws://localhost:9090';
const NS = '/socket_picking';
const KNOWN_CHANNELS = ['r1', 'r2', 'r3'];   // 자동 구독할 채널들
const MAX_EVENTS = 80;

// 채널별 색상 (시뮬에서도 일관성)
const CHANNEL_COLOR = {
  r1: '#10b981',  // green   (Vision1 → Robot1)
  r2: '#3b82f6',  // blue    (Vision2 → Robot2)
  r3: '#f59e0b',  // amber   (LoadCell → Robot3)
  default: '#94a3b8',
};

function chColor(cid) {
  return CHANNEL_COLOR[cid] || CHANNEL_COLOR.default;
}

// ── 패널 UI ──
function buildPanel() {
  const panel = document.createElement('div');
  panel.id = 'sock-pick-panel';
  panel.innerHTML = `
    <header>
      <strong>📦 Line · Socket Picking</strong>
      <span id="sock-pick-status" class="dim">연결 중…</span>
      <button id="sock-pick-clear" title="지우기">✕</button>
    </header>
    <div id="sock-pick-summary"></div>
    <div id="sock-pick-list"></div>
  `;
  document.body.appendChild(panel);

  const css = document.createElement('style');
  css.textContent = `
    #sock-pick-panel {
      position: fixed; right: 16px; bottom: 16px;
      width: 360px; max-height: 60vh;
      background: rgba(15, 23, 42, 0.96);
      color: #e2e8f0;
      border: 1px solid #334155; border-radius: 8px;
      padding: 0; font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace;
      box-shadow: 0 6px 20px rgba(0,0,0,0.5);
      z-index: 9999;
      display: flex; flex-direction: column;
    }
    #sock-pick-panel header {
      padding: 8px 12px; border-bottom: 1px solid #334155;
      display: flex; align-items: center; gap: 8px;
    }
    #sock-pick-panel header strong { flex: 1; }
    #sock-pick-panel .dim { color: #94a3b8; font-size: 10px; font-weight: 400; }
    #sock-pick-panel button {
      background: transparent; border: 0; color: #94a3b8; cursor: pointer;
      font-size: 14px; padding: 0 4px;
    }
    #sock-pick-panel button:hover { color: #e2e8f0; }
    #sock-pick-summary {
      padding: 6px 12px; border-bottom: 1px solid rgba(148,163,184,0.2);
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
      font-size: 11px;
    }
    .ch-summary {
      padding: 4px 6px; border-radius: 4px;
      background: rgba(255,255,255,0.04); border-left: 3px solid var(--ch-color);
    }
    .ch-summary .ch-name { font-weight: 600; }
    .ch-summary .ch-stats { color: #94a3b8; font-size: 10px; }
    #sock-pick-list {
      overflow-y: auto; padding: 6px 12px 8px;
      flex: 1;
    }
    .sock-row { padding: 3px 0; border-bottom: 1px dashed rgba(148,163,184,0.15); }
    .sock-row:last-child { border-bottom: none; }
    .sock-time { color: #64748b; font-size: 10px; margin-right: 6px; }
    .sock-channel-tag {
      display: inline-block; min-width: 24px; padding: 1px 6px;
      border-radius: 3px; font-size: 10px; font-weight: 600;
      color: #0f172a; margin-right: 6px;
    }
    .sock-tag-8pin   { color: #fbbf24; }
    .sock-tag-12pin  { color: #60a5fa; }
    .sock-event-pick_start    { color: #94a3b8; }
    .sock-event-attempt_start { color: #c084fc; }
    .sock-event-attempt_end   { color: #94a3b8; }
    .sock-event-pick_success  { color: #10b981; font-weight: 600; }
    .sock-event-pick_fail     { color: #ef4444; font-weight: 600; }
    .sock-event-no_target     { color: #f59e0b; }
    .sock-event-measure_start  { color: #c084fc; }
    .sock-event-classified     { color: #10b981; font-weight: 600; }
    .sock-event-classify_fail  { color: #ef4444; }
    .sock-event-pickup_fail    { color: #ef4444; }
    .sock-event-placed         { color: #10b981; }
    .sock-loadcell             { color: #fbbf24; }
  `;
  document.head.appendChild(css);

  document.getElementById('sock-pick-clear').addEventListener('click', () => {
    document.getElementById('sock-pick-list').innerHTML = '';
    Object.keys(channelStats).forEach(k => delete channelStats[k]);
    updateSummary();
  });
}

function setStatus(text, ok = false) {
  const el = document.getElementById('sock-pick-status');
  if (el) {
    el.textContent = text;
    el.style.color = ok ? '#10b981' : '#94a3b8';
  }
}

// 채널별 카운터 (요약 패널)
const channelStats = {};
function updateSummary() {
  const sum = document.getElementById('sock-pick-summary');
  if (!sum) return;
  sum.innerHTML = '';
  KNOWN_CHANNELS.forEach((cid) => {
    const s = channelStats[cid] || {detected: 0, success: 0, fail: 0, weight: null};
    const div = document.createElement('div');
    div.className = 'ch-summary';
    div.style.setProperty('--ch-color', chColor(cid));
    let extra = '';
    if (cid === 'r3' && s.weight !== null && s.weight !== undefined) {
      extra = ` · ${s.weight.toFixed(1)}g`;
    }
    div.innerHTML = `
      <div class="ch-name" style="color:${chColor(cid)}">${cid}</div>
      <div class="ch-stats">
        ${cid === 'r3' ? `분류 ${s.success}/${s.detected}` : `${s.success}/${s.detected} ✓ · ${s.fail} ✗`}${extra}
      </div>
    `;
    sum.appendChild(div);
  });
}

function bumpStats(cid, key, val = 1) {
  if (!channelStats[cid]) channelStats[cid] = {detected: 0, success: 0, fail: 0, weight: null};
  if (typeof key === 'string' && val !== undefined) {
    if (key === 'weight') channelStats[cid].weight = val;
    else channelStats[cid][key] = (channelStats[cid][key] || 0) + val;
  }
  updateSummary();
}

function pushRow(cid, html) {
  const list = document.getElementById('sock-pick-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'sock-row';
  row.innerHTML = `<span class="sock-channel-tag" style="background:${chColor(cid)}">${cid}</span>${html}`;
  list.insertBefore(row, list.firstChild);
  while (list.children.length > MAX_EVENTS) list.removeChild(list.lastChild);
}

function nowStr() {
  return new Date().toLocaleTimeString('ko-KR', { hour12: false });
}

// ── Digital-twin trigger ────────────────────────────────────────────────
// When the REAL line classifies one part, run the sim's predetermined
// scenario for that class exactly once. Dedup by run_id (events repeat);
// per-channel cooldown when run_id is absent. app.js exposes the hook;
// if it's not ready we skip (bridge stays independent — no hard coupling).
const _twinSeen = new Set();
const _twinCooldown = {};
function _classFromBin(bin) {
  const b = String(bin || '').toLowerCase();
  if (b.includes('12')) return '12pin';
  if (b.includes('8')) return '8pin';
  return null;
}
function maybeTwinDispatch(cid, d) {
  if (typeof window.__twinDispatch !== 'function') return;
  const cls = _classFromBin(d.bin)
    || (d.weight_g !== undefined
        ? (Number(d.weight_g) >= 65 ? '12pin' : '8pin')
        : null);
  if (!cls) return;
  const rid = d.run_id;
  if (rid !== undefined && rid !== null && rid !== '') {
    const key = `${cid}:${rid}`;
    if (_twinSeen.has(key)) return;          // already fired for this part
    _twinSeen.add(key);
    if (_twinSeen.size > 500) _twinSeen.clear();  // bound memory
  } else {
    const now = Date.now();
    if (now - (_twinCooldown[cid] || 0) < 3000) return;
    _twinCooldown[cid] = now;
  }
  window.__twinDispatch(cls);
}

// ── 메시지 포매터 ──
function fmtDetection(d) {
  const cls = d.cls === 0 ? '8pin' : (d.cls === 1 ? '12pin' : `cls${d.cls}`);
  const tagCls = d.cls === 0 ? 'sock-tag-8pin' : 'sock-tag-12pin';
  const xyz = (d.pick_xyz_mm || []).map(v => Number(v).toFixed(0)).join(',');
  const yaw = d.pick_yaw_deg !== undefined ? Number(d.pick_yaw_deg).toFixed(0) : '?';
  const conf = d.confidence !== undefined ? `${(d.confidence * 100).toFixed(0)}%` : '';
  return `<span class="sock-time">${nowStr()}</span>
          🎯 <span class="${tagCls}">${cls}</span> ${conf}
          <span class="dim">(${xyz}) yaw=${yaw}°</span>`;
}

function fmtPickEvent(e) {
  const cls = `sock-event-${e.event}`;
  const meta = [
    e.run_id && `run=${e.run_id}`,
    e.attempt !== undefined && `try=${e.attempt}`,
    e.attempts && `(${e.attempts})`,
    e.elapsed_s && `${Number(e.elapsed_s).toFixed(1)}s`,
  ].filter(Boolean).join(' ');
  return `<span class="sock-time">${nowStr()}</span>
          <span class="${cls}">${e.event}</span> <span class="dim">${meta}</span>`;
}

function fmtLoadCell(d) {
  return `<span class="sock-time">${nowStr()}</span>
          ⚖ <span class="sock-loadcell">${Number(d.weight_g).toFixed(2)} g</span>
          <span class="dim">${d.run_id ? `run=${d.run_id}` : ''}</span>`;
}

function fmtClassifyEvent(e) {
  const cls = `sock-event-${e.event}`;
  const bin = e.bin ? `→ ${e.bin}` : '';
  const w = e.weight_g !== undefined ? `${Number(e.weight_g).toFixed(1)}g` : '';
  return `<span class="sock-time">${nowStr()}</span>
          <span class="${cls}">${e.event}</span> <span class="dim">${w} ${bin}</span>`;
}

// ── 메인 ──
function init() {
  buildPanel();
  setStatus('연결 중…');
  KNOWN_CHANNELS.forEach((cid) => {
    channelStats[cid] = {detected: 0, success: 0, fail: 0, weight: null};
  });
  updateSummary();

  const ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });

  ros.on('connection', () => {
    setStatus(`✓ ${ROSBRIDGE_URL}`, true);
    console.log('[socket-picking-bridge] rosbridge connected');

    // 채널별 토픽 구독 (각 3종)
    KNOWN_CHANNELS.forEach((cid) => {
      // 1) detection (r1, r2 — 픽킹 채널)
      new ROSLIB.Topic({
        ros, name: `${NS}/${cid}/detection`, messageType: 'std_msgs/String'
      }).subscribe((msg) => {
        try {
          const d = JSON.parse(msg.data);
          pushRow(cid, fmtDetection(d));
          bumpStats(cid, 'detected');
        } catch (e) { console.warn('detection parse', e); }
      });

      // 2) pick_event (r1, r2)
      new ROSLIB.Topic({
        ros, name: `${NS}/${cid}/pick_event`, messageType: 'std_msgs/String'
      }).subscribe((msg) => {
        try {
          const d = JSON.parse(msg.data);
          pushRow(cid, fmtPickEvent(d));
          if (d.event === 'pick_success') bumpStats(cid, 'success');
          else if (d.event === 'pick_fail') bumpStats(cid, 'fail');
        } catch (e) { console.warn('pick_event parse', e); }
      });

      // 3) loadcell (r3)
      new ROSLIB.Topic({
        ros, name: `${NS}/${cid}/loadcell`, messageType: 'std_msgs/String'
      }).subscribe((msg) => {
        try {
          const d = JSON.parse(msg.data);
          pushRow(cid, fmtLoadCell(d));
          bumpStats(cid, 'weight', d.weight_g);
          bumpStats(cid, 'detected');
        } catch (e) { console.warn('loadcell parse', e); }
      });

      // 4) event (r3 분류 이벤트)
      new ROSLIB.Topic({
        ros, name: `${NS}/${cid}/event`, messageType: 'std_msgs/String'
      }).subscribe((msg) => {
        try {
          const d = JSON.parse(msg.data);
          pushRow(cid, fmtClassifyEvent(d));
          if (d.event === 'classified' || d.event === 'placed') {
            // 'classified' = 부품 클래스 확정 시점 → sim 시나리오 1회 재생
            if (d.event === 'classified') maybeTwinDispatch(cid, d);
            // 'placed'에서 한 사이클 끝
            if (d.event === 'placed') bumpStats(cid, 'success');
          } else if (d.event === 'classify_fail' || d.event === 'pickup_fail'
                     || d.event === 'measure_unstable') {
            bumpStats(cid, 'fail');
          }
        } catch (e) { console.warn('event parse', e); }
      });
    });
  });

  ros.on('error', (e) => {
    setStatus('연결 오류');
    console.warn('[socket-picking-bridge]', e);
  });

  ros.on('close', () => setStatus('연결 종료'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
