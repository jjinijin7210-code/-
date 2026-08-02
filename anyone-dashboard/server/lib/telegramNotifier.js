// ============================================================
// 텔레그램 알림봇 - AI 직원팀이 초안/쇼츠 영상을 완성할 때마다
// 사용자 텔레그램으로 즉시 요약 메시지 및 링크 발송
// ============================================================

export async function sendTelegramNotification(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정')
    return false
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    })
    const data = await res.json()
    return data.ok
  } catch (err) {
    console.error('[Telegram] 발송 실패:', err.message)
    return false
  }
}
