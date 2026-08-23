import express from 'express'
import multer from 'multer'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { createWorker } from 'tesseract.js'
import { YoutubeTranscript } from 'youtube-transcript'
import { PDFParse } from 'pdf-parse'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { installWhisperCpp, downloadWhisperModel, transcribe } from '@remotion/install-whisper-cpp'

// preview_start 등 외부에서 다른 작업 디렉터리로 실행될 수 있어서, cwd에 의존하는 상대경로
// 대신 이 파일 위치(__dirname) 기준 절대경로를 씀 (video-maker/server.js와 동일한 패턴)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

loadEnv()

import { generatePiece, LANGUAGE_NAMES, PLATFORM_NAMES } from './server/lib/promptBuilder.js'
import { generateImage } from './server/lib/imageClient.js'
import { getPage } from './server/lib/localBrowser.js'
import { searchPhotos, fetchPhotoAsDataUrl } from './server/lib/pexelsClient.js'
import { callClaude } from './server/lib/anthropicClient.js'
import { renderCardsToImages, CARD_TEMPLATES } from './server/lib/cardImageRenderer.js'
import { compareSearchTrend } from './server/lib/naverDatalabClient.js'
import { renderPageHtml } from './server/lib/renderPage.js'
import { removeWatermark } from './server/lib/watermarkRemover.js'
import { generateStoryChapter, STORY_GENRES, STORY_TONES, STORY_LENGTH_MINUTES } from './server/lib/storyBuilder.js'
import { generateLyrics, SONG_LENGTHS } from './server/lib/lyricsBuilder.js'

const app = express()
const PORT = Number(process.env.PORT || 4174)
const uploadsDir = path.join(__dirname, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
})
// 캡컷 등으로 직접 만든 영상(나레이션 포함)을 원본 소재로 올릴 수 있게 - 사진(12MB)보다
// 영상 용량이 훨씬 커서 별도 multer 인스턴스로 넉넉하게(2GB) 잡음.
const uploadVideo = multer({
  dest: uploadsDir,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('video/')),
})
// 전자책(PDF)을 원본 소재로 올릴 수 있게 - 카드뉴스 등으로 전자책을 홍보할 때 사용
const uploadPdf = multer({
  dest: uploadsDir,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
})

// anyone-dashboard/server/lib/videoRenderer.js의 ffmpegBin()과 같은 이유로 매번 process.env를 읽음
function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}
function ffprobeBin() {
  return process.env.FFPROBE_PATH || 'ffprobe'
}
// whisper.cpp + 모델은 한 번만 받아서 재사용 (레포 안 고정 경로, .gitignore에 등록)
const WHISPER_DIR = path.join(__dirname, 'whisper-cpp')
const WHISPER_VERSION = '1.5.5'
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'small'

// 카드뉴스용 사진(최대 4장, base64)이 /api/generate 요청 본문에 같이 실려오므로 넉넉하게 잡음
app.use(express.json({ limit: '20mb' }))
app.use(express.static(path.join(__dirname, 'public')))

// ------------------------------------------------------------
// 2026-08-03 요청: "제부 친구한테 데모로 보여주자" - Render에 배포해서 링크로 공유할 데모
// 버전용 보호 장치. DEMO_ACCESS_CODE가 설정된 배포(Render)에서만 작동하고, 로컬에서
// 진희가 직접 쓸 때(env 변수 없음)는 전혀 영향 없음.
// ------------------------------------------------------------
const DEMO_ACCESS_CODE = process.env.DEMO_ACCESS_CODE || null
const DEMO_DAILY_LIMIT = Number(process.env.DEMO_DAILY_LIMIT) || 30
let demoUsageDate = null
let demoUsageCount = 0

function requireAccessCode(req, res, next) {
  if (!DEMO_ACCESS_CODE) return next() // 로컬 실행이면 코드 없이 통과
  if (req.headers['x-access-code'] === DEMO_ACCESS_CODE) return next()
  res.status(401).json({ error: '접근 코드가 필요합니다.' })
}

function demoDailyLimiter(req, res, next) {
  if (!DEMO_ACCESS_CODE) return next() // 데모 배포가 아니면(로컬) 제한 없음
  const today = new Date().toISOString().slice(0, 10)
  if (demoUsageDate !== today) {
    demoUsageDate = today
    demoUsageCount = 0
  }
  if (demoUsageCount >= DEMO_DAILY_LIMIT) {
    return res.status(429).json({ error: `데모 버전은 하루 ${DEMO_DAILY_LIMIT}회까지만 사용할 수 있어요. 내일 다시 시도해주세요.` })
  }
  demoUsageCount += 1
  next()
}

app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next() // 헬스체크는 접근 코드 없이도 확인 가능해야 함
  return requireAccessCode(req, res, next)
})

// 2026-08-01 요청: "노트북LM 워터마크 지우기" - 이 도구가 만든 영상 결과물을 다운로드용으로
// 잠깐 담아두는 폴더 (anyone-dashboard의 GENERATED_DIR과 동일한 패턴, .gitignore에 등록됨).
const GENERATED_DIR = path.join(__dirname, 'generated')
fs.mkdirSync(GENERATED_DIR, { recursive: true })
app.use('/generated', express.static(GENERATED_DIR))

// ------------------------------------------------------------
// 원본 소재 추출 - Luna One 시제품의 검증된 로직 그대로 재사용 (AI 비용 없음)
// ------------------------------------------------------------

// 쇼핑몰 상품 페이지는 검색엔진용으로 <script type="application/ld+json"> 안에 Product
// schema.org 구조화 데이터(이름/설명/평점/실제 후기)를 거의 항상 심어둔다 - JS 실행 없이도
// 원본 HTML에 그대로 들어있고, Readability(기사용 휴리스틱이라 상품 페이지에서는 약관/푸터
// 같은 엉뚱한 블록을 "본문"으로 잘못 고르는 문제가 있음, 2026-07-29 토스쇼핑 실측 확인)보다
// 훨씬 정확하고 실제 후기까지 얻을 수 있어 최우선으로 시도한다.
function extractProductJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const [, raw] of blocks) {
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      continue
    }
    const candidates = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data]
    const product = candidates.find((d) => d && (d['@type'] === 'Product' || (Array.isArray(d['@type']) && d['@type'].includes('Product'))))
    if (!product?.name) continue

    const lines = [product.name]
    if (product.description) lines.push(product.description)
    if (product.aggregateRating) {
      lines.push(`평점 ${product.aggregateRating.ratingValue} (리뷰 ${product.aggregateRating.reviewCount}개)`)
    }
    const reviews = (Array.isArray(product.review) ? product.review : [product.review]).filter((r) => r?.reviewBody)
    if (reviews.length) {
      lines.push('[실제 구매 후기 일부]')
      reviews.slice(0, 5).forEach((r) => lines.push(`- ${r.reviewBody}`))
    }
    const text = cleanText(lines.join('\n'))
    if (text.length < 20) continue
    return { title: product.name, text: text.slice(0, 30000) }
  }
  return null
}

// html 문자열을 Readability로 파싱해서 {title, text}를 돌려줌. 본문이 80자 미만이면 null
// (SPA라 빈 껍데기만 온 경우 - 호출하는 쪽에서 headless 렌더링 폴백을 시도하게 함)
function parseArticleHtml(html, url) {
  const dom = new JSDOM(html, { url })
  const article = new Readability(dom.window.document).parse()
  const text = cleanText(article?.textContent || dom.window.document.body?.textContent || '')
  if (text.length < 80) return null
  return { title: article?.title || dom.window.document.title || '제목 없음', text: text.slice(0, 30000) }
}

// 상품 JSON-LD 우선, 없으면 Readability로 기사 본문 추출을 시도
function parseHtml(html, url) {
  return extractProductJsonLd(html) || parseArticleHtml(html, url)
}

app.post('/api/extract/url', async (req, res) => {
  try {
    const url = validateHttpUrl(req.body.url)
    let parsed = null

    // 1차: 빠른 순수 fetch (대부분의 블로그/기사·쇼핑몰 상품 JSON-LD는 이걸로 충분)
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 LunaOne/1.0', 'Accept-Language': 'ko,en;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      })
      if (response.ok) parsed = parseHtml(await response.text(), url)
    } catch {
      // 아래 headless 렌더링 폴백으로 넘어감
    }

    // 2차 폴백: JS로 본문/상품 정보를 그려주는 SPA는 fetch만으론 빈 껍데기라
    // headless Chromium으로 실제 렌더링한 HTML을 다시 읽어봄 (몇 초 더 걸림)
    if (!parsed) {
      const renderedHtml = await renderPageHtml(url)
      parsed = parseHtml(renderedHtml, url)
    }

    if (!parsed) throw new Error('본문을 충분히 읽지 못했습니다. 복사해서 넣기를 이용해 주세요.')
    res.json({ ...parsed, sourceUrl: url, sourceType: 'url' })
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

// 언어를 한꺼번에 여러 개 넣으면 서로 헷갈려서 오히려 인식률이 떨어짐(2026-07-29 실측 -
// 한글 스크린샷에 일본어 오인식이 섞여나옴) - 화면 언어에 맞는 조합만 골라 쓰게 함
const OCR_LANG_PRESETS = {
  ko: ['kor', 'eng'],
  ja: ['jpn', 'eng'],
  zh: ['chi_sim', 'eng'],
  all: ['kor', 'eng', 'jpn', 'chi_sim'],
}

app.post('/api/extract/ocr', upload.single('image'), async (req, res) => {
  let worker
  try {
    if (!req.file) throw new Error('이미지 파일을 선택해 주세요.')
    const langs = OCR_LANG_PRESETS[req.body.lang] || OCR_LANG_PRESETS.ko
    worker = await createWorker(langs)
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

// 전자책(PDF)에서 본문 텍스트 추출 - 전자책 홍보용 카드뉴스/SNS 콘텐츠를 만들 때 원본 소재로 사용
app.post('/api/extract/pdf', uploadPdf.single('pdf'), async (req, res) => {
  try {
    if (!req.file) throw new Error('전자책(PDF) 파일을 선택해 주세요.')
    const buffer = await fs.promises.readFile(req.file.path)
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    const text = cleanText(result.text || '')
    if (text.length < 80) throw new Error('본문을 충분히 읽지 못했습니다. 텍스트가 있는 PDF인지 확인해 주세요.')
    res.json({
      title: req.file.originalname.replace(/\.pdf$/i, ''),
      text: text.slice(0, 30000),
      sourceType: 'ebook',
    })
  } catch (error) {
    res.status(400).json({ error: `전자책 텍스트 추출 실패: ${error.message}` })
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {})
  }
})

// 직접 만든 영상(캡컷 등) 파일을 원본 소재로 - 나레이션 음성을 whisper.cpp로 텍스트만 추출
// (자막 타이밍은 필요 없고 원문 텍스트만 있으면 됨, anyone-dashboard의 자동자막 기능과
// 같은 whisper.cpp 활용이지만 여기선 순수 텍스트 추출용도). 무료·로컬 - API 비용 없음.
app.post('/api/extract/video', uploadVideo.single('video'), async (req, res) => {
  // 2026-08-03: whisper.cpp는 로컬 전용이라 Render 데모 배포엔 못 올림 - 데모에서는
  // 이 기능만 막고 "정식 버전에서 제공"이라고 안내함(나머지 기능은 그대로 다 됨).
  if (DEMO_ACCESS_CODE) {
    return res.status(403).json({ error: '이 기능(영상에서 음성 추출)은 정식 버전에서 제공될 예정이에요.' })
  }
  let wavPath
  try {
    if (!req.file) throw new Error('영상 파일을 선택해 주세요.')

    wavPath = path.join(uploadsDir, `${req.file.filename}-16k.wav`)
    const conv = spawnSync(ffmpegBin(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', req.file.path, '-ar', '16000', '-ac', '1', wavPath])
    if (conv.status !== 0) {
      throw new Error('영상에서 소리를 꺼내지 못했습니다. ffmpeg이 설치되어 있는지 확인해 주세요.')
    }

    await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION })
    await downloadWhisperModel({ model: WHISPER_MODEL, folder: WHISPER_DIR })

    const result = await transcribe({
      model: WHISPER_MODEL,
      whisperPath: WHISPER_DIR,
      whisperCppVersion: WHISPER_VERSION,
      inputPath: wavPath,
      tokenLevelTimestamps: false,
      splitOnWord: true,
      language: 'ko',
    })

    // 타이밍 없이 문장만 필요하므로 세그먼트 텍스트를 그대로 이어붙임 (특수 마커/빈 세그먼트 제외)
    const text = cleanText(
      result.transcription
        .filter((item) => item.text.trim() && !/^\[_.*_\]$/.test(item.text.trim()))
        .map((item) => item.text)
        .join(' ')
    )
    if (text.length < 10) throw new Error('영상에서 말소리를 충분히 읽지 못했습니다. 나레이션이 들어간 영상인지 확인해 주세요.')

    // multer/busboy가 멀티파트의 파일명을 latin1로 디코딩해서 넘겨서, 한글 파일명이
    // 그대로 쓰면 깨짐(예: "혈당건강"→"íë¹ê±´ê°") - UTF-8로 다시 해석해서 복원.
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    res.json({
      title: originalName.replace(/\.[^.]+$/, ''),
      text: text.slice(0, 30000),
      sourceType: 'video',
    })
  } catch (error) {
    res.status(400).json({ error: `영상 소재 추출 실패: ${error.message}` })
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {})
    if (wavPath) fs.unlink(wavPath, () => {})
  }
})

// 영상에서 장면 몇 컷을 균등하게 뽑아 Claude Vision에 바로 넣을 수 있는 형태로 반환.
// video-script/thumbnail 두 기능이 똑같이 필요해서 공용 함수로 뺌. 호출부에서 반환된
// framePaths를 finally에서 꼭 지워야 함(임시 파일이라 자동 정리 안 됨).
function extractFrames(videoPath, filenamePrefix) {
  const probe = spawnSync(ffprobeBin(), [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
  ])
  const durationSec = Number(probe.stdout?.toString().trim()) || 0
  if (!durationSec) throw new Error('영상 길이를 확인하지 못했습니다.')

  // 장면을 너무 촘촘히 뽑으면 비용/시간이 늘어나서, 5초당 1장 정도로 뽑되 최소 3장 최대 8장.
  const frameCount = Math.min(8, Math.max(3, Math.round(durationSec / 5)))
  const framePaths = []
  const images = []
  for (let i = 0; i < frameCount; i += 1) {
    const t = (durationSec * (i + 0.5)) / frameCount
    const framePath = path.join(uploadsDir, `${filenamePrefix}-frame-${i}.jpg`)
    framePaths.push(framePath)
    const shot = spawnSync(ffmpegBin(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', videoPath, '-frames:v', '1', framePath])
    if (shot.status === 0 && fs.existsSync(framePath)) {
      const base64 = fs.readFileSync(framePath).toString('base64')
      images.push({ block: { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } }, dataUrl: `data:image/jpeg;base64,${base64}` })
    }
  }
  if (images.length === 0) throw new Error('영상에서 장면을 추출하지 못했습니다.')
  return { durationSec, images, framePaths }
}

// 2026-07-27: "대본을 못 찾아서 나레이션 없이 영상만 만들었는데, 영상 보고 대본을 만들어줄
// 수 있나?" 요청 - 나레이션이 없는(또는 위 텍스트 추출이 실패한) 영상도, 화면 장면을 몇 컷
// 뽑아서 Claude Vision(멀티모달)에게 보여주고 그 장면에 맞는 나레이션 대본을 새로 써주는 기능.
// "영상 길이에 맞춰서" 요청 반영 - 한국어 나레이션 낭독 속도(분당 약 300자, 초당 약 5자)를
// 기준으로 목표 글자수를 계산해서 프롬프트에 명시함.
app.post('/api/extract/video-script', uploadVideo.single('video'), async (req, res) => {
  let frames
  try {
    if (!req.file) throw new Error('영상 파일을 선택해 주세요.')
    frames = extractFrames(req.file.path, req.file.filename)

    // 초당 약 5자(분당 약 300자) - 편안한 한국어 나레이션 낭독 속도 기준
    const targetChars = Math.round(frames.durationSec * 5)

    const text = await callClaude({
      system: `당신은 영상 나레이션 대본 작가입니다. 사용자가 나레이션 없이 미리 편집해둔 영상의 장면들을 순서대로 보여드릴 테니,
그 장면 흐름에 어울리는 나레이션 대본을 새로 써주세요.
- 장면에 실제로 보이는 내용(예: 혈당 측정, 건강한 식사 등)을 반영해서 자연스럽게 이어지는 대본으로 쓰세요.
- 지어낸 수치나 의학적 단정은 피하고, 일반적으로 알려진 상식 수준에서만 이야기하세요.
- 첫 문장은 공감형 후킹으로 시작하고, 마지막은 다음 행동을 유도하는 문장으로 마무리하세요.
- 실제로 녹음해서 읽을 대본이므로, 화면 지시문이나 효과음 표시 없이 말하는 내용만 쓰세요.
- 영상 길이가 ${frames.durationSec.toFixed(1)}초이니, 자연스러운 낭독 속도 기준으로 대본은 한글 기준 약 ${targetChars}자 내외로 써주세요 (너무 짧거나 길지 않게).`,
      messages: [{ role: 'user', content: [...frames.images.map((f) => f.block), { type: 'text', text: '위 장면들을 보고 나레이션 대본을 써주세요.' }] }],
      maxTokens: 1500,
    })

    res.json({
      title: Buffer.from(req.file.originalname, 'latin1').toString('utf8').replace(/\.[^.]+$/, ''),
      text: cleanText(text).slice(0, 30000),
      sourceType: 'video-script',
    })
  } catch (error) {
    res.status(400).json({ error: `영상 대본 생성 실패: ${error.message}` })
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {})
    for (const p of frames?.framePaths || []) fs.unlink(p, () => {})
  }
})

// 2026-07-27: "영상을 읽고 쇼츠/롱폼 썸네일도 후킹 들어간 걸로 추천해줄 수 있나?" 요청 -
// "영상이든 링크든" 상관없이 쓸 수 있어야 한다고 해서, 영상 파일이 있으면 실제 장면 중에서
// 가장 눈에 띄는 컷을 골라 추천하고, 영상이 없으면(링크/텍스트/스크린샷 소스) 글 내용만
// 보고 후킹 문구만 추천함(이미지 후보는 OPENAI_API_KEY가 있을 때만 추가로 시도, 없으면 생략).
app.post('/api/thumbnail/suggest', uploadVideo.single('video'), async (req, res) => {
  let frames
  try {
    const title = req.body.title || ''
    const text = (req.body.text || '').slice(0, 4000)
    if (!title && !text && !req.file) throw new Error('원본 소재나 영상이 필요해요.')

    let recommendedFrame = null
    let visionBlocks = []
    if (req.file) {
      frames = extractFrames(req.file.path, req.file.filename)
      visionBlocks = frames.images.map((f, i) => [{ type: 'text', text: `[장면 ${i + 1}]` }, f.block]).flat()
    }

    const system = `당신은 유튜브 쇼츠/롱폼 썸네일 기획자입니다. 주제와(있다면) 영상 장면을 보고,
클릭을 유도하는 강렬한 후킹 문구(썸네일에 큼직하게 들어갈 짧은 문구) 3개를 제안하세요.
- 각 문구는 15자 내외(5~7단어 이내)로 짧고 강렬하게 (예: "이거 모르면 손해", "3일 만에 달라졌다")
- 제목과 겹치지 않는 다른 정보로 쓰세요 - 제목이 구체적 설명이면 썸네일은 호기심 유발,
  제목이 호기심형이면 썸네일은 구체적 설명으로 역할을 분리하세요.
- 과장이나 거짓 정보 없이, 실제 내용에 기반한 궁금증 유발형으로 쓰세요.
${req.file ? '- 추가로, 보여드린 장면 중 썸네일로 쓰기 가장 좋은 장면 번호(가장 눈에 띄고 명확한 컷)를 하나 골라주세요.' : ''}
반드시 아래 JSON 형식으로만 답하세요 (다른 설명 없이):
{"hooks":["문구1","문구2","문구3"]${req.file ? ',"bestSceneNumber":1' : ''}}`

    const userText = `제목: ${title || '(제목 없음)'}\n내용: ${text || '(본문 없음)'}`
    const raw = await callClaude({
      system,
      messages: [{ role: 'user', content: [...visionBlocks, { type: 'text', text: userText }] }],
      maxTokens: 600,
    })

    let parsed
    try {
      parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw)
    } catch {
      throw new Error('추천 결과를 해석하지 못했습니다.')
    }
    const hooks = Array.isArray(parsed.hooks) ? parsed.hooks.slice(0, 3) : []
    if (hooks.length === 0) throw new Error('후킹 문구를 만들지 못했습니다.')

    if (frames && Number.isInteger(parsed.bestSceneNumber)) {
      const idx = parsed.bestSceneNumber - 1
      recommendedFrame = frames.images[idx]?.dataUrl || frames.images[0]?.dataUrl || null
    }

    // 영상이 없는(링크/텍스트) 소스는 실제 장면이 없으니, 키가 설정돼 있으면 AI 이미지를
    // 대신 하나 만들어 후보로 제공 - 실패해도 후킹 문구는 이미 있으니 전체를 막지 않음.
    let aiImage = null
    if (!recommendedFrame && process.env.OPENAI_API_KEY) {
      try {
        aiImage = await generateImage({ prompt: `유튜브 썸네일용 배경 이미지. 글자는 넣지 마세요(문구는 따로 얹습니다). 주제: ${title || text.slice(0, 100)}. 시선을 끄는 선명한 구도.` })
      } catch {
        // 이미지 생성 실패는 무시 - 후킹 문구만으로도 충분히 값어치 있음
      }
    }

    res.json({ hooks, recommendedFrame, aiImage })
  } catch (error) {
    res.status(400).json({ error: `썸네일 추천 실패: ${error.message}` })
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {})
    for (const p of frames?.framePaths || []) fs.unlink(p, () => {})
  }
})

// 2026-08-01 요청: "노트북LM 워터마크 지우기 나도 할 수 있게 해줘" - 영상 하나 업로드하면
// 우측 하단 고정 워터마크(기본은 노트북LM 위치)를 지워서 돌려줌. 결과는 GENERATED_DIR에
// UUID 이름으로 저장하고, 다 쓰면 DELETE로 지울 수 있게 함(anyone-dashboard와 동일 패턴).
app.post('/api/watermark/remove', uploadVideo.single('video'), async (req, res) => {
  let outPath
  try {
    if (!req.file) throw new Error('영상 파일이 필요해요.')
    const fileName = `${crypto.randomUUID()}.mp4`
    outPath = path.join(GENERATED_DIR, fileName)
    await removeWatermark(req.file.path, outPath)
    res.json({ videoUrl: `/generated/${fileName}` })
  } catch (error) {
    if (outPath) fs.unlink(outPath, () => {})
    res.status(400).json({ error: error.message })
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {})
  }
})

app.delete('/api/watermark/:fileName', (req, res) => {
  const fileName = req.params.fileName
  if (!/^[a-f0-9-]{36}\.mp4$/i.test(fileName)) {
    return res.status(400).json({ error: '삭제할 수 없는 파일 이름이에요.' })
  }
  const filePath = path.join(GENERATED_DIR, path.basename(fileName))
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '이미 삭제된 파일이에요.' })
  }
  fs.unlinkSync(filePath)
  res.json({ ok: true })
})

// ------------------------------------------------------------
// 콘텐츠 생성 - 플랫폼 x 언어 조합마다 따로 호출 (promptBuilder.js 참고)
// ------------------------------------------------------------

// 소스 제목에서 후보 키워드 몇 개를 뽑아 네이버 데이터랩으로 비교, 요즘 더 검색되는 표현을
// 한 줄로 만든다. NAVER_CLIENT_ID/SECRET이 없거나 비교할 후보가 2개 미만이면 조용히 스킵
// (콘텐츠 생성 자체를 막으면 안 됨 - anyone-dashboard의 weatherNote/trendNote와 동일 원칙).
async function deriveTrendNote(title) {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) return ''
  if (!title || !title.trim()) return ''
  const words = [...new Set(title.trim().split(/\s+/).filter((w) => w.length >= 2))].slice(0, 5)
  if (words.length < 2) return ''
  try {
    const ranked = await compareSearchTrend(
      words.map((w) => ({ label: w, keywords: [w] })),
      { days: 7 }
    )
    const top = ranked[0]
    if (!top || !top.avgRatio) return ''
    return `"${top.label}"이(가) 최근 7일간 검색량이 가장 높았어요 (원제목: ${title.trim()})`
  } catch (err) {
    console.error('[deriveTrendNote] 네이버 데이터랩 조회 실패, 트렌드 반영 없이 진행:', err.message)
    return ''
  }
}

app.post('/api/generate', demoDailyLimiter, async (req, res) => {
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

    const trendNote = hasKey ? await deriveTrendNote(source.title) : ''

    const jobs = []
    for (const language of languages) {
      outputs[language] = {}
      for (const platform of platforms) {
        jobs.push(
          (hasKey ? generatePiece({ source, platform, language, cardCount, tone, experienceMode, experienceText, smartEnhance, photos, trendNote }) : demoPiece({ source, platform, language, cardCount, photos }))
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

    res.json({ provider: hasKey ? 'claude' : 'demo', result: { summary, outputs, trendNote } })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// ------------------------------------------------------------
// 이야기 보따리 - 자유 창작 / 역사 이야기 2개 장르 (2026-08-23 설계 문서).
// 분량(20/30/45/60분)은 한 번에 못 쓰는 길이라 챕터 단위로 이어쓰기 - 프론트가
// previousChapters(요약+마지막 문단)를 되돌려 보내면서 챕터를 하나씩 받아간다.
// 역사 모드의 안전장치 프롬프트는 storyBuilder.js에 고정으로 들어있음.
// ------------------------------------------------------------
app.post('/api/story/generate', demoDailyLimiter, async (req, res) => {
  try {
    const { genre, source, tone, lengthMinutes, chapterIndex, previousChapters } = req.body || {}
    if (!STORY_GENRES.includes(genre)) throw new Error('장르를 선택해 주세요. (자유 창작 / 역사 이야기)')
    const chapter = await generateStoryChapter({ genre, source, tone, lengthMinutes, chapterIndex, previousChapters })
    res.json(chapter)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.get('/api/story/options', (_req, res) => {
  res.json({ genres: STORY_GENRES, tones: STORY_TONES, lengths: STORY_LENGTH_MINUTES })
})

// ------------------------------------------------------------
// 가사 쓰기 - Suno용 [Verse]/[Chorus] 구조 가사 + 스타일 태그.
// 곡 길이 기본값은 숏폼 추천(1:30~2:00) - 별도 설정 없이 써도 트렌드에 맞는 곡이 나오게.
// ------------------------------------------------------------
app.post('/api/lyrics/generate', demoDailyLimiter, async (req, res) => {
  try {
    const { theme, mood, songLength, customLength } = req.body || {}
    const result = await generateLyrics({ theme, mood, songLength, customLength })
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.get('/api/lyrics/options', (_req, res) => {
  res.json({ songLengths: SONG_LENGTHS })
})

// ------------------------------------------------------------
// 모션그래픽 만들기 - 렌더링은 애니원 서버(Remotion + ffmpeg)가 담당하고, 루나원은
// 요청만 보내고 결과만 받는 얇은 연동 (2026-08-23 설계 문서의 루나원 연동 방식).
// 애니원 서버 주소는 ANYONE_API_BASE로 바꿀 수 있음 (기본: 로컬 애니원 백엔드 3001).
// ------------------------------------------------------------
const ANYONE_API_BASE = process.env.ANYONE_API_BASE || 'http://localhost:3001'

async function proxyToAnyone(res, path, init) {
  try {
    const response = await fetch(`${ANYONE_API_BASE}${path}`, { ...init, signal: AbortSignal.timeout(20000) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return res.status(response.status).json({ error: data.error || `애니원 서버 응답 오류 (${response.status})` })
    res.json(data)
  } catch {
    res.status(502).json({ error: '애니원 서버에 연결하지 못했어요. 애니원 대시보드 백엔드가 켜져 있는지 확인해 주세요.' })
  }
}

app.get('/api/motion/templates', (_req, res) => proxyToAnyone(res, '/api/motion-graphics/templates'))

app.post('/api/motion/render', demoDailyLimiter, (req, res) =>
  proxyToAnyone(res, '/api/motion-graphics/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req.body || {}),
  })
)

app.get('/api/motion/status/:jobId', async (req, res) => {
  if (!/^[a-f0-9-]{36}$/i.test(req.params.jobId)) return res.status(400).json({ error: '잘못된 작업 ID예요.' })
  try {
    const response = await fetch(`${ANYONE_API_BASE}/api/motion-graphics/status/${req.params.jobId}`, { signal: AbortSignal.timeout(20000) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return res.status(response.status).json({ error: data.error || `애니원 서버 응답 오류 (${response.status})` })
    // 애니원이 주는 videoUrl(/generated/...)은 애니원 서버 기준 상대경로라, 루나원 화면에서
    // 바로 재생/다운로드할 수 있게 절대 주소로 바꿔서 내려줌.
    if (data.videoUrl && data.videoUrl.startsWith('/')) data.videoUrl = `${ANYONE_API_BASE}${data.videoUrl}`
    res.json(data)
  } catch {
    res.status(502).json({ error: '애니원 서버에 연결하지 못했어요. 애니원 대시보드 백엔드가 켜져 있는지 확인해 주세요.' })
  }
})

// 카드 사진/아이콘 자동 배정으로 충분하지 않을 때만 쓰는 수동 AI 이미지 생성 (직접 눌러야 호출됨)
// 무료 스톡 사진 검색(Pexels) - 카드뉴스용 대표 사진을 직접 업로드하는 대신 검색해서 고를 수 있음
app.get('/api/photos/search', async (req, res) => {
  try {
    const results = await searchPhotos({ query: req.query.q })
    res.json({ photos: results })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post('/api/photos/fetch', async (req, res) => {
  try {
    const dataUrl = await fetchPhotoAsDataUrl(req.body.url)
    res.json({ dataUrl })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post('/api/generate/card-image', demoDailyLimiter, async (req, res) => {
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

// 2026-07-27: "카드뉴스는 메모장으로 받으니 좀 그러네, 이미지로 받고 싶다 + 유행하는
// 트렌디한 스타일로" 요청 - 화면에 보이는 카드를 실제 PNG 이미지로 렌더링해서 내려줌.
// 첨부한 사진(photos)도 그대로 배경에 반영. 계정 로그인이 필요 없는 순수 렌더링이라
// 매번 새 headless 브라우저를 띄우고 끝나면 닫음(routes/*.js의 계정 자동화와 무관).
app.post('/api/cards/render-images', async (req, res) => {
  try {
    const { cards, photos, template, decoration } = req.body || {}
    if (!Array.isArray(cards) || cards.length === 0) throw new Error('렌더링할 카드가 없어요.')
    const images = await renderCardsToImages(cards, photos || [], template, decoration)
    res.json({ images })
  } catch (error) {
    res.status(400).json({ error: `카드 이미지 생성 실패: ${error.message}` })
  }
})

// 2026-07-30: 카드뉴스 스타일이 하나(네온 그라데이션)뿐이었던 걸 "템플릿을 고를 수 있게"
// 요청받아 4종으로 늘림 - 프론트에서 선택지를 하드코딩하지 않고 여기서 받아가게 함.
app.get('/api/cards/templates', (_req, res) => {
  res.json({ templates: CARD_TEMPLATES })
})

// ------------------------------------------------------------
// 네이버 블로그 자동 채우기 - 2026-07-26 anyone-dashboard 쪽 TikTok 계정 영구정지 이후
// 안전 조치로 비활성화(2026-07-27). "로그인/발행은 사람이 직접"이었어도 그 사이(제목/본문/사진
// 자동 타이핑) 자체가 로그인 세션을 스크립트가 조작하는 패턴이라 위험 - 루나원은 가족에게
// 배포할 예정이라 여러 계정이 같은 위험에 노출될 수 있어 더 신경 써서 껐음(사용자 확인).
// 다시 켤 땐 공식 네이버 블로그 API로 새로 만들 것, 이 브라우저 자동화 방식으로 되살리면 안 됨.
// 원래 구현은 git 이력에 남아있음.
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
  res.status(403).json({
    error: '계정 보호를 위해 네이버 블로그 자동 입력을 껐어요. 제목/본문/이미지는 위에서 복사해서 네이버 블로그에 직접 올려주세요.',
  })
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: process.env.ANTHROPIC_API_KEY ? 'claude' : 'demo',
    imageProvider: process.env.OPENAI_API_KEY ? 'openai' : null,
    localAutomation: process.env.ENABLE_LOCAL_BROWSER_AUTOMATION === 'true',
    photoSearch: Boolean(process.env.PEXELS_API_KEY),
    version: '1.0.0',
    demoMode: Boolean(DEMO_ACCESS_CODE),
    demoDailyLimit: DEMO_ACCESS_CODE ? DEMO_DAILY_LIMIT : null,
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
