// ============================================================
// 텔레그램 봇으로 자동 파이프라인 결과를 진희님께 바로 보고하는 알림.
// TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID가 .env에 없으면 그냥 조용히 아무것도 안 함
// (알림은 있으면 좋은 기능이지, 이것 때문에 자동 파이프라인 자체가 실패하면 안 되니까).
// ============================================================

export async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return { skipped: true }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[telegram] 전송 실패:', res.status, errText.slice(0, 300))
      return { ok: false }
    }
    return { ok: true }
  } catch (e) {
    // 알림 전송 실패가 파이프라인 자체를 멈추게 하면 안 되므로 에러를 던지지 않고 로그만 남김
    console.error('[telegram] 전송 중 오류:', e.message)
    return { ok: false }
  }
}
