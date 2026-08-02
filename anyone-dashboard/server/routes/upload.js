// ============================================================
// 사진/영상 첨부를 Supabase DB 컬럼에 base64로 넣지 않고 Supabase Storage에 올리기 위한
// 공용 업로드 라우트. attachments.js(fileToAttachment/uploadDataUrlToStorage)가 이 라우트를 호출함.
// ============================================================

import { Router } from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import { uploadToStorage, deleteFromStorage } from '../lib/supabaseStorage.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

function extFromMime(mime) {
  const m = /^[^/]+\/([a-z0-9.+-]+)$/i.exec(mime || '')
  if (!m) return ''
  const sub = m[1].split('+')[0]
  return `.${sub === 'jpeg' ? 'jpg' : sub}`
}

function makeFileName(mimeType, originalName) {
  const ext = originalName && /\.[a-z0-9]+$/i.test(originalName) ? originalName.match(/\.[a-z0-9]+$/i)[0] : extFromMime(mimeType)
  return `uploads/${Date.now()}-${crypto.randomUUID()}${ext}`
}

// 실제 파일 업로드 (<input type=file> 경로)
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '업로드할 파일이 없어요.' })
  }
  try {
    const fileName = makeFileName(req.file.mimetype, req.file.originalname)
    const url = await uploadToStorage(req.file.buffer, { fileName, contentType: req.file.mimetype })
    res.json({ url, filename: req.file.originalname, size: req.file.size, mime_type: req.file.mimetype })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 이미 base64로 갖고 있는 데이터(AI 생성 이미지, Pexels 사진, 서버에서 만든 PNG 등) 업로드
router.post('/upload/from-data-url', async (req, res) => {
  const { dataUrl, filename } = req.body || {}
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    return res.status(400).json({ error: 'dataUrl(data: URI)이 필요해요.' })
  }
  try {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
    if (!match) throw new Error('data URL 형식을 해석하지 못했어요.')
    const [, mimeType, base64] = match
    const buffer = Buffer.from(base64, 'base64')
    const fileName = makeFileName(mimeType, filename)
    const url = await uploadToStorage(buffer, { fileName, contentType: mimeType })
    res.json({ url, size: buffer.length, mime_type: mimeType })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.post('/upload/delete', async (req, res) => {
  const { url } = req.body || {}
  if (!url) return res.status(400).json({ error: 'url이 필요해요.' })
  await deleteFromStorage(url)
  res.json({ ok: true })
})

export default router
