// ============================================================
// ElevenLabs TTS 호출 래퍼 - fetch만 사용 (별도 SDK 설치 불필요)
// 내레이션 텍스트를 mp3 오디오 파일로 만들어준다.
// ============================================================

const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM' // Rachel (multilingual)

export async function generateSpeech({ text, voiceId = DEFAULT_VOICE_ID }) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  }
  if (!text || !text.trim()) {
    throw new Error('내레이션 텍스트(text)가 필요해요.')
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`ElevenLabs TTS 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
