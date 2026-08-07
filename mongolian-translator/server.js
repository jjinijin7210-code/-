// ============================================================
// 실시간 통역기 - 진희님 동생이 매장에서 몽골인 동료·외국인 손님과 소통할 때 쓰는 독립 앱.
// Luna One(콘텐츠 제작 도구)과 완전히 분리된 별도 서비스 - "번역앱만 따로는 없고?" 요청으로
// luna-one/public/translator.html에 있던 프로토타입을 그대로 떼어내 독립 앱으로 옮김.
// 음성 인식(STT)·음성 출력(TTS)은 브라우저 내장 Web Speech API를 써서 비용이 없고, 여기 서버는
// 텍스트 번역 한 번만 Claude API로 처리한다.
// ============================================================

import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 로컬 실행용 .env 로더 (luna-one/server.js와 동일한 간단한 방식) - Render에서는 대시보드
// 환경변수가 이미 process.env에 있으니 이 파일이 없어도 그냥 지나감.
function loadEnv() {
  const file = path.join(__dirname, '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx < 1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnv()

const app = express()
const PORT = Number(process.env.PORT || 4175)

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

async function callClaude({ system, messages, maxTokens = 300 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: DEFAULT_MODEL, max_tokens: maxTokens, system, messages }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Claude API 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }
  const data = await res.json()
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
}

const TRANSLATE_LANG_NAMES = { mn: '몽골어', en: '영어', zh: '중국어', ja: '일본어', ko: '한국어' }

app.post('/api/translate', async (req, res) => {
  try {
    const { text, targetLang } = req.body || {}
    if (!text || !text.trim()) throw new Error('번역할 문장이 없어요.')
    const targetName = TRANSLATE_LANG_NAMES[targetLang]
    if (!targetName) throw new Error('지원하지 않는 언어예요.')
    const translated = await callClaude({
      // 2026-08-08 실측 발견 1: "매장에서 대화할 때 쓰는 통역가입니다"처럼 역할극 프롬프트를
      // 쓰면, "고마워" 같은 짧은 문장을 번역 대신 "천만에요"처럼 대화에 반응하는 답으로
      // 만들어버림 - 대화 참여자가 아니라 "번역 기계"라고 명시해서 고침.
      // 2026-08-08 실측 발견 2: 위 수정에 "예를 들어 입력이 '고마워'면..." 식으로 구체적인
      // 예시 문장을 넣었더니, 그 예시 자체에 낚여서 전혀 관련 없는 입력("안녕하세요" 등)까지
      // 그 예시와 비슷한 번역("谢谢"/thank you)으로 새어나가는 문제를 재현 테스트로 확인함
      // (5번 반복 재현, 100% 재현율). 예시 문장을 완전히 빼고 일반 원칙만 남기니 해결됨 -
      // 이 프롬프트에 특정 단어 예시를 다시 추가하고 싶어지면, 반드시 무관한 입력으로도
      // 재현 테스트를 해볼 것.
      system: `당신은 대화에 참여하는 사람이 아니라, 입력된 문장을 그대로 ${targetName}로 옮기는
번역 기계입니다. 절대로 입력 문장에 반응하거나 대답하지 마세요 - 오직 입력 문장 자체의 글자 그대로의
뜻만 ${targetName}로 정확히 옮기세요. 짧고 자연스러운 구어체로, 번역문 한 문장만 출력하세요 - 설명이나
따옴표, 원문 반복 없이.`,
      messages: [{ role: 'user', content: text.trim() }],
      maxTokens: 300,
    })
    res.json({ translated })
  } catch (error) {
    res.status(400).json({ error: `번역 실패: ${error.message}` })
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(process.env.ANTHROPIC_API_KEY) })
})

app.listen(PORT, () => {
  console.log(`실시간 통역기 실행: http://localhost:${PORT}`)
})
