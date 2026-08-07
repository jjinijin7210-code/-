// 실시간 통역기 - 몽골어/영어/중국어/일본어 ↔ 한국어.
// STT/TTS는 브라우저 내장 Web Speech API를 쓴다(비용 없음) - 번역 문장 자체만 서버(/api/translate,
// Claude)로 처리. 몽골어는 브라우저 음성엔진 지원이 기기마다 다를 수 있어서, 안 되면 조용히
// 실패하지 않고 화면에 바로 이유를 보여주는 걸 원칙으로 함(문자 번역은 언어 상관없이 항상 됨).

const LANGS = {
  ko: { name: "한국어", locale: "ko-KR" },
  mn: { name: "몽골어", locale: "mn-MN" },
  en: { name: "영어", locale: "en-US" },
  zh: { name: "중국어", locale: "zh-CN" },
  ja: { name: "일본어", locale: "ja-JP" },
};

const $ = (sel) => document.querySelector(sel);
const targetSelect = $("#targetLang");
const micKoBtn = $("#micKo");
const micTargetBtn = $("#micTarget");
const micTargetLabel = $("#micTargetLabel");
const statusLine = $("#statusLine");
const logEl = $("#conversationLog");
const voiceWarningEl = $("#voiceWarning");
const unsupportedNoticeEl = $("#unsupportedNotice");
const textInput = $("#textInput");
const sendKoToTargetBtn = $("#sendKoToTarget");
const sendTargetToKoBtn = $("#sendTargetToKo");
const targetNameSpans = document.querySelectorAll(".target-name");

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

let availableVoices = [];
function loadVoices() {
  availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}
loadVoices();
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function findVoiceFor(locale) {
  const prefix = locale.split("-")[0];
  return availableVoices.find((v) => v.lang === locale) || availableVoices.find((v) => v.lang?.startsWith(prefix));
}

function updateVoiceWarning() {
  const lang = LANGS[targetSelect.value];
  micTargetLabel.textContent = `${lang.name}로 말하기`;
  targetNameSpans.forEach((el) => { el.textContent = lang.name; });
  const voice = findVoiceFor(lang.locale);
  if (voice) {
    voiceWarningEl.classList.add("hidden");
  } else {
    voiceWarningEl.textContent = `⚠️ 이 기기·브라우저엔 ${lang.name} 목소리가 없어서 소리로는 안 나올 수 있어요. 그럴 땐 화면에 뜬 번역 글자를 보여주세요 - 번역 자체는 정상적으로 돼요.`;
    voiceWarningEl.classList.remove("hidden");
  }
}
targetSelect.addEventListener("change", updateVoiceWarning);
// 음성 목록은 비동기로 늦게 채워지는 경우가 많아서, 로드 직후와 약간 지연 후 두 번 확인
updateVoiceWarning();
setTimeout(updateVoiceWarning, 600);

function addBubble({ side, original, translated }) {
  const empty = logEl.querySelector(".conversation-empty");
  if (empty) empty.remove();
  const bubble = document.createElement("div");
  bubble.className = `bubble ${side === "ko" ? "bubble-ko" : "bubble-target"}`;
  const orig = document.createElement("div");
  orig.className = "original";
  orig.textContent = original;
  const trans = document.createElement("div");
  trans.className = "translated";
  trans.textContent = translated;
  const replayBtn = document.createElement("button");
  replayBtn.type = "button";
  replayBtn.className = "replay-btn";
  replayBtn.textContent = "🔊 다시 듣기";
  replayBtn.addEventListener("click", () => speak(translated, side === "ko" ? LANGS[targetSelect.value].locale : LANGS.ko.locale));
  bubble.append(orig, trans, replayBtn);
  logEl.appendChild(bubble);
  logEl.scrollTop = logEl.scrollHeight;
}

function speak(text, locale) {
  if (!window.speechSynthesis || !text) return;
  const voice = findVoiceFor(locale);
  if (!voice) return; // 목소리 없는 언어는 화면 글자로만 - 엉뚱한 발음으로 읽는 것보다 나음
  const utter = new SpeechSynthesisUtterance(text);
  utter.voice = voice;
  utter.lang = locale;
  window.speechSynthesis.speak(utter);
}

async function translate(text, targetLangCode) {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, targetLang: targetLangCode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "번역 실패");
  return data.translated;
}

// 듣기(음성)든 타이핑(텍스트)이든 결과 처리는 동일 - 번역하고, 말풍선에 얹고, 소리로 읽어줌.
async function handleUtterance(sourceKey, heard) {
  if (!heard || !heard.trim()) return;
  const targetKey = sourceKey === "ko" ? targetSelect.value : "ko";
  statusLine.textContent = "번역 중…";
  try {
    const translated = await translate(heard, targetKey);
    addBubble({
      side: sourceKey === "ko" ? "ko" : "target",
      original: heard,
      translated,
    });
    speak(translated, LANGS[targetKey].locale);
    statusLine.textContent = "";
  } catch (err) {
    statusLine.textContent = `⚠️ ${err.message}`;
  }
}

sendKoToTargetBtn.addEventListener("click", () => {
  const text = textInput.value;
  textInput.value = "";
  handleUtterance("ko", text);
});
sendTargetToKoBtn.addEventListener("click", () => {
  const text = textInput.value;
  textInput.value = "";
  handleUtterance(targetSelect.value, text);
});
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendKoToTargetBtn.click(); // 엔터는 기본적으로 한국어→상대언어 방향
});

let activeRecognition = null;

function startListening({ sourceLocale, sourceKey, button }) {
  if (!SpeechRecognitionCtor) return;
  if (activeRecognition) {
    activeRecognition.stop();
    return;
  }
  const recognition = new SpeechRecognitionCtor();
  recognition.lang = sourceLocale;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  activeRecognition = recognition;
  button.classList.add("listening");
  statusLine.textContent = `${LANGS[sourceKey].name} 듣는 중…`;

  recognition.onresult = (event) => {
    const heard = event.results[0]?.[0]?.transcript;
    handleUtterance(sourceKey, heard);
  };
  recognition.onerror = (event) => {
    statusLine.textContent = `⚠️ 음성 인식 오류: ${event.error} (${LANGS[sourceKey].name} 인식이 이 기기에서 안 될 수 있어요)`;
  };
  recognition.onend = () => {
    button.classList.remove("listening");
    activeRecognition = null;
    if (statusLine.textContent.startsWith(`${LANGS[sourceKey].name} 듣는`)) statusLine.textContent = "";
  };
  recognition.start();
}

if (!SpeechRecognitionCtor) {
  unsupportedNoticeEl.classList.remove("hidden");
  micKoBtn.disabled = true;
  micTargetBtn.disabled = true;
} else {
  micKoBtn.addEventListener("click", () => startListening({ sourceLocale: LANGS.ko.locale, sourceKey: "ko", button: micKoBtn }));
  micTargetBtn.addEventListener("click", () => {
    const key = targetSelect.value;
    startListening({ sourceLocale: LANGS[key].locale, sourceKey: key, button: micTargetBtn });
  });
}
