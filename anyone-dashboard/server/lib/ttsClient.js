// ============================================================
// ElevenLabs TTS 호출 래퍼 - fetch만 사용 (별도 SDK 설치 불필요)
// 내레이션 텍스트를 mp3 오디오 파일로 만들어준다.
// ============================================================

const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM' // Rachel (multilingual)

// 2026-07-30 벤치마킹(다른 채널의 AI 영상 자동화 워크플로우) 반영 - 따옴표/괄호/이모지/URL이
// 내레이션 텍스트에 섞여 있으면 TTS가 이상하게 읽거나(예: 괄호 안 영문을 그대로 읽음) 자막이
// 지저분해지는 문제가 있다고 함. 호출하는 쪽마다 각자 다듬게 두지 않고, TTS로 보내는 마지막
// 관문인 여기서 한 번에 자동 정리해서 어디서 부르든 항상 적용되게 함.
function sanitizeNarrationText(text) {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, '') // URL 제거
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '') // 이메일 제거
    .replace(/([가-힣a-zA-Z0-9]+)\([^)]*\)/g, '$1') // "단어(설명)" -> "단어" (괄호 안 내용째 제거)
    .replace(/[()]/g, '') // 남은 괄호 문자(짝 안 맞는 것 포함) 제거
    .replace(/["'"'『』「」]/g, '') // 따옴표류 제거
    .replace(/\.(?=\S)/g, '. ') // 마침표 뒤 띄어쓰기 없으면 추가
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export async function generateSpeech({ text, voiceId = DEFAULT_VOICE_ID, stability = 0.5, similarityBoost = 0.75 }) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  }
  if (!text || !text.trim()) {
    throw new Error('내레이션 텍스트(text)가 필요해요.')
  }
  const cleanText = sanitizeNarrationText(text)

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: cleanText,
      model_id: 'eleven_multilingual_v2',
      // stability를 높일수록 톤 기복이 줄어서 차분하게 들림 (기본값은 짧고 임팩트 있는
      // 상품 쇼츠용 - 심리학 콘텐츠처럼 차분해야 하는 경우 호출하는 쪽에서 더 높여서 씀)
      voice_settings: { stability, similarity_boost: similarityBoost },
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`ElevenLabs TTS 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
