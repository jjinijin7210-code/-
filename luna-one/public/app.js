// 2026-08-03: 제부 친구에게 보여줄 Render 데모 배포용 접근 코드 게이트. 로컬 실행(서버에
// DEMO_ACCESS_CODE 없음)에서는 /api/health의 demoMode가 false라 아무 영향 없음.
// 모든 /api 요청에 코드를 자동으로 붙이려고 fetch를 감싸서 오버라이드함 - 곳곳에 흩어진
// 개별 fetch("/api/...") 호출을 하나하나 안 고쳐도 되게 하는 방식.
const ACCESS_CODE_KEY = "luna_access_code";
const _origFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (url.startsWith("/api/")) {
    const code = localStorage.getItem(ACCESS_CODE_KEY);
    if (code) {
      init = { ...init, headers: { ...(init.headers || {}), "X-Access-Code": code } };
    }
  }
  return _origFetch(input, init);
};

(async function ensureAccessCode() {
  try {
    const health = await (await _origFetch("/api/health")).json();
    if (health.demoMode && !localStorage.getItem(ACCESS_CODE_KEY)) {
      const code = prompt("데모 접근 코드를 입력해 주세요:");
      if (code) localStorage.setItem(ACCESS_CODE_KEY, code.trim());
    }
    window.__lunaDemoMode = Boolean(health.demoMode);
    // whisper.cpp 기반 "영상에서 글 뽑기"는 로컬 전용이라 데모에선 숨김(같은 탭의
    // "영상 보고 대본 쓰기"는 whisper 없이 되니까 그대로 둠).
    if (health.demoMode) {
      const extractVideoBtn = document.getElementById("extractVideo");
      const inlineGroup = extractVideoBtn?.closest(".inline");
      if (inlineGroup) {
        inlineGroup.style.display = "none";
        const note = document.createElement("p");
        note.className = "muted";
        note.textContent = "이 기능(영상 나레이션 텍스트 추출)은 정식 버전에서 제공될 예정이에요.";
        inlineGroup.after(note);
      }
    }
  } catch { /* 서버 연결 실패 시 그냥 진행 - 기존 health 체크 로직이 별도로 에러 표시함 */ }
})();

let source = null;
let generated = null;
let activeLanguage = "ko";
let photos = []; // {dataUrl, caption} - 카드뉴스에서 재사용할 실사진, 서버에는 생성 요청 때만 보냄
let lastVideoFile = null; // 썸네일 추천이 실제 영상 장면을 다시 쓸 수 있게 마지막 업로드한 영상 파일 기억
let pastedScreenshotFile = null; // 스크린샷 탭에서 Ctrl+V로 붙여넣은 파일 (파일선택 대신 씀)
let sourceParts = []; // {id, label, title, text}[] - 링크/스크린샷 여러 개를 이어붙여 하나의 원본으로 합칠 때 씀

const SOURCE_TYPE_LABEL = { text: "직접 입력", url: "링크", youtube: "유튜브 자막", screenshot: "스크린샷", ebook: "전자책(PDF)", video: "영상 나레이션", "video-script": "영상 장면 대본" };

function sourcePartLabel(data) {
  if (data.sourceType === "url" && data.sourceUrl) {
    try { return `링크: ${new URL(data.sourceUrl).hostname}`; } catch { /* fall through */ }
  }
  return SOURCE_TYPE_LABEL[data.sourceType] || "소스";
}

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const ICON_EMOJI = {boat:"🚢",plane:"✈️",car:"🚗",train:"🚆",map:"🗺️",clock:"⏰",calendar:"📅",ticket:"🎫",money:"💰",star:"⭐",question:"💬",camera:"📷",food:"🍽️",hotel:"🏨"};

// 게시물 본문에 "필요시" 직접 삽입하는 AI 이미지 사용 안내 문구 (화면에만 뜨는 ai-note와는 별개).
// 3가지 버전 중 골라서 쓸 수 있게 - 어떤 걸 쓸지는 카드마다 있는 select로 고름.
const AI_DISCLOSURE_VERSIONS = [
  "※ 본 콘텐츠에는 AI로 제작된 이미지가 포함되어 있습니다.",
  "이 콘텐츠의 일부 이미지는 AI 기술을 활용하여 제작되었습니다.",
  "본 영상에는 AI로 제작된 이미지 및 시각 효과가 포함되어 있습니다.",
];

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("사진을 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}

async function addPhotoFiles(fileList) {
  // 2026-07-31 요청: "제한 없애도 문제 없으면" - 4장 제한은 AI 프롬프트/렌더링 로직 어디에도
  // 안 걸려있는 순수 UI 제약이었어서(promptBuilder.js가 photos.length를 그대로 읽어서 처리)
  // 그냥 뺌.
  const files = [...fileList].filter(f => f.type.startsWith("image/"));
  for (const file of files) {
    try { photos.push({ dataUrl: await fileToDataUrl(file), caption: "" }); }
    catch (err) { showError(err.message); }
  }
  renderPhotoList();
}

$("#photoInput")?.addEventListener("change", async (e) => {
  await addPhotoFiles(e.target.files);
  e.target.value = "";
});

// 파일 선택창 없이도 드래그앤드롭 / 복사-붙여넣기로 사진을 넣을 수 있게
const photoDropZone = $("#photoDropZone");
if (photoDropZone) {
  ["dragover", "dragenter"].forEach(evt => photoDropZone.addEventListener(evt, e => {
    e.preventDefault();
    photoDropZone.classList.add("drag-over");
  }));
  ["dragleave", "drop"].forEach(evt => photoDropZone.addEventListener(evt, () => photoDropZone.classList.remove("drag-over")));
  photoDropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) await addPhotoFiles(e.dataTransfer.files);
  });
}
window.addEventListener("paste", async (e) => {
  const items = [...(e.clipboardData?.items || [])].filter(it => it.type.startsWith("image/"));
  if (!items.length) return; // 이미지가 아니면 원래 붙여넣기(텍스트 등) 그대로 두기
  e.preventDefault();
  const files = items.map(it => it.getAsFile()).filter(Boolean);
  if (!files.length) return;

  // 스크린샷(글자 읽기) 탭이 열려있을 때 붙여넣으면 대표 사진이 아니라 그 탭으로 보냄
  const activeTab = $(".tab.active")?.dataset.tab;
  if (activeTab === "screenshot") {
    pastedScreenshotFile = files[0];
    renderPastedScreenshotPreview();
    return;
  }
  await addPhotoFiles(files);
});

function renderPastedScreenshotPreview() {
  const box = $("#screenshotPastePreview");
  if (!box) return;
  if (!pastedScreenshotFile) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const url = URL.createObjectURL(pastedScreenshotFile);
  box.classList.remove("hidden");
  box.innerHTML = `<img src="${url}" alt="붙여넣은 스크린샷"><span>붙여넣은 스크린샷 사용 중</span><button type="button" id="clearPastedScreenshot">✕</button>`;
  $("#clearPastedScreenshot").onclick = () => { pastedScreenshotFile = null; renderPastedScreenshotPreview(); };
}

function renderPhotoList() {
  const box = $("#photoList");
  if (!box) return;
  box.innerHTML = photos.map((p, i) => `
    <div class="photo-item">
      ${p.sourceUrl ? `<div class="photo-source-row"><input class="photo-source-input" readonly value="${escapeHtml(p.sourceUrl)}"><button type="button" data-photo-copy="${i}" title="주소 복사">📋</button></div>` : ""}
      <img src="${p.dataUrl}" alt="사진 ${i+1}" data-photo-zoom="${i}" title="크게보기">
      <div class="photo-item-actions">
        ${p.sourceUrl ? `<a class="photo-source-link" href="${p.sourceUrl}" target="_blank" rel="noopener">원본 주소 ↗</a>` : ""}
        <a class="photo-download-link" href="${p.dataUrl}" download="photo-${i+1}.jpg">⬇ 다운로드</a>
      </div>
      <input data-photo-caption="${i}" placeholder="사진 설명 (예: 대표 전경)" value="${escapeHtml(p.caption)}">
      <button data-photo-remove="${i}">삭제</button>
    </div>`).join("");
  $$("[data-photo-caption]").forEach(inp => inp.oninput = () => { photos[Number(inp.dataset.photoCaption)].caption = inp.value; });
  $$("[data-photo-remove]").forEach(btn => btn.onclick = () => { photos.splice(Number(btn.dataset.photoRemove), 1); renderPhotoList(); });
  $$("[data-photo-zoom]").forEach(img => img.onclick = () => openPhotoZoom(photos[Number(img.dataset.photoZoom)], Number(img.dataset.photoZoom)));
  $$("[data-photo-copy]").forEach(btn => btn.onclick = async () => {
    const url = photos[Number(btn.dataset.photoCopy)].sourceUrl;
    try { await navigator.clipboard.writeText(url); flash(btn); } catch { showError("주소 복사에 실패했어요."); }
  });
  // 2026-07-31 요청: "나중에 넣은 사진도 카드마다 추가할 수 있게" - 사진을 올리고 나서
  // 카드뉴스를 만들었을 수도, 카드뉴스를 만든 뒤에 사진을 더 올렸을 수도 있어서, 사진이
  // 바뀔 때마다(추가/삭제/설명수정 아님, 목록 자체가 바뀔 때) 이미 떠 있는 카드뉴스의
  // 사진 선택 줄도 최신 사진 목록으로 다시 그려줌.
  if (generated) renderLanguage();
}

function openPhotoZoom(photo, index) {
  let overlay = $("#photoZoomOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "photoZoomOverlay";
    overlay.className = "photo-zoom-overlay";
    overlay.innerHTML = `<button type="button" class="photo-zoom-close">✕ 닫기</button><img alt="크게보기"><a class="photo-zoom-download">⬇ 다운로드</a>`;
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.classList.contains("photo-zoom-close")) overlay.classList.add("hidden"); });
    document.body.appendChild(overlay);
  }
  overlay.querySelector("img").src = photo.dataUrl;
  const dl = overlay.querySelector(".photo-zoom-download");
  dl.href = photo.dataUrl;
  dl.setAttribute("download", `photo-${index + 1}.jpg`);
  overlay.classList.remove("hidden");
}
$("#clearAllPhotos")?.addEventListener("click", () => {
  photos = [];
  renderPhotoList();
  $("#photoSearchResults").innerHTML = ""; // 고른 사진뿐 아니라 위에 떠있는 검색결과도 같이 지움
  $("#photoSearchInput").value = "";
});

async function runPhotoSearch() {
  const q = $("#photoSearchInput").value.trim();
  if (!q) return;
  const box = $("#photoSearchResults");
  box.innerHTML = `<p class="muted">검색 중…</p>`;
  try {
    const res = await fetch(`/api/photos/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (!data.photos.length) { box.innerHTML = `<p class="muted">검색 결과가 없어요.</p>`; return; }
    box.innerHTML = data.photos.map(p => `<button type="button" data-pexels-pick="${encodeURIComponent(p.full)}" title="사진: ${escapeHtml(p.photographer)}"><img src="${p.thumb}" loading="lazy"></button>`).join("");
    $$("[data-pexels-pick]").forEach(btn => btn.onclick = async () => {
      btn.disabled = true;
      try {
        const url = decodeURIComponent(btn.dataset.pexelsPick);
        const fetchRes = await fetch("/api/photos/fetch", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ url })
        });
        const fetchData = await fetchRes.json();
        if (!fetchRes.ok) throw new Error(fetchData.error);
        photos.push({ dataUrl: fetchData.dataUrl, sourceUrl: url, caption: "" });
        renderPhotoList();
        showError("");
        btn.remove(); // 고른 사진은 검색결과 목록에서 빼서, 전체삭제 후에도 헷갈리지 않게
      } catch(e) { showError(e.message); btn.disabled = false; }
    });
  } catch(e) {
    box.innerHTML = "";
    showError(e.message);
  }
}
$("#photoSearchBtn")?.addEventListener("click", runPhotoSearch);
$("#photoSearchInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runPhotoSearch(); } });

$("#clearText").onclick = () => { $("#textTitle").value = ""; $("#textInput").value = ""; };
$("#clearUrl").onclick = () => { $("#urlInput").value = ""; };
$("#clearYoutube").onclick = () => { $("#youtubeInput").value = ""; };
$("#clearScreenshot").onclick = () => { $("#imageInput").value = ""; pastedScreenshotFile = null; renderPastedScreenshotPreview(); };
$("#clearVideo").onclick = () => { $("#videoInput").value = ""; };
$("#clearPdf").onclick = () => { $("#pdfInput").value = ""; };

$("#resetSource").onclick = () => {
  source = null;
  generated = null;
  photos = [];
  lastVideoFile = null;
  $("#thumbnailResult").classList.add("hidden");
  $("#thumbnailResult").innerHTML = "";
  $("#textTitle").value = "";
  $("#textInput").value = "";
  $("#urlInput").value = "";
  $("#youtubeInput").value = "";
  $("#imageInput").value = "";
  pastedScreenshotFile = null;
  renderPastedScreenshotPreview();
  $("#videoInput").value = "";
  $("#pdfInput").value = "";
  $("#sourcePreview").classList.add("hidden");
  $("#sourceText").value = "";
  $("#addSourcePart").classList.add("hidden");
  sourceParts = [];
  renderSourceParts();
  $("#photoList").innerHTML = "";
  $("#results").classList.add("hidden");
  $("#resultContent").innerHTML = "";
  showError("");
};

$$(".tab").forEach(btn => btn.addEventListener("click", () => {
  $$(".tab").forEach(x => x.classList.remove("active"));
  $$(".tab-pane").forEach(x => x.classList.remove("active"));
  btn.classList.add("active");
  $(`#pane-${btn.dataset.tab}`).classList.add("active");
}));

let localAutomationOn = false;
fetch("/api/health").then(r=>r.json()).then(data=>{
  localAutomationOn = !!data.localAutomation;
  $("#naverAutomationBox").classList.toggle("hidden", !localAutomationOn);
  const img = data.imageProvider ? " · 카드이미지 ON" : " · 카드이미지 OFF(OPENAI_API_KEY 없음)";
  const demo = data.demoMode ? ` · 🧪 데모 버전 (하루 ${data.demoDailyLimit}회 제한)` : "";
  $("#health").textContent = `● ${data.provider.toUpperCase()} 모드${img}${demo}`;
}).catch(()=>$("#health").textContent="● 서버 연결 실패");

$("#naverOpenLogin").onclick = async () => {
  const btn = $("#naverOpenLogin");
  btn.disabled = true;
  try {
    const res = await fetch("/api/naverblog/open-login", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert(data.message);
  } catch(e) { showError(e.message); }
  finally { btn.disabled = false; }
};

// 2026-08-01 요청: "노트북LM 워터마크 지우기 나도 할 수 있게 해줘" - 콘텐츠 생성 흐름과는
// 별개로, 갖고 있는 영상 파일 하나를 그냥 올려서 우측 하단 고정 워터마크만 지우는 독립 도구.
$("#removeWatermarkBtn").onclick = async () => {
  const btn = $("#removeWatermarkBtn");
  const fileInput = $("#watermarkVideoInput");
  const file = fileInput.files?.[0];
  if (!file) return showError("영상 파일을 먼저 선택해주세요.");
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "지우는 중… (영상 길이에 따라 시간이 걸려요)";
  const result = $("#watermarkResult");
  result.classList.add("hidden");
  result.innerHTML = "";
  try {
    const fd = new FormData();
    fd.append("video", file);
    const res = await fetch("/api/watermark/remove", { method: "POST", body: fd });
    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await res.json() : null;
    if (!res.ok) throw new Error(data?.error || `처리하지 못했어요 (HTTP ${res.status}).`);
    if (!data?.videoUrl) throw new Error("완성된 영상 주소를 받지 못했어요.");
    result.classList.remove("hidden");
    result.innerHTML = `
      <p style="margin:10px 0 6px;font-size:13px;font-weight:700">완성됐어요!</p>
      <video src="${data.videoUrl}" controls style="max-height:50vh;border-radius:10px;background:#000;width:100%"></video>
      <div class="inline" style="margin-top:8px">
        <a class="copy" href="${data.videoUrl}" download>⬇ 다운로드</a>
        <button type="button" class="copy" id="watermarkDeleteBtn">삭제</button>
      </div>
    `;
    $("#watermarkDeleteBtn").onclick = async () => {
      const fileName = data.videoUrl.split("/").pop();
      const deleteRes = await fetch(`/api/watermark/${encodeURIComponent(fileName)}`, { method: "DELETE" });
      if (!deleteRes.ok && deleteRes.status !== 404) {
        const deleteData = await deleteRes.json().catch(() => null);
        return showError(deleteData?.error || "파일을 삭제하지 못했어요.");
      }
      result.classList.add("hidden");
      result.innerHTML = "";
    };
    showError("");
  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
};

$("#extractUrl").onclick = () => extractJson("/api/extract/url", { url: $("#urlInput").value });
$("#extractYoutube").onclick = () => extractJson("/api/extract/youtube", { url: $("#youtubeInput").value });

$("#useText").onclick = () => {
  const text = $("#textInput").value.trim();
  if (text.length < 30) return showError("글을 30자 이상 넣어 주세요.");
  setSource({
    title: $("#textTitle").value.trim(),
    text,
    sourceType: "text"
  });
};

$("#extractOcr").onclick = async () => {
  const file = pastedScreenshotFile || $("#imageInput").files[0];
  if (!file) return showError("스크린샷을 선택하거나 Ctrl+V로 붙여넣어 주세요.");
  setBusy(true, "스크린샷의 글자를 읽고 있어요…");
  try {
    const fd = new FormData(); fd.append("image", file); fd.append("lang", $("#ocrLangSelect").value);
    const res = await fetch("/api/extract/ocr", { method:"POST", body:fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setSource(data);
  } catch(e) { showError(e.message); }
  finally { setBusy(false); }
};

$("#extractVideo").onclick = async () => {
  const file = $("#videoInput").files[0];
  if (!file) return showError("영상 파일을 선택해 주세요.");
  lastVideoFile = file;
  setBusy(true, "영상에서 나레이션을 글로 옮기고 있어요… (처음엔 오래 걸려요)");
  try {
    const fd = new FormData(); fd.append("video", file);
    const res = await fetch("/api/extract/video", { method:"POST", body:fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setSource(data);
  } catch(e) { showError(e.message); }
  finally { setBusy(false); }
};

$("#extractVideoScript").onclick = async () => {
  const file = $("#videoInput").files[0];
  if (!file) return showError("영상 파일을 선택해 주세요.");
  lastVideoFile = file;
  setBusy(true, "영상 장면을 보고 대본을 쓰고 있어요…");
  try {
    const fd = new FormData(); fd.append("video", file);
    const res = await fetch("/api/extract/video-script", { method:"POST", body:fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setSource(data);
  } catch(e) { showError(e.message); }
  finally { setBusy(false); }
};

$("#extractPdf").onclick = async () => {
  const file = $("#pdfInput").files[0];
  if (!file) return showError("전자책(PDF) 파일을 선택해 주세요.");
  setBusy(true, "전자책 본문을 읽고 있어요…");
  try {
    const fd = new FormData(); fd.append("pdf", file);
    const res = await fetch("/api/extract/pdf", { method:"POST", body:fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setSource(data);
  } catch(e) { showError(e.message); }
  finally { setBusy(false); }
};

async function extractJson(endpoint, body) {
  setBusy(true, "내용을 안전하게 불러오고 있어요…");
  try {
    const res = await fetch(endpoint, {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setSource(data);
  } catch(e) { showError(e.message); }
  finally { setBusy(false); }
}

function setSource(data) {
  source = data;
  // "바로 입력"은 이미 위 textarea에 보이는 내용을 그대로 다시 보여주는 거라 중복이라,
  // 그 경우만 미리보기 박스를 숨김 (링크/유튜브/스크린샷은 서버가 대신 가져온 내용이라 확인 필요)
  $("#sourcePreview").classList.toggle("hidden", data.sourceType === "text");
  $("#sourceTitle").textContent = data.title || "제목 없음";
  $("#sourceType").textContent = data.sourceType || "source";
  $("#sourceText").value = data.text || "";
  updateCount();
  $("#sourceText").oninput = updateCount;
  showError("");
  $("#addSourcePart").classList.remove("hidden");
  $("#sourcePreview").scrollIntoView({behavior:"smooth", block:"center"});
}

function updateCount(){ $("#charCount").textContent = $("#sourceText").value.length.toLocaleString(); }

// 지금 준비된 소스(텍스트 탭이면 textInput, 그 외엔 미리보기)를 목록에 추가하고, 다음 소스를
// 바로 이어서 넣을 수 있게 입력을 비움. 여러 쇼핑몰 링크·스크린샷을 하나로 합치기 위함.
$("#addSourcePart").onclick = () => {
  if (!source) return;
  const isText = source.sourceType === "text";
  const title = (isText ? $("#textTitle").value : $("#sourceTitle").textContent).trim();
  const text = (isText ? $("#textInput").value : $("#sourceText").value).trim();
  if (text.length < 10) return showError("추가할 내용이 너무 짧아요.");

  sourceParts.push({ id: crypto.randomUUID(), label: sourcePartLabel(source), title, text });
  renderSourceParts();

  // 다음 소스를 이어서 넣을 수 있게 지금 입력은 비움
  source = null;
  $("#textTitle").value = ""; $("#textInput").value = "";
  $("#sourcePreview").classList.add("hidden");
  $("#sourceText").value = ""; updateCount();
  $("#addSourcePart").classList.add("hidden");
  showError(`"${sourceParts[sourceParts.length-1].label}" 추가했어요. 이어서 다른 링크나 스크린샷을 넣어주세요.`);
};

function renderSourceParts() {
  const box = $("#sourceParts");
  box.innerHTML = sourceParts.map(p => `
    <div class="source-part-chip">
      <span><strong>${escapeHtml(p.label)}</strong> · ${escapeHtml(p.title || p.text).slice(0,20)}…</span>
      <button type="button" data-part-remove="${p.id}">✕</button>
    </div>`).join("");
  $$("[data-part-remove]").forEach(btn => btn.onclick = () => {
    sourceParts = sourceParts.filter(p => p.id !== btn.dataset.partRemove);
    renderSourceParts();
  });
}

// 여러 소스를 합쳐서 하나의 source.text로 - sourceParts가 비어있으면(=추가 안 쓰고 하나만
// 쓰는 기존 방식) 지금 미리보기 내용을 그대로 씀, 있으면 전부 이어붙임
function buildCombinedSource() {
  const current = source ? { ...source, text: $("#sourceText").value.trim() || source.text } : null;
  if (!sourceParts.length) return current;
  const parts = current && current.text ? [...sourceParts, { label: sourcePartLabel(current), title: current.title, text: current.text }] : sourceParts;
  return {
    title: parts[0].title || parts[0].label,
    text: parts.map(p => `[출처: ${p.label}]\n${p.text}`).join("\n\n"),
    sourceType: "combined",
  };
}

let generateController = null;

$("#generate").onclick = async () => {
  const combined = buildCombinedSource();
  if (!combined || !combined.text) return showError("먼저 원본 내용을 넣어 주세요.");
  source = combined;
  const platforms = $$(".platforms input:checked").map(x=>x.value);
  const languages = $$(".languages input:checked").map(x=>x.value);
  if (!platforms.length || !languages.length) return showError("플랫폼과 언어를 하나 이상 선택해 주세요.");

  generateController = new AbortController();
  setBusy(true, "선택한 언어와 플랫폼별로 콘텐츠를 만들고 있어요…");
  try {
    const res = await fetch("/api/generate", {
      method:"POST", headers:{"Content-Type":"application/json"},
      signal: generateController.signal,
      body:JSON.stringify({
        source, platforms, languages,
        cardCount:Number($("#cardCount").value),
        tone:$("#tone").value,
        experienceMode:$("#experienceOn").checked ? "balanced" : "source",
        experienceText:$("#experienceText").value.trim(),
        smartEnhance:{travel:$("#travelEnhance").checked,time:$("#timeEnhance").checked,caution:$("#cautionEnhance").checked},
        photos: platforms.includes("cards") ? photos : []
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    generated = data.result;
    activeLanguage = languages[0];
    renderResults(data.provider);
  } catch(e) {
    // 사용자가 취소 버튼을 눌러 fetch를 중단한 경우 - 실패가 아니라 취소니까 다르게 안내
    if (e.name === "AbortError") showError("콘텐츠 만들기를 취소했어요.");
    else showError(e.message);
  }
  finally { setBusy(false); generateController = null; }
};

$("#cancelGenerate").onclick = () => { generateController?.abort(); };

$("#suggestThumbnail").onclick = async () => {
  if (!source) return showError("먼저 원본 내용을 넣어 주세요.");
  const box = $("#thumbnailResult");
  setBusy(true, "후킹 썸네일을 추천하고 있어요…");
  try {
    const fd = new FormData();
    fd.append("title", source.title || "");
    fd.append("text", ($("#sourceText").value || source.text || "").slice(0, 4000));
    if (lastVideoFile) fd.append("video", lastVideoFile);
    const res = await fetch("/api/thumbnail/suggest", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const image = data.recommendedFrame || data.aiImage;
    box.innerHTML = `
      ${image ? `<img src="${image}" alt="추천 썸네일">` : `<p class="muted">이미지 후보는 없어요 - 아래 문구를 직접 만든 썸네일에 얹어 보세요.</p>`}
      <ul class="thumbnail-hooks">
        ${data.hooks.map(h => `<li><span>${escapeHtml(h)}</span><button type="button" class="copy" data-hook-copy="${encodeURIComponent(h)}">복사</button></li>`).join("")}
      </ul>`;
    box.classList.remove("hidden");
    $$("[data-hook-copy]").forEach(btn => btn.onclick = async () => { await copyText(decodeURIComponent(btn.dataset.hookCopy)); flash(btn); });
  } catch(e) { showError(e.message); }
  finally { setBusy(false); }
};

function renderResults(provider) {
  $("#results").classList.remove("hidden");
  const s = generated.summary || {};
  $("#summaryBox").innerHTML = `
    <small>${provider.toUpperCase()} · 추천 플랫폼</small>
    <h3>${escapeHtml(s.recommendedPlatform || "-")}</h3>
    <p><strong>${escapeHtml(s.topic || "")}</strong></p>
    <p>${(s.keyFacts || []).map(x=>"• "+escapeHtml(x)).join("<br>")}</p>
    ${(s.cautions||[]).length ? `<small>확인 사항: ${(s.cautions||[]).map(escapeHtml).join(" · ")}</small>` : ""}
  `;
  const langs = Object.keys(generated.outputs || {});
  $("#languageTabs").innerHTML = langs.map(lang => `<button data-lang="${lang}" class="${lang===activeLanguage?"active":""}">${langName(lang)}</button>`).join("");
  $$("#languageTabs button").forEach(b=>b.onclick=()=>{activeLanguage=b.dataset.lang;renderLanguage();});
  renderLanguage();
  $("#results").scrollIntoView({behavior:"smooth"});
}

const PLATFORM_NAMES = {instagram:"Instagram",tiktok:"TikTok",threads:"Threads",cards:"카드뉴스",googleBlog:"Google Blog",naverBlog:"Naver Blog",youtubeShorts:"YouTube Shorts 대본",youtubeLong:"YouTube 롱폼 대본"};

// 로그인/자동입력/자동게시는 안 함 - 그냥 해당 사이트를 새 탭으로 열어주기만 함
// (메타 등 SNS의 로그인 자동화·화면 조작은 정책상 하면 안 되는 영역이라 의도적으로 여기까지만)
const PLATFORM_SITE_URL = {
  instagram: "https://www.instagram.com/",
  tiktok: "https://www.tiktok.com/upload",
  threads: "https://www.threads.net/",
  googleBlog: "https://www.blogger.com/",
  naverBlog: "https://blog.naver.com/",
};

// 카드마다 새 AI 이미지를 만들지 않고, 업로드한 사진(zoom/blur/dark 등으로 재사용) 또는
// 아이콘으로 배경을 채운다. "AI로 다시 만들기" 버튼은 그래도 안 맞을 때 쓰는 수동 예외.
// 2026-08-02 요청: "카드뉴스 중간중간 설명을 넣어줄 수 있어?" - 네이버 블로그에 카드 이미지를
// 붙여넣을 때 이미지 사이사이에 넣을 설명 문단(blogText, 3~4문장)을 카드 이미지 위 headline/body
// (짧게, 이미지에 그대로 얹힘)와 별도로 만들어서, 이미지 넣을 위치를 명확히 표시해 이어붙임.
function buildCardsCopyText(cards) {
  return (cards || []).map((c) => `[카드 ${c.page} 이미지를 여기에 넣으세요]\n\n${c.blogText || c.body || ""}`).join("\n\n");
}

function renderCardHtml(card, i, total) {
  const v = card.visual || {};
  const photo = v.type === "photo" ? photos[v.photoIndex] : null;
  const bgHtml = photo ? `<div class="news-card-bg treat-${v.treatment||"normal"}" style="background-image:url(${photo.dataUrl})"></div>` : "";
  const iconHtml = !photo ? `<span class="card-icon">${ICON_EMOJI[v.icon]||"⭐"}</span>` : "";
  // 2026-07-31 요청: "카드마다 사진 지정하고, 어디 넣는지 직관적으로 보이게" - AI가 자동으로
  // 고른 사진/아이콘을 카드 아래 썸네일 줄에서 클릭 한 번으로 바꿔 지정할 수 있게 함.
  // 업로드한 사진이 없으면(photos.length===0) 고를 게 없으니 아예 안 보여줌.
  const pickerHtml = photos.length > 0 ? `
    <div class="card-photo-picker">
      <button type="button" class="card-photo-thumb icon-thumb${!photo?" selected":""}" data-card-photo="${i}" data-photo-idx="-1" title="아이콘 사용">${ICON_EMOJI[v.icon]||"⭐"}</button>
      ${photos.map((p,pi)=>`<button type="button" class="card-photo-thumb${photo&&v.photoIndex===pi?" selected":""}" data-card-photo="${i}" data-photo-idx="${pi}" title="사진 ${pi+1} 쓰기"><img src="${p.dataUrl}" alt="사진 ${pi+1}"></button>`).join("")}
    </div>` : "";
  return `<div class="card-item">
    <div class="news-card" data-card-index="${i}">
      ${bgHtml}
      <span class="page">${card.page} / ${total}</span>
      ${iconHtml}
      <div><h4>${escapeHtml(card.headline)}</h4><p>${escapeHtml(card.body)}</p></div>
      <button class="card-image-btn" data-gen-image="${i}" data-hint="${escapeHtml(card.headline||card.body||"")}">🖼 AI로 다시 만들기</button>
    </div>
    ${pickerHtml}
    ${card.blogText ? `<p class="card-blogtext">📝 블로그용 설명: ${escapeHtml(card.blogText)}</p>` : ""}
  </div>`;
}

function renderLanguage() {
  $$("#languageTabs button").forEach(b=>b.classList.toggle("active",b.dataset.lang===activeLanguage));
  const content = generated.outputs[activeLanguage] || {};
  $("#resultContent").innerHTML = Object.entries(content).map(([key,value]) => {
    if (value.error) {
      return `<article class="output-card"><div class="output-head"><h3>${PLATFORM_NAMES[key]||key}</h3></div><p class="error" style="display:block">생성 실패: ${escapeHtml(value.error)}</p></article>`;
    }
    const aiNote = `<p class="ai-note">⚠ AI가 포함된 콘텐츠일 수 있어요. 게시 전 내용을 확인해주세요.</p>`;
    if (key === "cards") {
      // 2026-07-31 요청: "카드마다 사진 지정하는 거 어디 있는지 안 보인다" - 사진을 아예
      // 안 올렸으면 카드마다 고를 사진 자체가 없어서 썸네일 줄이 안 뜸(의도된 동작). 그걸
      // 모르고 헷갈릴 수 있어서, 사진 0장일 땐 위쪽 사진 업로드 칸으로 바로 이동하는 안내
      // 배너를 대신 보여줌.
      const photoHint = photos.length === 0
        ? `<p class="card-photo-hint">📷 사진을 올리면 카드마다 원하는 사진을 직접 골라 넣을 수 있어요. <button type="button" class="card-photo-hint-btn" data-scroll-to-photos>사진 올리러 가기 ↑</button></p>`
        : ""
      return `<article class="output-card">
        <div class="output-head"><h3>${PLATFORM_NAMES[key]}</h3><div class="output-actions"><button class="copy" data-copy-cards="${key}">문구 복사</button><button class="copy" data-save-cards="${key}">💾 텍스트로 저장</button><button class="copy" data-save-cards-image="${key}">🖼 이미지 미리보기</button><button class="copy hidden" id="cardsImageDownloadAllTop">⬇ 전체 다운로드</button></div></div>
        ${photoHint}
        <div class="cards-grid">${(value.cards||[]).map((card,i)=>renderCardHtml(card,i,(value.cards||[]).length)).join("")}</div>
        <div class="cards-image-preview hidden" id="cardsImagePreview"></div>
        ${aiNote}
      </article>`;
    }
    const siteUrl = PLATFORM_SITE_URL[key];
    const fillBtn = key === "naverBlog" && localAutomationOn
      ? `<button class="copy" data-naverblog-fill="${key}">✍ 자동 채우기</button>` : "";
    const defaultVersion = ["tiktok","youtubeShorts","youtubeLong"].includes(key) ? 2 : 0;
    const disclosureOptions = AI_DISCLOSURE_VERSIONS.map((t,i)=>`<option value="${i}"${i===defaultVersion?" selected":""}>${escapeHtml(t.length>18?t.slice(0,18)+"…":t)}</option>`).join("");
    return `<article class="output-card">
      <div class="output-head"><h3>${PLATFORM_NAMES[key] || key}</h3><div class="output-actions"><button class="copy" data-copy="${key}">복사</button><button class="copy" data-save="${key}">💾 저장</button>${siteUrl ? `<a class="copy" href="${siteUrl}" target="_blank" rel="noopener">사이트 열기 ↗</a>` : ""}${fillBtn}</div></div>
      <div class="ai-disclosure-row"><select data-disclosure-version="${key}">${disclosureOptions}</select><button class="copy" data-insert-ai-note="${key}">🏷 문구 삽입</button></div>
      <div class="output-body-edit">
        <input class="edit-title" data-edit-title="${key}" value="${escapeHtml(value.title||"")}">
        <textarea class="edit-content" data-edit-content="${key}" rows="8">${escapeHtml(value.content||"")}</textarea>
      </div>
      ${aiNote}
    </article>`;
  }).join("");

  $$("[data-insert-ai-note]").forEach(btn=>btn.onclick=()=>{
    const key = btn.dataset.insertAiNote;
    const area = $(`[data-edit-content="${key}"]`);
    const versionSelect = $(`[data-disclosure-version="${key}"]`);
    if (!area || !versionSelect) return;
    const text = AI_DISCLOSURE_VERSIONS[Number(versionSelect.value)];
    if (!area.value.includes(text)) area.value = area.value.trim() + `\n\n${text}`;
    flash(btn);
  });

  $$("[data-copy]").forEach(btn=>btn.onclick=async()=>{
    const key = btn.dataset.copy;
    const title = $(`[data-edit-title="${key}"]`)?.value || "";
    const text = $(`[data-edit-content="${key}"]`)?.value || "";
    await copyText(`${title}\n\n${text}`); flash(btn);
  });
  $$("[data-save]").forEach(btn=>btn.onclick=()=>{
    const key = btn.dataset.save;
    const title = $(`[data-edit-title="${key}"]`)?.value || "";
    const text = $(`[data-edit-content="${key}"]`)?.value || "";
    downloadText(`${title}\n\n${text}`, `${key}.txt`);
    flash(btn);
  });
  $$("[data-save-cards]").forEach(btn=>btn.onclick=()=>{
    const v = content.cards;
    downloadText(buildCardsCopyText(v.cards), `cards.txt`);
    flash(btn);
  });
  $$("[data-save-cards-image]").forEach(btn=>btn.onclick=async()=>{
    const v = content.cards;
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = "이미지 만드는 중…";
    try {
      const template = $("#cardTemplate")?.value || "neon";
      const decoration = $("#cardDecoration")?.value || "none";
      const res = await fetch("/api/cards/render-images", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ cards: v.cards || [], photos, template, decoration })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // 2026-07-30 요청: "적용을 한번 해보고 저장을 누르는건 어떨까" - 예전엔 누르자마자 바로
      // 다운로드까지 됐는데, 스타일이 마음에 드는지 미리 볼 수 있게 미리보기만 먼저 보여주고
      // 다운로드는 각 이미지의 "다운로드" 버튼을 따로 눌러야 되게 바꿈.
      const preview = document.getElementById("cardsImagePreview");
      if (preview) {
        preview.classList.remove("hidden");
        preview.innerHTML = `
          <div class="cards-image-preview-grid">
            ${data.images.map((dataUrl, i) => `
              <div class="cards-image-preview-item">
                <img src="${dataUrl}" alt="카드 ${i+1} 미리보기" />
                <a class="copy" href="${dataUrl}" download="카드_${i+1}.png">⬇ 다운로드</a>
              </div>
            `).join("")}
          </div>
        `;
        // 2026-07-31 요청: "이미지 미리보기 옆에 한번에 다운로드 만들어줘" - 예전엔 미리보기
        // 패널 안에 전체 다운로드 버튼이 있었는데, 위에 있는(전체 텍스트 저장용) "전체 저장"
        // 버튼을 대신 눌러서 텍스트만 받는 걸로 헷갈려했음 - "🖼 이미지 미리보기" 버튼 바로
        // 옆에 있던 자리(처음엔 숨김)에 같은 기능을 노출시켜서 헷갈리지 않게 함.
        const topBtn = document.getElementById("cardsImageDownloadAllTop");
        if (topBtn) {
          topBtn.classList.remove("hidden");
          topBtn.textContent = `⬇ 전체 다운로드 (${data.images.length}장)`;
          topBtn.onclick = () => {
            data.images.forEach((dataUrl, i) => {
              const a = document.createElement("a");
              a.href = dataUrl; a.download = `카드_${i+1}.png`; a.click();
            });
          };
        }
        preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      // 2026-07-31 버그 수정: flash(btn)이 "복사됨"으로 바꿨다가 자기가 기억해둔 old로
      // 되돌리는데, 그 시점(flash 호출 시점)엔 아직 finally가 실행되기 전이라 btn.textContent가
      // "이미지 만드는 중…"이었음 - 그래서 1초 뒤 flash의 setTimeout이 버튼 글씨를 다시
      // "이미지 만드는 중…"으로 덮어써버려 계속 그 상태로 보였음(진희님이 겪은 "계속 만드는
      // 중" 문제). 이 버튼은 로딩 텍스트를 finally가 이미 관리하므로 flash() 호출 자체를 뺌.
    } catch(e) { showError(e.message); }
    finally { btn.disabled = false; btn.textContent = old; }
  });
  $$("[data-naverblog-fill]").forEach(btn=>btn.onclick=async()=>{
    const key = btn.dataset.naverblogFill;
    const title = $(`[data-edit-title="${key}"]`)?.value.trim() || "";
    const body = $(`[data-edit-content="${key}"]`)?.value.trim() || "";
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "채우는 중…";
    try {
      const res = await fetch("/api/naverblog/prepare", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ title, body })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showError("");
      alert(data.message);
    } catch(e) { showError(e.message); }
    finally { btn.disabled = false; btn.textContent = old; }
  });
  $$("[data-copy-cards]").forEach(btn=>btn.onclick=async()=>{
    const v=content.cards;
    await copyText(buildCardsCopyText(v.cards)); flash(btn);
  });
  $$("[data-scroll-to-photos]").forEach(btn=>btn.onclick=()=>{
    document.getElementById("cardPhotosBox")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $$("[data-card-photo]").forEach(btn=>btn.onclick=()=>{
    const idx = Number(btn.dataset.cardPhoto);
    const photoIdx = Number(btn.dataset.photoIdx);
    const card = content.cards.cards[idx];
    card.visual = photoIdx >= 0
      ? { ...card.visual, type: "photo", photoIndex: photoIdx }
      : { ...card.visual, type: "icon" };
    renderLanguage();
  });
  $$("[data-gen-image]").forEach(btn=>btn.onclick=async()=>{
    const idx = Number(btn.dataset.genImage);
    const card = content.cards.cards[idx];
    btn.disabled = true;
    btn.textContent = "생성 중…";
    try {
      const res = await fetch("/api/generate/card-image", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ headline: card.headline, body: card.body, visualHint: btn.dataset.hint })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const cardEl = document.querySelector(`.news-card[data-card-index="${idx}"]`);
      let bg = cardEl.querySelector(".news-card-bg");
      if (!bg) { bg = document.createElement("div"); cardEl.insertBefore(bg, cardEl.firstChild); }
      bg.className = "news-card-bg treat-normal";
      bg.style.backgroundImage = `url(${data.dataUrl})`;
      cardEl.querySelector(".card-icon")?.remove();
      btn.textContent = "🖼 AI로 다시 만들기";
      btn.disabled = false;
    } catch(e) {
      btn.disabled = false;
      btn.textContent = "🖼 다시 시도";
      showError(e.message);
    }
  });
}

// 2026-07-27: "메모장으로 딱 정리돼서 보일 수 있게 저장 안 될까?" 요청 - 기존엔 JSON 원본
// 그대로 내려받아서 메모장으로 열면 중괄호/따옴표투성이라 못 읽을 정도였음. 언어·플랫폼별로
// 사람이 바로 읽을 수 있는 평문으로 정리해서 .txt로 저장하도록 바꿈.
function formatGeneratedAsText(generated) {
  const lines = [];
  const langs = Object.keys(generated.outputs || {});
  for (const lang of langs) {
    const platforms = generated.outputs[lang] || {};
    for (const key of Object.keys(platforms)) {
      const piece = platforms[key];
      const label = `${langName(lang)} · ${PLATFORM_NAMES[key] || key}`;
      lines.push("=".repeat(40));
      lines.push(label);
      lines.push("=".repeat(40));
      if (piece.error) {
        lines.push(`(생성 실패: ${piece.error})`);
      } else if (Array.isArray(piece.cards)) {
        if (piece.title) lines.push(piece.title, "");
        piece.cards.forEach((c) => {
          lines.push(`[카드 ${c.page} 이미지를 여기에 넣으세요] ${c.headline}`);
          lines.push(c.blogText || c.body || "");
          lines.push("");
        });
      } else {
        if (piece.title) lines.push(piece.title, "");
        lines.push(piece.content || "");
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

$("#downloadJson").onclick = () => {
  if (!generated) return;
  downloadText(formatGeneratedAsText(generated), "luna-one-결과.txt");
};

function setBusy(on, text="") {
  $("#progress").classList.toggle("hidden",!on);
  if(text) $("#progress span").textContent=text;
  $("#generate").disabled=on;
}
function showError(message) {
  $("#error").textContent=message;
  $("#error").classList.toggle("hidden",!message);
}
function langName(k){return ({ko:"🇰🇷 한국어",ja:"🇯🇵 日本語",en:"🇺🇸 English",zh:"🇨🇳 中文",es:"🇪🇸 Español"})[k]||k}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
async function copyText(t){await navigator.clipboard.writeText(t)}
function downloadText(text, filename){
  const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}
function flash(btn){const old=btn.textContent;btn.textContent="복사됨";setTimeout(()=>btn.textContent=old,1000)}

// ============================================================
// 03. 이야기 보따리 - 자유 창작 / 역사 이야기 (2026-08-23 설계 문서)
// 분량(20/30/45/60분)은 한 번에 못 쓰니까 챕터 단위로 이어쓰기 - 서버가 돌려준
// summary/tail을 previousChapters로 되돌려 보내면서 다음 챕터를 이어받는다.
// ============================================================
let storyChapters = []; // 서버가 돌려준 챕터들 {chapterIndex, chapterCount, title, text, summary, tail, done}

function isHistoryMode() { return $("#storyGenre").value === "history"; }

function updateStoryModeUi() {
  const history = isHistoryMode();
  $("#storyHistoryBox").classList.toggle("hidden", !history);
  $("#storyGrandmaHint").classList.toggle("hidden", history ? false : $("#storyTone").value !== "grandma");
  // 역사 모드는 소재가 필수 - 자유 창작과 가장 다른 부분 (원본 없이 시작 못 하게 막는 게 핵심)
  $("#storySource").placeholder = history
    ? "소재 자료 *필수 - 사료 원문(기록·기사·연구 자료 등)을 그대로 붙여넣어주세요. 여기 넣은 자료 안의 사실만 사용해요."
    : "배경/소재 (선택) - 이야기의 바탕이 될 내용을 적어주세요.";
  updateStoryGenerateState();
}

function updateStoryGenerateState() {
  const history = isHistoryMode();
  const sourceLen = $("#storySource").value.trim().length;
  $("#storyGenerate").disabled = history && sourceLen < 50;
}

$("#storyGenre").onchange = updateStoryModeUi;
$("#storyTone").onchange = updateStoryModeUi;
$("#storySource").addEventListener("input", updateStoryGenerateState);
updateStoryModeUi();

function storyBusy(on) {
  $("#storyProgress").classList.toggle("hidden", !on);
  $("#storyGenerate").disabled = on;
  if (!on) updateStoryGenerateState();
}

async function requestStoryChapter(chapterIndex) {
  const res = await fetch("/api/story/generate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      genre: $("#storyGenre").value,
      source: { title: $("#storyTitle").value.trim(), text: $("#storySource").value.trim() },
      tone: $("#storyTone").value,
      lengthMinutes: Number($("#storyLength").value),
      chapterIndex,
      previousChapters: storyChapters.map(ch => ({ title: ch.title, summary: ch.summary, tail: ch.tail })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

$("#storyGenerate").onclick = async () => {
  storyChapters = [];
  storyBusy(true);
  try {
    storyChapters.push(await requestStoryChapter(0));
    renderStoryResult();
  } catch (e) { showError(e.message); }
  finally { storyBusy(false); }
};

function storyFullText() {
  return storyChapters.map((ch, i) => `${i + 1}장. ${ch.title}\n\n${ch.text}`).join("\n\n");
}

function renderStoryResult() {
  const box = $("#storyResult");
  if (!storyChapters.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const last = storyChapters[storyChapters.length - 1];
  const history = isHistoryMode();
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="output-head"><h3>이야기 (${storyChapters.length}/${last.chapterCount}장)</h3>
      <div class="output-actions"><button type="button" class="copy" id="storyCopyAll">전체 복사</button><button type="button" class="copy" id="storySaveAll">💾 저장</button></div></div>
    ${storyChapters.map((ch, i) => `
      <div class="story-chapter">
        <h4>${i + 1}장. ${escapeHtml(ch.title)}</h4>
        <textarea rows="10" data-story-chapter="${i}">${escapeHtml(ch.text)}</textarea>
      </div>`).join("")}
    <div class="inline" style="margin-top:12px">
      ${last.done ? "" : `<button type="button" class="primary" id="storyNextChapter">▶ 다음 챕터 이어쓰기 (${storyChapters.length + 1}/${last.chapterCount}장)</button>`}
      ${history ? `<button type="button" class="secondary story-source-toggle" id="storySourceToggle">📜 참고한 소재 자료 원문 보기</button>` : ""}
    </div>
    ${history ? `<div id="storySourceOriginal" class="story-source-original hidden"></div>` : ""}
    <p class="ai-note">⚠ AI가 만든 이야기예요.${history ? " 역사 이야기는 게시 전에 소재 자료 원문과 사실관계를 꼭 대조해주세요." : ""}</p>`;

  $$("[data-story-chapter]").forEach(area => area.oninput = () => { storyChapters[Number(area.dataset.storyChapter)].text = area.value; });
  $("#storyCopyAll").onclick = async (e) => { await copyText(storyFullText()); flash(e.target); };
  $("#storySaveAll").onclick = () => downloadText(storyFullText(), "이야기보따리.txt");
  const nextBtn = $("#storyNextChapter");
  if (nextBtn) nextBtn.onclick = async () => {
    nextBtn.disabled = true;
    storyBusy(true);
    try {
      storyChapters.push(await requestStoryChapter(storyChapters.length));
      renderStoryResult();
      $("#storyResult").scrollIntoView({ behavior: "smooth", block: "end" });
    } catch (e) { showError(e.message); nextBtn.disabled = false; }
    finally { storyBusy(false); }
  };
  const srcToggle = $("#storySourceToggle");
  if (srcToggle) srcToggle.onclick = () => {
    const panel = $("#storySourceOriginal");
    // 생성 후 소재란을 수정해도 "그때 참고한 원문"을 보여줘야 하지만, 단순화를 위해 현재
    // 입력값을 보여줌 - 사실관계 재확인 용도로는 충분 (생성 직후 대조가 일반적인 흐름)
    panel.textContent = $("#storySource").value.trim() || "(소재 자료가 비어 있어요)";
    panel.classList.toggle("hidden");
  };
}

// ============================================================
// 04. 가사 쓰기 - Suno용 [Verse]/[Chorus] 가사 + 스타일 태그, 곡 길이 기본값은 숏폼(1:30~2:00)
// ============================================================
$("#lyricsLength").onchange = () => {
  $("#lyricsCustomLabel").classList.toggle("hidden", $("#lyricsLength").value !== "custom");
};

$("#lyricsGenerate").onclick = async () => {
  const theme = $("#lyricsTheme").value.trim();
  if (!theme) return showError("어떤 이야기/주제의 노래인지 먼저 적어주세요.");
  $("#lyricsGenerate").disabled = true;
  $("#lyricsProgress").classList.remove("hidden");
  try {
    const res = await fetch("/api/lyrics/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme,
        mood: $("#lyricsMood").value.trim(),
        songLength: $("#lyricsLength").value,
        customLength: $("#lyricsCustomLength").value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const box = $("#lyricsResult");
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="output-card lyrics-result-card">
        <div class="output-head"><h3>${escapeHtml(data.title)}</h3>
          <div class="output-actions"><button type="button" class="copy" id="lyricsCopy">가사 복사</button><button type="button" class="copy" id="lyricsSave">💾 저장</button></div></div>
        <p class="muted">스타일 태그 (Suno 스타일 칸에 붙여넣기): <strong>${escapeHtml(data.styleTags)}</strong> <button type="button" class="copy" id="lyricsCopyTags">복사</button></p>
        <textarea id="lyricsText" rows="14">${escapeHtml(data.lyrics)}</textarea>
        <p class="ai-note">⚠ AI가 쓴 가사예요. 발표 전 내용을 확인해주세요.</p>
      </div>`;
    $("#lyricsCopy").onclick = async (e) => { await copyText($("#lyricsText").value); flash(e.target); };
    $("#lyricsCopyTags").onclick = async (e) => { await copyText(data.styleTags); flash(e.target); };
    $("#lyricsSave").onclick = () => downloadText(`${data.title}\n\n[Style Tags]\n${data.styleTags}\n\n${$("#lyricsText").value}`, "가사.txt");
    showError("");
  } catch (e) { showError(e.message); }
  finally { $("#lyricsGenerate").disabled = false; $("#lyricsProgress").classList.add("hidden"); }
};

// ============================================================
// 05. 모션그래픽 만들기 - 렌더링은 애니원 서버가 담당, 루나원은 요청/결과만 (얇은 연동)
// ============================================================
let motionTemplates = [];

async function loadMotionTemplates() {
  try {
    const res = await fetch("/api/motion/templates");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    motionTemplates = data.templates || [];
    $("#motionTemplate").innerHTML = motionTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)} - ${escapeHtml(t.description)}</option>`).join("");
    $("#motionForm").classList.remove("hidden");
    $("#motionUnavailable").classList.add("hidden");
    renderMotionFields();
  } catch {
    // 애니원 서버가 꺼져 있으면 폼 대신 안내만 - 루나원의 다른 기능은 그대로 다 됨
    $("#motionUnavailable").classList.remove("hidden");
    $("#motionForm").classList.add("hidden");
  }
}
loadMotionTemplates();

function renderMotionFields() {
  const tpl = motionTemplates.find(t => t.id === $("#motionTemplate").value) || motionTemplates[0];
  if (!tpl) return;
  $("#motionFields").innerHTML = tpl.fields.map(f => {
    if (f.type === "select") {
      return `<label>${escapeHtml(f.label)}<select data-motion-field="${f.key}">${f.options.map(o => `<option value="${o}">${o === "intro" ? "인트로" : o === "outro" ? "아웃트로" : o}</option>`).join("")}</select></label>`;
    }
    return `<label>${escapeHtml(f.label)}${f.required ? " *" : ""}<input data-motion-field="${f.key}" type="${f.type === "number" ? "number" : "text"}" placeholder="${f.example !== "" && f.example !== undefined ? `예: ${escapeHtml(String(f.example))}` : ""}"></label>`;
  }).join("");
}
$("#motionTemplate").onchange = renderMotionFields;

let motionPollTimer = null;
function pollMotionStatus(jobId) {
  motionPollTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/motion/status/${jobId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.status === "done") {
        $("#motionProgress").classList.add("hidden");
        $("#motionGenerate").disabled = false;
        const box = $("#motionResult");
        box.classList.remove("hidden");
        box.innerHTML = `
          <div class="output-card motion-result-card">
            <div class="output-head"><h3>완성됐어요!</h3>
              <div class="output-actions"><a class="copy" href="${data.videoUrl}" download target="_blank" rel="noopener">⬇ 다운로드</a></div></div>
            <video src="${data.videoUrl}" controls></video>
          </div>`;
      } else if (data.status === "error") {
        throw new Error(data.error || "렌더링에 실패했어요.");
      } else {
        pollMotionStatus(jobId);
      }
    } catch (e) {
      $("#motionProgress").classList.add("hidden");
      $("#motionGenerate").disabled = false;
      showError(e.message);
    }
  }, 2000);
}

$("#motionGenerate").onclick = async () => {
  const props = {};
  $$("[data-motion-field]").forEach(el => { props[el.dataset.motionField] = el.value; });
  $("#motionGenerate").disabled = true;
  $("#motionProgress").classList.remove("hidden");
  $("#motionResult").classList.add("hidden");
  clearTimeout(motionPollTimer);
  try {
    const res = await fetch("/api/motion/render", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template: $("#motionTemplate").value,
        props,
        aspect: $("#motionAspect").value,
        durationSec: Number($("#motionDuration").value),
        brandColor: $("#motionColor").value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showError("");
    pollMotionStatus(data.jobId);
  } catch (e) {
    $("#motionGenerate").disabled = false;
    $("#motionProgress").classList.add("hidden");
    showError(e.message);
  }
};
