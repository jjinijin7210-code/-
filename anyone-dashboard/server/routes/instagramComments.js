// ============================================================
// 인스타그램 댓글 자동 응답 (CS 자동 응답) - 진희님 컴퓨터에서만 동작
// 1) 스캔: 최근 게시물들의 댓글을 훑어서 CS 링크 관리에 등록된 트리거 키워드가
//    포함된 댓글을 찾아낸다 (읽기 전용, 아무것도 쓰지 않음).
// 2) 답글: 화면에서 진희님이 확인 후 "답글 보내기"를 누른 댓글 하나에만 실제로
//    답글을 남기고, 중복 방지를 위해 cs_reply_log에 기록한다.
// 안전을 위해 스캔은 완전 자동, 실제 답글 전송은 항목별로 사람이 눌러야 나가도록
// 만들었다 (인스타그램 자동 사진·글 입력 기능의 "마지막 공유는 사람이" 원칙과 동일).
// ============================================================

import { Router } from 'express'
import { getPage, saveErrorScreenshot } from '../lib/localBrowser.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'

const router = Router()

const INSTAGRAM_HANDLE = process.env.INSTAGRAM_HANDLE || 'anyone.living'
const MAX_POSTS_TO_SCAN = 5
const MAX_COMMENTS_PER_POST = 30

function requireTargetUserId() {
  const userId = process.env.AUTO_TARGET_USER_ID
  if (!userId) throw new Error('.env에 AUTO_TARGET_USER_ID가 설정되어 있지 않아요.')
  return userId
}

async function getActiveKeywords(supabase, userId) {
  const { data, error } = await supabase
    .from('cs_links')
    .select('trigger_keyword, target_url')
    .eq('user_id', userId)
    .eq('active', true)
  if (error) throw new Error(`CS 링크 목록을 불러오지 못했어요: ${error.message}`)
  return data || []
}

async function getAlreadyRepliedSet(supabase, userId) {
  const { data, error } = await supabase.from('cs_reply_log').select('post_url, commenter_username').eq('user_id', userId)
  if (error) throw new Error(`답글 기록을 불러오지 못했어요: ${error.message}`)
  return new Set((data || []).map((r) => `${r.post_url}::${r.commenter_username}`))
}

async function collectRecentPostUrls(page) {
  await page.goto(`https://www.instagram.com/${INSTAGRAM_HANDLE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const hrefs = await page
    .locator('a[href*="/p/"], a[href*="/reel/"]')
    .evaluateAll((els) => Array.from(new Set(els.map((el) => el.getAttribute('href')).filter(Boolean))))
  return hrefs.slice(0, MAX_POSTS_TO_SCAN).map((href) => new URL(href, 'https://www.instagram.com').toString())
}

// 댓글 목록(li) 하나하나에서 "작성자 / 본문"을 최대한 폭넓게 뽑아낸다.
// (인스타그램 화면 구성이 자주 바뀌므로 정확한 클래스명 대신 구조적 위치로 추정)
async function collectComments(page) {
  const items = await page.locator('main ul li').all()
  const comments = []
  for (const item of items.slice(0, MAX_COMMENTS_PER_POST)) {
    const username = await item.locator('a').first().textContent().catch(() => null)
    const fullText = await item.textContent().catch(() => '')
    if (!username?.trim() || !fullText) continue
    const commentText = fullText.replace(username, '').trim()
    if (!commentText) continue
    comments.push({ username: username.trim(), commentText })
  }
  return comments
}

router.post('/instagram/scan-comments', async (req, res) => {
  let page
  try {
    const userId = requireTargetUserId()
    const supabase = getSupabaseAdmin()
    const [keywords, alreadyReplied] = await Promise.all([
      getActiveKeywords(supabase, userId),
      getAlreadyRepliedSet(supabase, userId),
    ])
    if (keywords.length === 0) {
      return res.json({
        ok: true,
        matches: [],
        message: '활성화된 CS 트리거 키워드가 없어요. "CS 링크 관리"에서 먼저 등록해주세요.',
      })
    }

    page = await getPage('instagram')
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
    const loginInput = page.locator('input[name="username"]')
    if (await loginInput.isVisible().catch(() => false)) {
      return res.status(409).json({ error: '인스타그램 로그인이 필요해요.', loginRequired: true })
    }

    const postUrls = await collectRecentPostUrls(page)
    const matches = []

    for (const postUrl of postUrls) {
      await page.goto(postUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1000)
      const comments = await collectComments(page)

      for (const { username, commentText } of comments) {
        if (alreadyReplied.has(`${postUrl}::${username}`)) continue
        const matchedKeyword = keywords.find((k) => commentText.includes(k.trigger_keyword))
        if (!matchedKeyword) continue
        matches.push({
          postUrl,
          commenterUsername: username,
          commentText,
          matchedKeyword: matchedKeyword.trigger_keyword,
          targetUrl: matchedKeyword.target_url,
        })
      }
    }

    res.json({ ok: true, matches, scannedPosts: postUrls.length })
  } catch (err) {
    const screenshotPath = await saveErrorScreenshot(page)
    res.status(500).json({
      error: screenshotPath ? `${err.message} (실패 순간 화면이 여기 저장됐어요: ${screenshotPath})` : err.message,
    })
  }
})

router.post('/instagram/reply-comment', async (req, res) => {
  const { postUrl, commenterUsername, commentText, matchedKeyword, targetUrl } = req.body || {}
  if (!postUrl || !commenterUsername || !targetUrl) {
    return res.status(400).json({ error: '답글에 필요한 정보가 부족해요.' })
  }

  let page
  try {
    const userId = requireTargetUserId()
    const supabase = getSupabaseAdmin()

    page = await getPage('instagram')
    await page.goto(postUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    const items = await page.locator('main ul li').all()
    let targetItem = null
    for (const item of items) {
      const fullText = await item.textContent().catch(() => '')
      if (fullText.includes(commenterUsername) && (!commentText || fullText.includes(commentText.slice(0, 15)))) {
        targetItem = item
        break
      }
    }
    if (!targetItem) throw new Error('해당 댓글을 화면에서 다시 찾지 못했어요. 그 사이에 화면이 바뀌었을 수 있어요.')

    const replyClicked = await targetItem
      .getByText(/^답글 달기$|^reply$/i)
      .first()
      .click({ force: true })
      .then(() => true)
      .catch(() => false)
    if (!replyClicked) throw new Error('"답글 달기" 버튼을 찾지 못했어요. 화면 구성이 바뀌었을 수 있어요.')

    await page.waitForTimeout(500)
    const replyBox = page.locator('form textarea, form [contenteditable="true"]').last()
    await replyBox.waitFor({ state: 'visible', timeout: 8000 })
    const replyMessage = `안녕하세요~ 요청하신 링크 보내드려요! 👉 ${targetUrl}`
    await replyBox.fill(replyMessage)

    const posted = await page
      .getByRole('button', { name: /^게시$|^post$/i })
      .first()
      .click({ force: true })
      .then(() => true)
      .catch(() => false)
    if (!posted) throw new Error('"게시" 버튼을 찾지 못했어요. 입력창엔 답글이 채워져 있으니, 직접 게시 버튼을 눌러주세요.')

    const { error: insertError } = await supabase.from('cs_reply_log').insert({
      user_id: userId,
      post_url: postUrl,
      commenter_username: commenterUsername,
      comment_text: commentText,
      matched_keyword: matchedKeyword,
      target_url: targetUrl,
    })
    if (insertError) throw new Error(`답글은 보냈지만 기록 저장에 실패했어요: ${insertError.message}`)

    res.json({ ok: true, message: `${commenterUsername}님께 답글을 보냈어요!` })
  } catch (err) {
    const screenshotPath = await saveErrorScreenshot(page)
    res.status(500).json({
      error: screenshotPath ? `${err.message} (실패 순간 화면이 여기 저장됐어요: ${screenshotPath})` : err.message,
    })
  }
})

export default router
