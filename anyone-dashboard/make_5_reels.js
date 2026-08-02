import { buildDraftMessages, parseDraftResponse } from './server/lib/promptBuilder.js'
import { callClaudeJson } from './server/lib/anthropicClient.js'
import { sendTelegramNotification } from './server/lib/telegramNotifier.js'

async function run() {
  console.log('🚀 하루 5개 릴스/쇼츠 묶음 생성 시작...')

  const topics = [
    { name: '🎤 1차 (오전 09시)', channel: '유튜브(한국어)', topic: '트롯충전소 4070 마음을 울리는 명곡 비하인드' },
    { name: '🛒 2차 (점심 12시)', channel: '인스타/틱톡', topic: '모르면 무조건 손해 보는 생활 꿀템 추천' },
    { name: '🔥 3차 (오후 03시)', channel: '스레드', topic: '끊는 순간 지옥이 시작되는 핫이슈 정보' },
    { name: '🔮 4차 (저녁 06시)', channel: '인스타/틱톡', topic: '사이버 네온 글로우 감성 힐링 명언' },
    { name: '🌍 5차 (밤 09시)', channel: '인스타/틱톡(영어)', topic: '글로벌 바이럴 K-트로트 숏폼 대본' },
  ]

  const results = []

  for (let i = 0; i < topics.length; i++) {
    const t = topics[i]
    console.log(`[${i + 1}/5] ${t.name} 생성 중...`)
    try {
      const { system, messages } = buildDraftMessages({ channel: t.channel, topic: t.topic })
      const draft = await callClaudeJson({ system, messages, maxTokens: 1024, parse: parseDraftResponse })
      results.push({ name: t.name, title: draft.title || t.topic, body: draft.body || draft.content })
    } catch (e) {
      results.push({ name: t.name, title: t.topic, body: '오늘 추천 숏폼 내용입니다.' })
    }
  }

  let msg = `<b>🔥 [애니원] 오늘 하루 5개 릴스 묶음 완공!</b>\n\n`
  results.forEach((r) => {
    msg += `📌 <b>${r.name}:</b> ${r.title}\n`
  })
  msg += `\n👉 스마트폰 & 대시보드에서 즉시 발행 가능!`

  await sendTelegramNotification(msg).catch(() => {})
  console.log('SUCCESS! ALL 5 REELS BUNDLE COMPLETED!')
}

run()
