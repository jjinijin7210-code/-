// ============================================================
// OpenAI 이미지 생성 호출 래퍼 - fetch만 사용 (별도 SDK 설치 불필요)
// ============================================================

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'

export async function generateImage({ prompt, size = '1024x1024' }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  }
  if (!prompt || !prompt.trim()) {
    throw new Error('이미지 설명(prompt)이 필요해요.')
  }

  const res = await fetch(OPENAI_IMAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size,
      n: 1,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenAI 이미지 생성 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }

  const data = await res.json()
  const b64 = data.data?.[0]?.b64_json
  if (!b64) {
    throw new Error('OpenAI 응답에서 이미지 데이터를 찾지 못했어요.')
  }
  return `data:image/png;base64,${b64}`
}
