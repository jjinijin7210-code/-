// AnyOne 직원 현황판 — 활동 로그 + 실시간 피드
//
// 이 파일이 노출하는 window.AnyOneActivityLog.startActivity / completeActivity 는
// 2단계(자동화 백엔드)에서 실제 액션(초안 시작/완료, 검수 시작/완료, 루나 요청 발송 등)이
// 발생할 때 그대로 호출해 로그를 남기도록 만든 훅입니다.
// 지금 단계(1단계 대시보드)에서는 카드의 "시작/완료" 버튼이 같은 훅을 호출해 동작을 시뮬레이션합니다.

const STORAGE_KEY = 'anyone_dashboard_state_v1';
const REFRESH_INTERVAL_MS = 5000;
const FEED_LIMIT = 30;

/** @type {{ id:string, employeeId:string, taskLabel:string, startedAt:number, completedAt:number|null, status:'in_progress'|'completed' }[]} */
let activityLog = [];
/** @type {Record<string, {key:string, emoji:string, label:string}>} */
let manualStatus = {};

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      activityLog = parsed.activityLog || [];
      manualStatus = parsed.manualStatus || {};
      return;
    } catch (e) {
      // 손상된 저장값은 무시하고 시드 데이터로 재생성
    }
  }
  seedState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ activityLog, manualStatus }));
}

function seedState() {
  const now = Date.now();
  activityLog = [
    { id: genId(), employeeId: 'researcher', taskLabel: '인기 키워드·게시물 벤치마킹 중', startedAt: now - 18 * 60 * 1000, completedAt: now - 4 * 60 * 1000, status: 'completed' },
    { id: genId(), employeeId: 'writerA', taskLabel: '겨울 이불빨래 꿀팁 초안 작성 중', startedAt: now - 2 * 60 * 1000, completedAt: null, status: 'in_progress' },
    { id: genId(), employeeId: 'reviewer', taskLabel: '사실관계·출처 검증 중', startedAt: now - 45 * 1000, completedAt: null, status: 'in_progress' },
    { id: genId(), employeeId: 'lunaImage', taskLabel: '루나에게 이미지 요청 발송 중', startedAt: now - 5 * 60 * 1000, completedAt: now - 60 * 1000, status: 'completed' },
  ];
  manualStatus = { videoTeam: MANUAL_STATUS_CYCLE[0] };
  saveState();
}

// ---- 활동 로그 API (2단계 자동화에서 그대로 호출할 훅) ----

function startActivity(employeeId, taskLabel) {
  const now = Date.now();
  // 같은 직원의 미완료 활동이 있으면 새 작업 시작 시점에 완료 처리
  activityLog.forEach((entry) => {
    if (entry.employeeId === employeeId && entry.status === 'in_progress') {
      entry.status = 'completed';
      entry.completedAt = now;
    }
  });
  activityLog.push({
    id: genId(),
    employeeId,
    taskLabel,
    startedAt: now,
    completedAt: null,
    status: 'in_progress',
  });
  saveState();
  render();
}

function completeActivity(employeeId) {
  const now = Date.now();
  const open = [...activityLog]
    .reverse()
    .find((entry) => entry.employeeId === employeeId && entry.status === 'in_progress');
  if (!open) return;
  open.status = 'completed';
  open.completedAt = now;
  saveState();
  render();
}

function cycleManualStatus(employeeId) {
  const current = manualStatus[employeeId] || MANUAL_STATUS_CYCLE[0];
  const idx = MANUAL_STATUS_CYCLE.findIndex((s) => s.key === current.key);
  manualStatus[employeeId] = MANUAL_STATUS_CYCLE[(idx + 1) % MANUAL_STATUS_CYCLE.length];
  saveState();
  render();
}

function getOpenActivity(employeeId) {
  return [...activityLog]
    .reverse()
    .find((entry) => entry.employeeId === employeeId && entry.status === 'in_progress');
}

// ---- 시간 포맷 ----

function relativeTime(ts) {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}초 전`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${Math.floor(diffHour / 24)}일 전`;
}

function clockTime(ts) {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---- 렌더링 ----

function render() {
  renderEmployeeCards();
  renderActivityFeed();
}

function renderEmployeeCards() {
  const grid = document.getElementById('employee-grid');
  grid.innerHTML = '';

  EMPLOYEES.forEach((employee) => {
    const card = document.createElement('div');
    card.className = 'employee-card';

    const header = document.createElement('div');
    header.className = 'employee-header';
    header.innerHTML = `<span class="employee-emoji">${employee.emoji}</span>
      <div>
        <div class="employee-name">${employee.name}</div>
        <div class="employee-dept">${employee.dept}</div>
      </div>`;
    card.appendChild(header);

    const statusLine = document.createElement('div');
    statusLine.className = 'status-line';

    if (employee.automated) {
      const open = getOpenActivity(employee.id);
      if (open) {
        statusLine.classList.add('status-working');
        statusLine.innerHTML = `🟢 작업중 — ${open.taskLabel} <span class="status-time">(${relativeTime(open.startedAt)} 시작)</span>`;
      } else {
        statusLine.classList.add('status-idle');
        statusLine.textContent = '⚪ 대기 중';
      }
      card.appendChild(statusLine);

      const controls = document.createElement('div');
      controls.className = 'card-controls';

      const select = document.createElement('select');
      employee.taskPresets.forEach((preset) => {
        const opt = document.createElement('option');
        opt.value = preset;
        opt.textContent = preset;
        select.appendChild(opt);
      });

      const startBtn = document.createElement('button');
      startBtn.textContent = '시작';
      startBtn.className = 'btn btn-start';
      startBtn.addEventListener('click', () => startActivity(employee.id, select.value));

      const completeBtn = document.createElement('button');
      completeBtn.textContent = '완료';
      completeBtn.className = 'btn btn-complete';
      completeBtn.disabled = !open;
      completeBtn.addEventListener('click', () => completeActivity(employee.id));

      controls.appendChild(select);
      controls.appendChild(startBtn);
      controls.appendChild(completeBtn);
      card.appendChild(controls);
    } else {
      const status = manualStatus[employee.id] || MANUAL_STATUS_CYCLE[0];
      statusLine.classList.add('status-manual');
      statusLine.textContent = `${status.emoji} ${status.label} (수동)`;
      card.appendChild(statusLine);

      const manualBtn = document.createElement('button');
      manualBtn.className = 'btn btn-manual';
      manualBtn.textContent = '상태 변경 (대기 → 검토중 → 통과)';
      manualBtn.addEventListener('click', () => cycleManualStatus(employee.id));
      card.appendChild(manualBtn);
    }

    grid.appendChild(card);
  });
}

function renderActivityFeed() {
  const feedEl = document.getElementById('activity-feed');
  feedEl.innerHTML = '';

  const rows = [];
  activityLog.forEach((entry) => {
    const employee = EMPLOYEES.find((e) => e.id === entry.employeeId);
    const name = employee ? `${employee.emoji} ${employee.name}` : entry.employeeId;
    rows.push({ ts: entry.startedAt, html: `<strong>${name}</strong>님이 <em>${entry.taskLabel}</em> 시작` , type: 'start'});
    if (entry.status === 'completed' && entry.completedAt) {
      rows.push({ ts: entry.completedAt, html: `<strong>${name}</strong>님이 <em>${entry.taskLabel}</em> 완료`, type: 'complete' });
    }
  });

  rows.sort((a, b) => b.ts - a.ts);

  if (rows.length === 0) {
    feedEl.innerHTML = '<li class="feed-empty">아직 활동 로그가 없습니다.</li>';
    return;
  }

  rows.slice(0, FEED_LIMIT).forEach((row) => {
    const li = document.createElement('li');
    li.className = `feed-item feed-${row.type}`;
    li.innerHTML = `<span class="feed-icon">${row.type === 'complete' ? '🔵' : '🟢'}</span>
      <span class="feed-text">${row.html}</span>
      <span class="feed-time" title="${clockTime(row.ts)}">${relativeTime(row.ts)}</span>`;
    feedEl.appendChild(li);
  });
}

// ---- 초기화 ----

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  render();
  setInterval(render, REFRESH_INTERVAL_MS);
});

// 2단계 자동화 파이프라인에서 사용할 공개 훅
window.AnyOneActivityLog = { startActivity, completeActivity, EMPLOYEES };
