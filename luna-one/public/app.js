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

$(".platforms")?.addEventListener("change", () => {
  const cardsChecked = $$(".platforms input:checked").some(x => x.value === "cards");
  $("#cardPhotosBox").classList.toggle("hidden", !cardsChecked);
});

$$(".tab").forEach(btn => btn.addEventListener("click", () => {
  $$(".tab").forEach(x => x.classList.remove("active"));
  $$(".tab-pane").forEach(x => x.classList.remove("active"));
  btn.classList.add("active");
  $(`#pane-${btn.dataset.tab}`).classList.add("active");
}));

fetch("/api/health").then(r=>r.json()).then(data=>{
  const img = data.imageProvider ? " · 카드이미지 ON" : " · 카드이미지 OFF(OPENAI_API_KEY 없음)";
  $("#health").textContent = `● ${data.provider.toUpperCase()} 모드${img}`;
}).catch(()=>$("#health").textContent="● 서버 연결 실패");

$("#extractUrl").onclick = () => extractJson("/api/extract/url", { url: $("#urlInput").value });
$("#extractYoutube").onclick = () => extractJson("/api/extract/youtube", { url: $("#youtubeInput").value });

$("#useText").onclick = () => {
  const text = $("#textInput").value.trim();
  if (text.length < 30) return showError("글을 30자 이상 넣어 주세요.");
  setSource({
    title: $("#textTitle").value.trim() || "복사한 글",
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
  $("#sourcePreview").classList.remove("hidden");
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

const PLATFORM_NAMES = {instagram:"Instagram",tiktok:"TikTok",threads:"Threads",cards:"카드뉴스",googleBlog:"Google Blog",naverBlog:"Naver Blog"};

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
    if (key === "cards") {
      return `<article class="output-card">
        <div class="output-head"><h3>${PLATFORM_NAMES[key]}</h3><button class="copy" data-copy-cards="${key}">문구 복사</button></div>
        <div class="cards-grid">${(value.cards||[]).map((card,i)=>renderCardHtml(card,i,(value.cards||[]).length)).join("")}</div>
      </article>`;
    }
    return `<article class="output-card">
      <div class="output-head"><h3>${PLATFORM_NAMES[key] || key}</h3><button class="copy" data-copy="${key}">복사</button></div>
      <div class="output-body"><strong>${escapeHtml(value.title||"")}</strong>\n\n${escapeHtml(value.content||"")}</div>
    </article>`;
  }).join("");

  $$("[data-copy]").forEach(btn=>btn.onclick=async()=>{
    const v=content[btn.dataset.copy]; await copyText(`${v.title}\n\n${v.content}`); flash(btn);
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
function flash(btn){const old=btn.textContent;btn.textContent="복사됨";setTimeout(()=>btn.textContent=old,1000)}
