import express from 'express'
import multer from 'multer'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { createWorker } from 'tesseract.js'
import { YoutubeTranscript } from 'youtube-transcript'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// preview_start 등 외부에서 다른 작업 디렉터리로 실행될 수 있어서, cwd에 의존하는 상대경로
// 대신 이 파일 위치(__dirname) 기준 절대경로를 씀 (video-maker/server.js와 동일한 패턴)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

loadEnv()

import { generatePiece, LANGUAGE_NAMES, PLATFORM_NAMES } from './server/lib/promptBuilder.js'
import { generateImage } from './server/lib/imageClient.js'
import { getPage, clickFirstVisible, saveErrorScreenshot, dataUrlToFile } from './server/lib/localBrowser.js'

const app = express()
const PORT = Number(process.env.PORT || 4174)
const uploadsDir = path.join(__dirname, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
})

// 카드뉴스용 사진(최대 4장, base64)이 /api/generate 요청 본문에 같이 실려오므로 넉넉하게 잡음
app.use(express.json({ limit: '20mb' }))
app.use(express.static(path.join(__dirname, 'public')))

// ------------------------------------------------------------
// 원본 소재 추출 - Luna One 시제품의 검증된 로직 그대로 재사용 (AI 비용 없음)
// ------------------------------------------------------------

app.post('/api/extract/url', async (req, res) => {
  try {
    const url = validateHttpUrl(req.body.url)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 LunaOne/1.0',
        'Accept-Language': 'ko,en;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`페이지를 불러오지 못했습니다. (${response.status})`)
    const html = await response.text()
    const dom = new JSDOM(html, { url })
    const article = new Readability(dom.window.document).parse()
    const text = cleanText(article?.textContent || dom.window.document.body?.textContent || '')
    if (text.length < 80) throw new Error('본문을 충분히 읽지 못했습니다. 복사해서 넣기를 이용해 주세요.')
    res.json({
      title: article?.title || dom.window.document.title || '제목 없음',
      text: text.slice(0, 30000),
      sourceUrl: url,
      sourceType: 'url',
    })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post('/api/extract/youtube', async (req, res) => {
  try {
    const url = validateHttpUrl(req.body.url)
    if (!/youtu\.?be|youtube\.com/i.test(url)) throw new Error('유튜브 주소를 확인해 주세요.')
    const items = await YoutubeTranscript.fetchTranscript(url)
    const text = cleanText(items.map((item) => item.text).join(' '))
    if (!text) throw new Error('자막을 찾지 못했습니다. 자막이 공개된 영상인지 확인해 주세요.')
    res.json({
      title: 'YouTube transcript',
      text: text.slice(0, 30000),
      sourceUrl: url,
      sourceType: 'youtube',
    })
  } catch (error) {
    res.status(400).json({
      error: `유튜브 자막 추출 실패: ${error.message} 공개 자막이 없으면 대본을 복사해서 넣어 주세요.`,
    })
  }
})

app.post('/api/extract/ocr', upload.single('image'), async (req, res) => {
  let worker
  try {
    if (!req.file) throw new Error('이미지 파일을 선택해 주세요.')
    worker = await createWorker(['kor', 'eng', 'jpn', 'chi_sim', 'spa'])
    const result = await worker.recognize(req.file.path)
    const text = cleanText(result.data.text)
    if (text.length < 10) throw new Error('글자를 충분히 읽지 못했습니다. 더 선명한 이미지를 사용해 주세요.')
    res.json({
      title: req.file.originalname,
      text: text.slice(0, 30000),
      sourceType: 'screenshot',
    })
  } catch (error) {
    res.status(400).json({ error: `OCR 실패: ${error.message}` })
  } finally {
    if (worker) await worker.terminate().catch(() => {})
    if (req.file?.path) fs.unlink(req.file.path, () => {})
  }
})

// ------------------------------------------------------------
// 콘텐츠 생성 - 플랫폼 x 언어 조합마다 따로 호출 (promptBuilder.js 참고)
// ------------------------------------------------------------

app.post('/api/generate', async (req, res) => {
  try {
    const {
      source,
      languages,
      platforms,
      cardCount = 7,
      tone = '친근하고 신뢰감 있게',
      experienceMode = 'balanced',
      experienceText = '',
      smartEnhance = {},
      photos = [],
    } = req.body

    if (!source?.text || source.text.trim().length < 30) throw new Error('분석할 내용을 먼저 넣어 주세요.')
    if (!Array.isArray(languages) || !languages.length) throw new Error('언어를 하나 이상 선택해 주세요.')
    if (!Array.isArray(platforms) || !platforms.length) throw new Error('플랫폼을 하나 이상 선택해 주세요.')

    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY)
    const outputs = {}
    const summary = {
      topic: source.title || '오늘의 핵심 이야기',
      keyFacts: [],
      cautions: hasKey ? [] : ['ANTHROPIC_API_KEY가 설정되어 있지 않아 데모 문구로 대체했어요. .env에 키를 넣으면 실제 생성됩니다.'],
      recommendedPlatform: platforms[0],
    }

    const jobs = []
    for (const language of languages) {
      outputs[language] = {}
      for (const platform of platforms) {
        jobs.push(
          (hasKey ? generatePiece({ source, platform, language, cardCount, tone, experienceMode, experienceText, smartEnhance, photos }) : demoPiece({ source, platform, language, cardCount, photos }))
            .then((piece) => {
              outputs[language][platform] = piece
            })
            .catch((err) => {
              outputs[language][platform] = { title: '', content: '', error: err.message }
            })
        )
      }
    }
    await Promise.all(jobs)

    res.json({ provider: hasKey ? 'claude' : 'demo', result: { summary, outputs } })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// 카드 사진/아이콘 자동 배정으로 충분하지 않을 때만 쓰는 수동 AI 이미지 생성 (직접 눌러야 호출됨)
app.post('/api/generate/card-image', async (req, res) => {
  try {
    const { headline, body, visualHint } = req.body
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY가 서버 .env에 설정되어 있지 않아요.')
    const prompt = `카드뉴스용 정사각형 배경 이미지. 글자는 넣지 마세요(글자는 따로 얹습니다). 주제: ${visualHint || headline || body || '심플한 배경'}. 밝고 깔끔한 느낌.`
    const dataUrl = await generateImage({ prompt, size: '1024x1024' })
    res.json({ dataUrl })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// ------------------------------------------------------------
// 네이버 블로그 자동 채우기 - anyone-dashboard의 검증된 패턴 그대로 재사용.
// 로그인과 마지막 "발행" 버튼은 항상 사람이 직접 함 (로컬 실행 전용, Render 등 서버에선 동작 안 함).
// ------------------------------------------------------------

app.post('/api/naverblog/open-login', async (req, res) => {
  try {
    const page = await getPage('naverblog')
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' })
    res.json({ ok: true, message: '네이버 로그인 창을 열었어요. 처음 한 번만 직접 로그인해주세요.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/naverblog/prepare', async (req, res) => {
  const { title, body, images } = req.body || {}
  if (!title?.trim()) return res.status(400).json({ error: '제목이 비어 있어요.' })
  if (!body?.trim()) return res.status(400).json({ error: '본문이 비어 있어요.' })

  const imageFiles = []
  let page
  try {
    for (const dataUrl of images || []) {
      imageFiles.push(dataUrlToFile(dataUrl, 'naverblog'))
    }

    page = await getPage('naverblog')
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' })

    const loginInput = page.locator('#id')
    if (await loginInput.isVisible().catch(() => false)) {
      return res.status(409).json({
        error: '네이버 로그인이 필요해요. 열린 창에서 로그인한 뒤 다시 눌러주세요.',
        loginRequired: true,
      })
    }

    await page.waitForTimeout(1000)
    await clickFirstVisible(page, [
      page.getByRole('button', { name: /취소/ }),
      page.getByText(/취소/),
    ])

    const frame = page.frameLocator('#mainFrame')
    const titleBox = frame.locator('.se-title-text, [class*="title"][contenteditable="true"]').first()
    await titleBox.waitFor({ state: 'visible', timeout: 15000 })
    await titleBox.click()
    await page.keyboard.type(title.trim())

    await page.keyboard.press('Enter')
    const bodyBox = frame.locator('.se-text-paragraph, .se-component-content [contenteditable="true"]').first()
    await bodyBox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    await page.keyboard.type(body.trim())

    let imagesInserted = 0
    if (imageFiles.length > 0) {
      await page.keyboard.press('Enter')
      const photoButtonClicked = await clickFirstVisible(page, [
        frame.locator('button[data-name="image"]'),
        frame.locator('.se-image-toolbar-button'),
        frame.getByRole('button', { name: /^사진$/ }),
      ])
      if (photoButtonClicked) {
        for (const filePath of imageFiles) {
          try {
            const fileInput = frame.locator('input[type="file"]').first()
            await fileInput.waitFor({ state: 'attached', timeout: 8000 })
            await fileInput.setInputFiles(filePath)
            await page.waitForTimeout(2000)
            imagesInserted += 1
          } catch {
            break
          }
        }
      }
    }

    const imageNote =
      imageFiles.length === 0
        ? ''
        : imagesInserted === imageFiles.length
          ? ` 첨부한 이미지 ${imagesInserted}장도 넣었어요.`
          : ` 이미지는 ${imagesInserted}/${imageFiles.length}장만 자동으로 들어갔어요 - 나머지는 직접 첨부해주세요.`

    res.json({
      ok: true,
      readyToPublish: true,
      message: `제목과 본문을 채웠어요.${imageNote} 내용 확인 후 열린 창에서 발행 버튼만 눌러주세요.`,
    })
  } catch (err) {
    const screenshotPath = await saveErrorScreenshot(page)
    res.status(500).json({
      error: screenshotPath
        ? `${err.message} (실패 순간 화면이 여기 저장됐어요: ${screenshotPath})`
        : err.message,
    })
  } finally {
    for (const filePath of imageFiles) {
      fs.promises.unlink(filePath).catch(() => {})
    }
  }
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: process.env.ANTHROPIC_API_KEY ? 'claude' : 'demo',
    imageProvider: process.env.OPENAI_API_KEY ? 'openai' : null,
    localAutomation: process.env.ENABLE_LOCAL_BROWSER_AUTOMATION === 'true',
    version: '1.0.0',
  })
})

app.listen(PORT, () => {
  console.log(`\nLuna One 실행: http://localhost:${PORT}`)
  console.log(`text provider: ${process.env.ANTHROPIC_API_KEY ? 'claude' : 'demo'}\n`)
})

// ------------------------------------------------------------
// 유틸
// ------------------------------------------------------------

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

function validateHttpUrl(raw) {
  const url = new URL(String(raw || '').trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('http 또는 https 주소만 사용할 수 있습니다.')
  return url.toString()
}

function cleanText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
}

const DEMO_ICON_CYCLE = ['map', 'clock', 'ticket', 'car', 'star', 'question']

// ANTHROPIC_API_KEY 없이 화면부터 확인해볼 수 있도록 하는 데모 출력 (Luna One 시제품 방식과 동일).
// 실제 모드와 같은 사진 재사용/아이콘 규칙을 데모에서도 보여주기 위해 간단한 규칙으로 흉내냄.
async function demoPiece({ source, platform, language, cardCount, photos = [] }) {
  const title = source.title || '오늘의 핵심 이야기'
  const snippets = source.text.split(/[.!?。！？]\s*/).filter((s) => s.length > 15).slice(0, Math.max(cardCount, 7))
  const langLabel = LANGUAGE_NAMES[language] || language
  if (platform === 'cards') {
    const hasPhotos = Array.isArray(photos) && photos.length > 0
    return {
      title,
      cards: Array.from({ length: Number(cardCount) }, (_, i) => {
        const isFirst = i === 0
        const isLast = i === Number(cardCount) - 1
        const visual = hasPhotos
          ? { type: 'photo', photoIndex: 0, treatment: isFirst ? 'normal' : isLast ? 'dark' : i % 2 === 0 ? 'zoom' : 'zoom-blur' }
          : { type: 'icon', icon: DEMO_ICON_CYCLE[i % DEMO_ICON_CYCLE.length] }
        return {
          page: i + 1,
          headline: isFirst ? title : `POINT ${i}`,
          body: isFirst ? `(${langLabel} 데모) 핵심 내용을 한눈에 정리했습니다.` : snippets[i - 1] || snippets[0] || source.text.slice(0, 100),
          visual,
        }
      }),
    }
  }
  return {
    title,
    content: `(${langLabel} 데모 · ${PLATFORM_NAMES[platform] || platform})\n\n${title}\n\n${snippets.slice(0, 4).join('\n\n')}\n\n#LunaOne`,
  }
}
