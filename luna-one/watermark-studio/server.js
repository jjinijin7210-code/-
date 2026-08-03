import express from 'express'
import multer from 'multer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { cloneFill } from './cloneFill.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const uploads = path.join(root, 'uploads')
const results = path.join(root, 'results')
fs.mkdirSync(uploads, { recursive: true })
fs.mkdirSync(results, { recursive: true })

const app = express()
const upload = multer({ dest: uploads, limits: { fileSize: 2 * 1024 * 1024 * 1024 } })
app.use(express.static(path.join(root, 'public')))
app.use('/results', express.static(results, { fallthrough: false }))

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000) })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim().split(/\r?\n/).pop() || `exit ${code}`)))
  })
}

function parseRegions(body, isVideo) {
  let regions
  try {
    regions = body.regions ? JSON.parse(body.regions) : [{ x: body.x, y: body.y, w: body.w, h: body.h }]
  } catch {
    throw new Error('제거 작업 목록을 읽지 못했어요.')
  }
  if (!Array.isArray(regions) || regions.length < 1) throw new Error('제거할 영역을 하나 이상 등록해주세요.')
  if (regions.length > 30) throw new Error('제거 작업은 한 번에 최대 30개까지 등록할 수 있어요.')
  return regions.map((item) => {
    const region = Object.fromEntries(['x', 'y', 'w', 'h'].map((key) => [key, Number(item[key])]))
    if (!Object.values(region).every(Number.isFinite)) throw new Error('선택 영역 좌표가 올바르지 않아요.')
    if (region.x < 0 || region.y < 0 || region.w <= 0 || region.h <= 0 || region.x + region.w > 1.001 || region.y + region.h > 1.001) throw new Error('선택 영역이 화면 밖으로 벗어났어요.')
    const start = isVideo ? Math.max(0, Number(item.start) || 0) : 0
    const end = isVideo ? Number(item.end) : 0
    if (isVideo && (!Number.isFinite(end) || end <= start)) throw new Error('각 작업의 종료 시간은 시작 시간보다 뒤여야 해요.')
    const sourceX = Number(item.sourceX)
    const sourceY = Number(item.sourceY)
    if (!isVideo && (!Number.isFinite(sourceX) || !Number.isFinite(sourceY) || sourceX < 0 || sourceY < 0 || sourceX + region.w > 1.001 || sourceY + region.h > 1.001)) {
      throw new Error('깨끗한 복제 원본 영역을 지정해주세요.')
    }
    const overlapsTarget = !isVideo && sourceX < region.x + region.w && sourceX + region.w > region.x && sourceY < region.y + region.h && sourceY + region.h > region.y
    if (overlapsTarget) throw new Error('깨끗한 배경이 지울 영역과 겹쳐요. 떨어진 배경을 선택해주세요.')
    return { ...region, start, end, sourceX, sourceY }
  })
}

async function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { windowsHide: true })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      const [width, height] = out.trim().split(',').map(Number)
      code === 0 && width && height ? resolve({ width, height }) : reject(new Error('파일 크기를 읽지 못했어요.'))
    })
  })
}

app.post('/api/remove', upload.single('media'), async (req, res) => {
  let output
  try {
    if (!req.file) throw new Error('이미지나 영상 파일을 선택해주세요.')
    const isImage = req.file.mimetype.startsWith('image/')
    const isVideo = req.file.mimetype.startsWith('video/')
    if (!isImage && !isVideo) throw new Error('이미지 또는 영상만 처리할 수 있어요.')
    const { width, height } = await probe(req.file.path)
    const regions = parseRegions(req.body, isVideo)
    const pixelRegions = regions.map((region) => {
      const x = Math.max(0, Math.min(width - 2, Math.round(region.x * width)))
      const y = Math.max(0, Math.min(height - 2, Math.round(region.y * height)))
      const w = Math.max(2, Math.min(width - x, Math.round(region.w * width)))
      const h = Math.max(2, Math.min(height - y, Math.round(region.h * height)))
      const sourceX = isImage ? Math.max(0, Math.min(width - w, Math.round(region.sourceX * width))) : 0
      const sourceY = isImage ? Math.max(0, Math.min(height - h, Math.round(region.sourceY * height))) : 0
      return { ...region, x, y, w, h, sourceX, sourceY }
    })
    const filters = pixelRegions.map((region) => {
      const { x, y, w, h } = region
      const enable = isVideo ? `:enable='between(t,${region.start.toFixed(3)},${region.end.toFixed(3)})'` : ''
      return `delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0${enable}`
    })
    const ext = isImage ? '.png' : '.mp4'
    const name = `${crypto.randomUUID()}${ext}`
    output = path.join(results, name)
    if (isImage) {
      // 2026-08-04: 파이썬(cloneFill.py, OpenCV 190MB 필요) 대신 Node.js(sharp)로 직접 처리 -
      // 별도 파이썬 설치가 필요 없어짐.
      await cloneFill(req.file.path, output, pixelRegions)
    } else {
      const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', req.file.path, '-vf', filters.join(','), '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output]
      await run(process.env.FFMPEG_PATH || 'ffmpeg', args)
    }
    res.json({ url: `/results/${name}`, type: isImage ? 'image' : 'video' })
  } catch (error) {
    if (output) fs.unlink(output, () => {})
    res.status(400).json({ error: error.message })
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {})
  }
})

app.delete('/api/result/:name', (req, res) => {
  if (!/^[a-f0-9-]{36}\.(png|mp4)$/i.test(req.params.name)) return res.status(400).json({ error: '잘못된 파일 이름이에요.' })
  fs.unlink(path.join(results, req.params.name), (error) => {
    if (error && error.code !== 'ENOENT') return res.status(500).json({ error: '파일을 삭제하지 못했어요.' })
    res.json({ ok: true })
  })
})

app.listen(3333, '127.0.0.1', () => console.log('워터마크 마스터 스튜디오: http://localhost:3333'))
