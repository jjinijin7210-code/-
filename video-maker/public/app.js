const scenesEl = document.getElementById('scenes');
const scenes = []; // { imageFile, voiceFile, duration, motion, text, voiceVolume, el }

// 무료 호스팅(512MB) 메모리 한도에 안전하게 맞춘 프리셋 해상도
const ASPECT_PRESETS = {
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '1:1': { width: 720, height: 720 },
  '4:5': { width: 720, height: 900 },
};

const aspectSelect = document.getElementById('aspect-preset');
const customSizeEl = document.getElementById('custom-size');
aspectSelect.addEventListener('change', () => {
  customSizeEl.classList.toggle('hidden', aspectSelect.value !== 'custom');
});

function getSelectedSize() {
  const preset = ASPECT_PRESETS[aspectSelect.value];
  if (preset) return preset;
  return {
    width: document.getElementById('width').value,
    height: document.getElementById('height').value,
  };
}

(async function initUserBar() {
  try {
    const res = await fetch('/api/me');
    const { user } = await res.json();
    if (!user) return;
    const bar = document.getElementById('user-bar');
    document.getElementById('user-avatar').src = user.picture || '';
    document.getElementById('user-email').textContent = user.email || '';
    bar.classList.remove('hidden');
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });
  } catch (err) {
    // 로그인 기능이 꺼져 있으면(구글 클라이언트ID 미설정) /api/me가 user:null을 주므로 무시
  }
})();

function addScene() {
  const index = scenes.length;
  const card = document.createElement('div');
  card.className = 'scene-card';
  card.innerHTML = `
    <div class="scene-title">
      <span>씬 ${index + 1}</span>
      <button type="button" class="btn btn-remove">삭제</button>
    </div>
    <label class="full-width">이미지 <input type="file" accept="image/*" class="f-image" required /></label>
    <label>길이(초) <input type="number" class="f-duration" value="4" min="1" step="0.5" /></label>
    <label>효과
      <select class="f-motion">
        <option value="zoom-in">줌인</option>
        <option value="zoom-out">줌아웃</option>
        <option value="pan-left">팬(좌)</option>
        <option value="pan-right">팬(우)</option>
        <option value="none">없음</option>
      </select>
    </label>
    <label class="full-width">자막/가사 (선택) <input type="text" class="f-text" placeholder="이 씬에 표시할 텍스트" /></label>
    <label>보이스/내레이션 (선택) <input type="file" accept="audio/*" class="f-voice" /></label>
    <label>보이스 음량 <input type="number" class="f-voice-volume" value="1" step="0.1" min="0" max="2" /></label>
  `;
  scenesEl.appendChild(card);

  const entry = { el: card };
  scenes.push(entry);

  card.querySelector('.btn-remove').addEventListener('click', () => {
    scenesEl.removeChild(card);
    const idx = scenes.indexOf(entry);
    if (idx !== -1) scenes.splice(idx, 1);
    renumberScenes();
  });
}

function renumberScenes() {
  scenes.forEach((s, i) => {
    s.el.querySelector('.scene-title span').textContent = `씬 ${i + 1}`;
  });
}

document.getElementById('add-scene').addEventListener('click', addScene);

// 시작할 때 씬 3개로 시작
addScene();
addScene();
addScene();

document.getElementById('render-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  const resultEl = document.getElementById('result');
  const renderBtn = document.getElementById('render-btn');

  if (scenes.length === 0) {
    statusEl.textContent = '씬을 하나 이상 추가해주세요.';
    return;
  }

  const size = getSelectedSize();
  const formData = new FormData();
  formData.append('width', size.width);
  formData.append('height', size.height);
  formData.append('fps', document.getElementById('fps').value);
  formData.append('transitionDuration', document.getElementById('transitionDuration').value);
  formData.append('audioVolume', document.getElementById('audioVolume').value);

  const audioInput = document.getElementById('audio');
  if (audioInput.files[0]) formData.append('audio', audioInput.files[0]);

  const scenesMeta = [];
  for (let i = 0; i < scenes.length; i++) {
    const el = scenes[i].el;
    const imageFile = el.querySelector('.f-image').files[0];
    if (!imageFile) {
      statusEl.textContent = `씬 ${i + 1}에 이미지를 선택해주세요.`;
      return;
    }
    formData.append(`scene_image_${i}`, imageFile);

    const voiceFile = el.querySelector('.f-voice').files[0];
    if (voiceFile) formData.append(`scene_voice_${i}`, voiceFile);

    scenesMeta.push({
      duration: el.querySelector('.f-duration').value,
      motion: el.querySelector('.f-motion').value,
      text: el.querySelector('.f-text').value,
      voiceVolume: el.querySelector('.f-voice-volume').value,
    });
  }
  formData.append('scenesMeta', JSON.stringify(scenesMeta));

  renderBtn.disabled = true;
  statusEl.textContent = '렌더링 중입니다... (씬 수·길이에 따라 수십 초~수 분 소요)';
  resultEl.classList.add('hidden');

  try {
    const res = await fetch('/api/render', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || '렌더링 실패');

    statusEl.textContent = '완료!';
    const video = document.getElementById('result-video');
    video.src = data.videoUrl;
    document.getElementById('download-link').href = data.videoUrl;
    resultEl.classList.remove('hidden');
  } catch (err) {
    statusEl.textContent = `오류: ${err.message}`;
  } finally {
    renderBtn.disabled = false;
  }
});
