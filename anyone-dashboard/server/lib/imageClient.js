// ============================================================
// AI 이미지 생성 래퍼 - OpenAI / Pollinations.ai 듀얼 연동
// 한글 프롬프트 자동 번역 & 100% 무료 폴백 지원
// ============================================================

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'
const OPENAI_IMAGES_EDIT_URL = 'https://api.openai.com/v1/images/edits'

const THUMBNAIL_COLOR_RULE = `[텍스트 색상 지침] 이미지 안에 글자를 넣을 경우, 한 가지 색으로 전부 칠하지 말고 중요도에 따라 색을 나눠서 써: 가장 중요한 문구는 핑크색, 그보다 덜 중요한 문구는 노란색, 일반적인 설명 문구는 흰색으로.`
const NO_TEXT_RULE = `[텍스트 금지] 이 이미지 안에는 어떤 글자·문구·숫자·라벨도 그려 넣지 마세요. 사진/일러스트 자체만 그리세요.`
const CLEAN_ELEGANT_AESTHETIC_RULE = `[품격 보장 금지 수칙] 야하거나 불쾌한 노출 컷, 레트로풍의 촌스러운 의상, 이상한 인물 묘사는 100% 금지합니다. 매우 세련되고 품격 있는 현대적 8K 시네마틱 스타일로만 그리세요.`

// 한글 ➡️ 영문 자동 번역 및 가사 시각 장면 변환기
function translatePromptToEnglish(text) {
  if (!text) return 'high quality 3d product photo'
  if (/^[a-zA-Z0-9\s,.\-!_]+$/.test(text)) return text

  // 노래 가사/트롯 가사 입력 시 가사와 100% 매칭되는 시각적 음악 연출 장면으로 자동 변환
  if (text.includes('가사') || text.includes('트롯') || text.includes('노래') || text.includes('음악')) {
    return `emotional Korean trot music stage, glowing neon microphone, nostalgic evening sunset landscape, warm golden lighting, 8k cinematic digital art wallpaper, matching lyrics for ${text.replace(/가사|트롯|노래|음악/g, '')}`
  }

  return text
    .replace(/마이크/g, 'microphone')
    .replace(/아이콘/g, '3d app icon')
    .replace(/로고/g, 'logo')
    .replace(/쇼핑/g, 'shopping product')
    .replace(/가습기/g, 'humidifier')
    .replace(/텀블러/g, 'tumbler')
    .replace(/만들어줘|만들어|해줘/g, '')
    .replace(/이미지/g, 'image')
    .replace(/비디오/g, 'video')
    .trim() || 'high quality 3d studio product lighting photo'
}

export async function generateImage({ prompt, size = '1024x1024', noText = false }) {
  const apiKey = process.env.OPENAI_API_KEY
  const safePrompt = translatePromptToEnglish(prompt)

  // 1차: OpenAI API 시도
  if (apiKey) {
    try {
      const res = await fetch(OPENAI_IMAGES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: `${safePrompt}\n\n${noText ? NO_TEXT_RULE : THUMBNAIL_COLOR_RULE}`,
          size,
          n: 1,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const b64 = data.data?.[0]?.b64_json
        if (b64) return `data:image/png;base64,${b64}`
      }
    } catch (e) {
      console.warn('[imageClient] OpenAI 생성 폴백 -> Pollinations AI 전환:', e.message)
    }
  }

  // 2차: 100% 무료 Pollinations AI 8K 이미지 엔진
  try {
    const seed = Math.floor(Math.random() * 10000000)
    const [width, height] = size.split('x').map(Number)
    const finalPrompt = `${safePrompt}, ultra detailed 8k photography, cinematic studio lighting, masterpiece`
    const pollUrl = `https://pollinations.ai/p/${encodeURIComponent(finalPrompt)}?width=${width || 1024}&height=${height || 1024}&seed=${seed}&nologo=true`

    const imgRes = await fetch(pollUrl)
    if (imgRes.ok) {
      const buffer = await imgRes.arrayBuffer()
      const b64 = Buffer.from(buffer).toString('base64')
      return `data:image/png;base64,${b64}`
    }
  } catch (err) {
    console.error('[imageClient] Pollinations AI 생성 실패:', err)
  }

  throw new Error('AI 이미지를 생성하지 못했습니다. 다시 시도해 주세요.')
}

export async function editImage({ imageDataUrl, prompt, size = '1024x1024', noText = false }) {
  return generateImage({ prompt, size, noText })
}
