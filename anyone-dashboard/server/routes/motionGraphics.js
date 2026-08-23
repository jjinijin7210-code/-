// ============================================================
// 모션그래픽 만들기 API (설계 문서의 백엔드 처리 흐름 그대로):
//  1) POST /motion-graphics/render     - 템플릿ID + props → 렌더링 job 시작, jobId 반환
//  2) GET  /motion-graphics/status/:id - job 상태 조회 (진행중/완료/실패 + videoUrl)
//  3) GET  /motion-graphics/templates  - 템플릿 5종 메타 (프론트 입력폼 + 루나원 연동용)
// 렌더링은 몇 초~몇십 초 걸릴 수 있어서 요청을 붙잡아두지 않고 job으로 돌린다.
// ============================================================

import { Router } from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { GENERATED_DIR } from '../lib/shortsGenerator.js'
import {
  ASPECT_PRESETS,
  DURATION_CHOICES,
  MOTION_TEMPLATE_META,
  renderMotionGraphic,
} from '../lib/motionGraphicsRenderer.js'

const router = Router()

// 완성 mp4는 쇼츠와 같은 GENERATED_DIR(=Render 디스크, /generated로 정적 서빙)에 저장.
// 설계 문서의 "저장 위치 결정(Render 디스크 vs 외부 스토리지)" 체크포인트는 일단 디스크로
// 정함 - 기존 쇼츠/영상제작실 결과물과 같은 위치라 다운로드/삭제 흐름을 그대로 쓸 수 있음.
const jobs = new Map()
const JOB_TTL_MS = 60 * 60 * 1000 // 완료/실패 job 기록은 1시간 뒤 정리

function pruneOldJobs() {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (job.status !== 'rendering' && now - job.createdAt > JOB_TTL_MS) jobs.delete(id)
  }
}

function validateRequest(body) {
  const meta = MOTION_TEMPLATE_META.find((t) => t.id === body.template)
  if (!meta) throw new Error(`알 수 없는 템플릿이에요: ${body.template}. (${MOTION_TEMPLATE_META.map((t) => t.id).join('/')})`)

  const rawProps = body.props || {}
  const props = {}
  for (const field of meta.fields) {
    const value = rawProps[field.key]
    const empty = value === undefined || value === null || String(value).trim() === ''
    if (empty) {
      if (field.required) throw new Error(`"${field.label}" 값을 입력해 주세요.`)
      continue
    }
    if (field.type === 'number') {
      const num = Number(value)
      if (!Number.isFinite(num)) throw new Error(`"${field.label}"에는 숫자를 넣어 주세요.`)
      props[field.key] = num
    } else if (field.type === 'select') {
      props[field.key] = field.options.includes(value) ? value : field.options[0]
    } else {
      props[field.key] = String(value).slice(0, 200)
    }
  }

  const aspect = body.aspect && ASPECT_PRESETS[body.aspect] ? body.aspect : 'vertical'
  const durationSec = DURATION_CHOICES.includes(Number(body.durationSec)) ? Number(body.durationSec) : 5
  // 브랜드 색상은 #rrggbb만 허용 - 그 외 값은 템플릿 기본색으로
  const brandColor = /^#[0-9a-f]{6}$/i.test(body.brandColor || '') ? body.brandColor : undefined

  return { template: meta.id, props, aspect, durationSec, brandColor }
}

router.get('/motion-graphics/templates', (_req, res) => {
  res.json({
    templates: MOTION_TEMPLATE_META,
    aspects: Object.keys(ASPECT_PRESETS),
    durations: DURATION_CHOICES,
  })
})

router.post('/motion-graphics/render', (req, res) => {
  let cfg
  try {
    cfg = validateRequest(req.body || {})
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  pruneOldJobs()
  const jobId = crypto.randomUUID()
  const fileName = `motion-${jobId}.mp4`
  const job = { status: 'rendering', videoUrl: null, error: null, createdAt: Date.now() }
  jobs.set(jobId, job)

  // 응답은 바로 돌려주고 렌더링은 뒤에서 진행 - 프론트가 status를 폴링함
  renderMotionGraphic(cfg, path.join(GENERATED_DIR, fileName))
    .then(() => {
      job.status = 'done'
      job.videoUrl = `/generated/${fileName}`
    })
    .catch((err) => {
      job.status = 'error'
      job.error = err.message
      console.error('[모션그래픽] 렌더링 실패:', err)
    })

  res.json({ jobId })
})

router.get('/motion-graphics/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: '해당 작업을 찾을 수 없어요. (완료 후 1시간이 지나면 기록이 정리돼요)' })
  res.json({ status: job.status, videoUrl: job.videoUrl, error: job.error })
})

// 다 받은 결과물 정리 (영상 제작실의 generated 삭제와 같은 패턴)
router.delete('/motion-graphics/generated/:fileName', (req, res) => {
  const fileName = req.params.fileName
  if (!/^motion-[a-f0-9-]{36}\.mp4$/i.test(fileName)) {
    return res.status(400).json({ error: '삭제할 수 없는 파일 이름이에요.' })
  }
  const filePath = path.join(GENERATED_DIR, path.basename(fileName))
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '이미 삭제된 파일이에요.' })
  fs.unlinkSync(filePath)
  res.json({ ok: true })
})

export default router
