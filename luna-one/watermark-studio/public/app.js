const $ = (selector) => document.querySelector(selector);
const file = $('#file'), dropZone = $('#dropZone'), editor = $('#editor'), stage = $('#stage');
const image = $('#image'), video = $('#video'), selection = $('#selection'), sourceSelection = $('#sourceSelection');
const selectGuide = $('#selectGuide'), fileName = $('#fileName'), pickSource = $('#pickSource');
const add = $('#add'), remove = $('#remove'), status = $('#status'), result = $('#result'), range = $('#range'), jobsBox = $('#jobs');
let chosen = null, start = null, box = null, sourceBox = null, sourceMode = false, objectUrl = null, jobs = [];

file.onchange = () => loadFile(file.files[0]);
function isImageFile() { return chosen?.type.startsWith('image/'); }
function loadFile(nextFile) {
  if (!nextFile) return;
  const isImage = nextFile.type.startsWith('image/'), isVideo = nextFile.type.startsWith('video/');
  if (!isImage && !isVideo) { status.textContent = '⚠️ 이미지 또는 영상 파일만 넣어주세요.'; return; }
  chosen = nextFile;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(chosen);
  fileName.textContent = chosen.name; fileName.title = chosen.name;
  image.classList.toggle('hidden', !isImage); video.classList.toggle('hidden', isImage);
  range.classList.toggle('hidden', isImage); pickSource.classList.toggle('hidden', !isImage);
  (isImage ? image : video).src = objectUrl;
  editor.classList.remove('hidden'); result.classList.add('hidden');
  jobs = []; renderJobs(); clearBox(); status.textContent = '';
  if (!isImage) video.onloadedmetadata = () => { $('#endTime').value = video.duration.toFixed(1); };
}

$('#clearUpload').onclick = () => {
  video.pause(); image.removeAttribute('src'); video.removeAttribute('src'); video.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null; chosen = null; file.value = ''; fileName.textContent = ''; jobs = [];
  renderJobs(); clearBox(); editor.classList.add('hidden'); result.classList.add('hidden'); result.innerHTML = '';
  status.textContent = '업로드 파일을 작업 화면에서 삭제했어요.';
};

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); dragDepth++; dropZone.classList.add('dragging'); });
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropZone.classList.remove('dragging'); });
window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; dropZone.classList.remove('dragging'); loadFile([...(e.dataTransfer?.files || [])][0]); });

function point(e) {
  const r = stage.getBoundingClientRect();
  return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)), rw: r.width, rh: r.height };
}
function drawRect(element, rect) {
  Object.assign(element.style, { display: 'block', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
}
stage.ondragstart = (e) => e.preventDefault();
stage.onpointerdown = (e) => {
  if (e.target === video && e.offsetY > video.clientHeight - 48) return;
  e.preventDefault();
  const p = point(e);
  if (sourceMode && box) {
    const w = box.w * p.rw, h = box.h * p.rh;
    const x = Math.max(0, Math.min(p.rw - w, p.x - w / 2));
    const y = Math.max(0, Math.min(p.rh - h, p.y - h / 2));
    const candidate = { x: x / p.rw, y: y / p.rh };
    const overlapsTarget = candidate.x < box.x + box.w && candidate.x + box.w > box.x && candidate.y < box.y + box.h && candidate.y + box.h > box.y;
    if (overlapsTarget) {
      status.textContent = '⚠️ 지울 영역과 겹쳤어요. 흰 무늬에서 떨어진 깨끗한 모래 부분을 클릭해주세요.';
      selectGuide.textContent = '② 보라색 영역에서 떨어진 깨끗한 배경을 클릭하세요';
      sourceSelection.style.display = 'none';
      return;
    }
    sourceBox = candidate;
    drawRect(sourceSelection, { x, y, w, h });
    sourceMode = false; pickSource.classList.remove('active');
    status.textContent = '';
    add.disabled = false; add.textContent = '✓ 자동으로 작업 등록 중';
    selectGuide.textContent = '✓ 깨끗한 배경을 선택했어요. 제거 작업을 자동 등록합니다'; selectGuide.classList.add('done');
    setTimeout(() => add.click(), 450);
    return;
  }
  start = p; stage.setPointerCapture(e.pointerId); selection.style.display = 'block';
};
stage.onpointermove = (e) => {
  if (!start || sourceMode) return;
  const p = point(e), x = Math.min(start.x, p.x), y = Math.min(start.y, p.y), w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
  drawRect(selection, { x, y, w, h });
  box = { x: x / p.rw, y: y / p.rh, w: w / p.rw, h: h / p.rh };
  sourceBox = null; sourceSelection.style.display = 'none';
  const valid = w >= 4 && h >= 4;
  if (isImageFile()) {
    pickSource.disabled = !valid; add.disabled = true;
    add.textContent = valid ? '깨끗한 배경도 선택해주세요' : '먼저 지울 영역을 드래그하세요';
    selectGuide.textContent = valid ? '② 아래 버튼을 누르고 사진에서 깨끗한 배경을 클릭하세요' : '① 지울 부분을 마우스로 꾹 누른 채 네모로 드래그하세요';
  } else {
    add.disabled = !valid; add.textContent = valid ? '＋ 제거 작업 등록' : '먼저 지울 영역을 드래그하세요';
  }
  selectGuide.classList.toggle('done', valid && !isImageFile());
};
stage.onpointerup = () => { start = null; };

pickSource.onclick = () => { if (!box) return; sourceMode = true; pickSource.classList.add('active'); selectGuide.textContent = '② 사진에서 가져올 깨끗한 배경의 가운데를 한 번 클릭하세요'; };
$('#reset').onclick = () => {
  clearBox();
  status.textContent = '사진 위에서 지울 부분을 다시 네모로 드래그하면 다음 버튼이 활성화돼요.';
};
function clearBox() {
  box = null; sourceBox = null; sourceMode = false; start = null;
  selection.style.display = 'none'; sourceSelection.style.display = 'none'; pickSource.disabled = true; pickSource.classList.remove('active');
  add.disabled = true; add.textContent = '먼저 지울 영역을 드래그하세요';
  selectGuide.textContent = '① 지울 부분을 마우스로 꾹 누른 채 네모로 드래그하세요'; selectGuide.classList.remove('done');
}

$('#setStart').onclick = () => $('#startTime').value = video.currentTime.toFixed(1);
$('#setEnd').onclick = () => $('#endTime').value = video.currentTime.toFixed(1);
add.onclick = () => {
  if (!box || (isImageFile() && !sourceBox)) return;
  const isVideo = !isImageFile(), from = isVideo ? Number($('#startTime').value) : 0, to = isVideo ? Number($('#endTime').value) : 0;
  if (isVideo && (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)) { status.textContent = '⚠️ 종료 시간을 시작 시간보다 뒤로 지정해주세요.'; return; }
  jobs.push({ ...box, sourceX: sourceBox?.x, sourceY: sourceBox?.y, start: from, end: to });
  status.textContent = '';
  if (isVideo) {
    clearBox();
  } else {
    add.disabled = true; add.textContent = '✓ 제거 작업 등록됨'; pickSource.disabled = true;
    selectGuide.textContent = '✓ 보라색 영역을 초록색 배경으로 교체할 준비가 됐어요'; selectGuide.classList.add('done');
  }
  renderJobs();
};
function fmt(t) { const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, '0'); return `${m}:${s}`; }
function renderJobs() {
  jobsBox.classList.toggle('hidden', !jobs.length);
  jobsBox.innerHTML = jobs.map((j, i) => `<div class="job"><strong>제거 작업 ${i + 1}</strong><span>${isImageFile() ? '배경 복제·혼합' : `${fmt(j.start)} ~ ${fmt(j.end)}`}</span><span>영역 ${Math.round(j.w * 100)}% × ${Math.round(j.h * 100)}%</span><button data-delete="${i}">삭제</button></div>`).join('');
  jobsBox.querySelectorAll('[data-delete]').forEach((button) => button.onclick = () => { jobs.splice(Number(button.dataset.delete), 1); renderJobs(); });
  remove.disabled = !jobs.length;
}
remove.onclick = async () => {
  if (!chosen || !jobs.length) return;
  remove.disabled = true; status.textContent = `${jobs.length}개 작업을 자연스럽게 복원하는 중…`;
  const fd = new FormData(); fd.append('media', chosen); fd.append('regions', JSON.stringify(jobs));
  try {
    const response = await fetch('/api/remove', { method: 'POST', body: fd }); const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || '처리하지 못했어요.');
    result.innerHTML = `<h2>완성됐어요</h2>${data.type === 'image' ? `<img class="result-media" src="${data.url}">` : `<video class="result-media" src="${data.url}" controls></video>`}<div class="result-actions"><a class="download" href="${data.url}" download>다운로드</a><button class="ghost" id="deleteResult">결과 삭제</button></div>`;
    result.classList.remove('hidden'); $('#deleteResult').onclick = async () => { await fetch('/api/result/' + data.url.split('/').pop(), { method: 'DELETE' }); result.classList.add('hidden'); };
    status.textContent = '';
  } catch (error) { status.textContent = '⚠️ ' + error.message; remove.disabled = false; }
};
