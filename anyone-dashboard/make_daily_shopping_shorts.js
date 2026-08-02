import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })

import { buildDraftMessages, parseDraftResponse } from './server/lib/promptBuilder.js'
import { callClaudeJson } from './server/lib/anthropicClient.js'
import { sendTelegramNotification } from './server/lib/telegramNotifier.js'

async function runDailyShoppingShorts() {
  console.log('🚀 [쇼핑 숏폼] 쿠팡 베스트셀러 매일 1개 자동 생성 시작...')

  const popularProducts = [
    { title: '스마트 무선 초음파 저소음 미니 가습기', link: 'https://link.inpock.co.kr/jena10' },
    { title: '원터치 먼지 자발적 흡입 스마트 청소기', link: 'https://link.inpock.co.kr/jena10' },
    { title: '350ml 보온보냉 디지털 온도표시 텀블러', link: 'https://link.inpock.co.kr/jena10' },
    { title: '초경량 접이식 자취생 멀티 멀티포트', link: 'https://link.inpock.co.kr/jena10' },
    { title: '스마트 인체감지 무선 LED 센서등', link: 'https://link.inpock.co.kr/jena10' }
  ]

  const topProduct = popularProducts[Math.floor(Math.random() * popularProducts.length)]

  try {
    const { system, messages } = buildDraftMessages({
      channel: '인스타/틱톡',
      topic: `${topProduct.title} (쇼핑 숏폼 구매수 1위 쿠팡 베스트셀러 추천)`
    })

    const draft = await callClaudeJson({ system, messages, maxTokens: 1024, parse: parseDraftResponse })

    const inpockLink = 'https://link.inpock.co.kr/jena10'

    let msg = `<b>🛒 [애니원] 오늘 하루 1개 쇼핑 숏폼 자동 완성!</b>\n\n`
    msg += `📌 <b>추천 상품:</b> ${topProduct.title}\n`
    msg += `📝 <b>대본/헤드라인:</b> ${draft.title || topProduct.title}\n`
    msg += `🔗 <b>인포크링크(인링크) 등록용 주소:</b> ${inpockLink}\n\n`
    msg += `👉 인포크링크(${inpockLink})에 상품 등록 후 제작된 영상만 올리시면 끝!`

    await sendTelegramNotification(msg).catch(() => {})
    console.log('SUCCESS! DAILY SHOPPING SHORTS COMPLETED!')
  } catch (e) {
    console.error('쇼핑 숏폼 생성 예외:', e)
  }
}

runDailyShoppingShorts()
