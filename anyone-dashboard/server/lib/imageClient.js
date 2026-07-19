// ============================================================
// OpenAI 이미지 생성 호출 래퍼 - fetch만 사용 (별도 SDK 설치 불필요)
// ============================================================

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'
const OPENAI_IMAGES_EDIT_URL = 'https://api.openai.com/v1/images/edits'

// 2026-07-19 사용자 피드백: 썸네일에 텍스트를 넣을 때 AI가 노란색 한 가지만 계속 쓰는 경향이
// 있어서(예: "TOP5" 전부 노란색), 색상 위계를 명확히 지정해달라고 함 - 자동 파이프라인이든
// 수동 "AI 이미지 생성" 버튼이든 어디서 호출하든 항상 이 지침이 같이 붙도록 generateImage()
// 자체에 붙여둠(호출하는 쪽에서 매번 챙기지 않아도 되게).
const THUMBNAIL_COLOR_RULE = `[텍스트 색상 지침] 이미지 안에 글자를 넣을 경우, 한 가지 색으로 전부
칠하지 말고 중요도에 따라 색을 나눠서 써: 가장 중요한 문구는 핑크색, 그보다 덜 중요한 문구는
노란색, 일반적인 설명 문구는 흰색으로. 글자 크기도 너무 크게 화면을 꽉 채우지 말고 배경 사진이
잘 보이도록 적당히.`

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
      prompt: `${prompt}\n\n${THUMBNAIL_COLOR_RULE}`,
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

// 참고 사진(data URL)을 올리면 그 사진을 바탕으로 "비슷한" 새 이미지를 생성 (원본을 그대로
// 재사용하지 않고 AI가 다시 그려서 새로 만드는 것 - images/edits 엔드포인트, multipart 요청)
export async function editImage({ imageDataUrl, prompt, size = '1024x1024' }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  }
  if (!imageDataUrl) {
    throw new Error('참고 이미지가 필요해요.')
  }
  if (!prompt || !prompt.trim()) {
    throw new Error('이미지 설명(prompt)이 필요해요.')
  }

  const match = /^data:([^;]+);base64,(.+)$/.exec(imageDataUrl)
  if (!match) {
    throw new Error('참고 이미지 형식이 올바르지 않아요.')
  }
  const [, mimeType, base64] = match
  const buffer = Buffer.from(base64, 'base64')

  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('image[]', new Blob([buffer], { type: mimeType }), 'reference.png')
  form.append('prompt', `${prompt}\n\n${THUMBNAIL_COLOR_RULE}`)
  form.append('size', size)
  form.append('n', '1')

  const res = await fetch(OPENAI_IMAGES_EDIT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenAI 이미지 편집 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }

  const data = await res.json()
  const b64 = data.data?.[0]?.b64_json
  if (!b64) {
    throw new Error('OpenAI 응답에서 이미지 데이터를 찾지 못했어요.')
  }
  return `data:image/png;base64,${b64}`
}
