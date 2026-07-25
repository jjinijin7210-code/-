let source = null;
let generated = null;
let activeLanguage = "ko";
let photos = []; // {dataUrl, caption} - 카드뉴스에서 재사용할 실사진, 서버에는 생성 요청 때만 보냄

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const ICON_EMOJI = {boat:"🚢",plane:"✈️",car:"🚗",train:"🚆",map:"🗺️",clock:"⏰",calendar:"📅",ticket:"🎫",money:"💰",star:"⭐",question:"💬",camera:"📷",food:"🍽️",hotel:"🏨"};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("사진을 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}

$("#photoInput")?.addEventListener("change", async (e) => {
  const files = [...e.target.files].slice(0, Math.max(0, 4 - photos.length));
  for (const file of files) {
    try { photos.push({ dataUrl: await fileToDataUrl(file), caption: "" }); }
    catch (err) { showError(err.message); }
  }
  e.target.value = "";
  renderPhotoList();
});

function renderPhotoList() {
  const box = $("#photoList");
  if (!box) return;
  box.innerHTML = photos.map((p, i) => `
    <div class="photo-item">
      <img src="${p.dataUrl}" alt="사진 ${i+1}">
      <input data-photo-caption="${i}" placeholder="사진 설명 (예: 대표 전경)" value="${escapeHtml(p.caption)}">
      <button data-photo-remove="${i}">삭제</button>
    </div>`).join("");
  $$("[data-photo-caption]").forEach(inp => inp.oninput = () => { photos[Number(inp.dataset.photoCaption)].caption = inp.value; });
  $$("[data-photo-remove]").forEach(btn => btn.onclick = () => { photos.splice(Number(btn.dataset.photoRemove), 1); renderPhotoList(); });
}

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
      if (photos.length >= 4) return showError("사진은 최대 4장까지예요.");
      btn.disabled = true;
      try {
        const url = decodeURIComponent(btn.dataset.pexelsPick);
        const fetchRes = await fetch("/api/photos/fetch", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ url })
        });
        const fetchData = await fetchRes.json();
        if (!fetchRes.ok) throw new Error(fetchData.error);
        photos.push({ dataUrl: fetchData.dataUrl, caption: "" });
        renderPhotoList();
        showError("");
      } catch(e) { showError(e.message); }
      finally { btn.disabled = false; }
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
$("#clearScreenshot").onclick = () => { $("#imageInput").value = ""; };

$(".platforms")?.addEventListener("change", () => {
  const cardsChecked = $$(".platforms input:checked").some(x => x.value === "cards");
  $("#cardPhotosBox").classList.toggle("hidden", !cardsChecked);
});

$("#resetSource").onclick = () => {
  source = null;
  generated = null;
  photos = [];
  $("#textTitle").value = "";
  $("#textInput").value = "";
  $("#urlInput").value = "";
  $("#youtubeInput").value = "";
  $("#imageInput").value = "";
  $("#sourcePreview").classList.add("hidden");
  $("#sourceText").value = "";
  $("#photoList").innerHTML = "";
  $("#cardPhotosBox").classList.add("hidden");
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
  $("#health").textContent = `● ${data.provider.toUpperCase()} 모드${img}`;
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
  const file = $("#imageInput").files[0];
  if (!file) return showError("스크린샷을 선택해 주세요.");
  setBusy(true, "스크린샷의 글자를 읽고 있어요…");
  try {
    const fd = new FormData(); fd.append("image", file);
    const res = await fetch("/api/extract/ocr", { method:"POST", body:fd });
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
  $("#sourcePreview").scrollIntoView({behavior:"smooth", block:"center"});
}

function updateCount(){ $("#charCount").textContent = $("#sourceText").value.length.toLocaleString(); }

$("#generate").onclick = async () => {
  if (!source) return showError("먼저 원본 내용을 넣어 주세요.");
  source.text = $("#sourceText").value.trim();
  const platforms = $$(".platforms input:checked").map(x=>x.value);
  const languages = $$(".languages input:checked").map(x=>x.value);
  if (!platforms.length || !languages.length) return showError("플랫폼과 언어를 하나 이상 선택해 주세요.");

  setBusy(true, "선택한 언어와 플랫폼별로 콘텐츠를 만들고 있어요…");
  try {
    const res = await fetch("/api/generate", {
      method:"POST", headers:{"Content-Type":"application/json"},
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
function renderCardHtml(card, i, total) {
  const v = card.visual || {};
  const photo = v.type === "photo" ? photos[v.photoIndex] : null;
  const bgHtml = photo ? `<div class="news-card-bg treat-${v.treatment||"normal"}" style="background-image:url(${photo.dataUrl})"></div>` : "";
  const iconHtml = !photo ? `<span class="card-icon">${ICON_EMOJI[v.icon]||"⭐"}</span>` : "";
  return `<div class="news-card" data-card-index="${i}">
    ${bgHtml}
    <span class="page">${card.page} / ${total}</span>
    ${iconHtml}
    <div><h4>${escapeHtml(card.headline)}</h4><p>${escapeHtml(card.body)}</p></div>
    <button class="card-image-btn" data-gen-image="${i}" data-hint="${escapeHtml(card.headline||card.body||"")}">🖼 AI로 다시 만들기</button>
  </div>`;
}

function renderLanguage() {
  $$("#languageTabs button").forEach(b=>b.classList.toggle("active",b.dataset.lang===activeLanguage));
  const content = generated.outputs[activeLanguage] || {};
  $("#resultContent").innerHTML = Object.entries(content).map(([key,value]) => {
    if (value.error) {
      return `<article class="output-card"><div class="output-head"><h3>${PLATFORM_NAMES[key]||key}</h3></div><p class="error" style="display:block">생성 실패: ${escapeHtml(value.error)}</p></article>`;
    }
    const aiNote = `<p class="ai-note">⚠ AI가 생성한 콘텐츠예요. 게시 전 내용을 확인해주세요.</p>`;
    if (key === "cards") {
      return `<article class="output-card">
        <div class="output-head"><h3>${PLATFORM_NAMES[key]}</h3><div class="output-actions"><button class="copy" data-copy-cards="${key}">문구 복사</button><button class="copy" data-save-cards="${key}">💾 저장</button></div></div>
        <div class="cards-grid">${(value.cards||[]).map((card,i)=>renderCardHtml(card,i,(value.cards||[]).length)).join("")}</div>
        ${aiNote}
      </article>`;
    }
    const siteUrl = PLATFORM_SITE_URL[key];
    const fillBtn = key === "naverBlog" && localAutomationOn
      ? `<button class="copy" data-naverblog-fill="${key}">✍ 자동 채우기</button>` : "";
    return `<article class="output-card">
      <div class="output-head"><h3>${PLATFORM_NAMES[key] || key}</h3><div class="output-actions"><button class="copy" data-copy="${key}">복사</button><button class="copy" data-save="${key}">💾 저장</button>${siteUrl ? `<a class="copy" href="${siteUrl}" target="_blank" rel="noopener">사이트 열기 ↗</a>` : ""}${fillBtn}</div></div>
      <div class="output-body-edit">
        <input class="edit-title" data-edit-title="${key}" value="${escapeHtml(value.title||"")}">
        <textarea class="edit-content" data-edit-content="${key}" rows="8">${escapeHtml(value.content||"")}</textarea>
      </div>
      ${aiNote}
    </article>`;
  }).join("");

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
    const text = (v.cards||[]).map(c=>`${c.page}장\n${c.headline}\n${c.body}`).join("\n\n");
    downloadText(text, `cards.txt`);
    flash(btn);
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
    const v=content.cards; const text=(v.cards||[]).map(c=>`${c.page}장\n${c.headline}\n${c.body}`).join("\n\n");
    await copyText(text); flash(btn);
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

$("#downloadJson").onclick = () => {
  if (!generated) return;
  const blob = new Blob([JSON.stringify(generated,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="luna-one-result.json"; a.click();
  URL.revokeObjectURL(a.href);
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
