// ============================================================
// 사진/영상 첨부를 Supabase Storage에 업로드하되, 용량 초과(QuotaExceeded) 또는
// 업로드 실패 시 내 컴퓨터 로컬 디스크(/assets-uploads/)로 100% 무제한 자동 폴백.
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSupabaseAdmin } from './supabaseAdmin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const LOCAL_UPLOADS_DIR = path.join(__dirname, '..', 'assets', 'uploads')
fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true })

const BUCKET = 'dashboard-media'
let bucketEnsured = false

async function ensureBucket(supabase) {
  if (bucketEnsured) return
  const { data: buckets } = await supabase.storage.listBuckets()
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`Storage 버킷 생성 실패: ${error.message}`)
    }
  }
  bucketEnsured = true
}

// buffer를 저장 (Supabase 시도 후 실패 시 무제한 로컬 저장소로 자동 전환)
export async function uploadToStorage(buffer, { fileName, contentType }) {
  const safeName = path.basename(fileName)
  const localFilePath = path.join(LOCAL_UPLOADS_DIR, safeName)
  
  // 1. 항상 로컬 디스크에 백업 저장
  try {
    fs.writeFileSync(localFilePath, buffer)
  } catch (e) {
    console.error('[supabaseStorage] 로컬 디스크 파일 저장 에러:', e)
  }

  // 2. Supabase Storage에 업로드 시도 (용량 초과 등의 오류 발생 시 안전하게 로컬 URL로 폴백)
  try {
    const supabase = getSupabaseAdmin()
    await ensureBucket(supabase)
    const { error } = await supabase.storage.from(BUCKET).upload(fileName, buffer, {
      contentType: contentType || 'application/octet-stream',
      upsert: true,
    })
    if (error) throw new Error(error.message)
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
    return data.publicUrl
  } catch (err) {
    console.warn('[supabaseStorage] Supabase 용량 초과 또는 업로드 오류로 로컬 저장소 URL로 자동 전환됨:', err.message)
    // 로컬 서빙 URL 반환
    return `/assets-uploads/${safeName}`
  }
}

// 공개 URL 또는 fileName을 받아 객체를 지움
export async function deleteFromStorage(urlOrFileName) {
  try {
    const safeName = path.basename(urlOrFileName)
    const localFilePath = path.join(LOCAL_UPLOADS_DIR, safeName)
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath)
    }

    const supabase = getSupabaseAdmin()
    let fileName = urlOrFileName
    const marker = `/storage/v1/object/public/${BUCKET}/`
    const idx = urlOrFileName.indexOf(marker)
    if (idx !== -1) fileName = urlOrFileName.slice(idx + marker.length)
    await supabase.storage.from(BUCKET).remove([fileName])
  } catch (err) {
    console.error('[supabaseStorage] 삭제 실패(무시하고 진행):', err.message)
  }
}
