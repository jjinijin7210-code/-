// ============================================================
// 생성된 영상을 Render의 로컬 디스크가 아니라 Supabase Storage에 영구 저장.
// Render 무료 플랜은 재배포/재시작마다 디스크가 초기화되는데(에페메럴), 오늘 여러 번
// 재배포하면서 이미 만든 영상들이 실제로 사라져서 "영상이 안 열려요" 문제가 생겼다
// (2026-07-19). /generated/ 로컬 서빙은 그대로 폴백으로 남겨두되, 실제 URL은 이제
// Supabase Storage의 영구 URL을 쓴다.
// ============================================================

import fs from 'node:fs'
import { getSupabaseAdmin } from './supabaseAdmin.js'

const BUCKET = 'generated-videos'
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

// 로컬에 렌더링된 mp4 파일을 Supabase Storage에 올리고 영구 URL을 돌려줌.
// 업로드에 실패하면(버킷 설정 문제 등) null을 돌려주고, 호출하는 쪽에서 기존 로컬
// /generated/ URL로 폴백할 수 있게 함 - 업로드 실패가 전체 파이프라인을 막지 않도록.
export async function uploadGeneratedVideo(localPath, fileName) {
  try {
    const supabase = getSupabaseAdmin()
    await ensureBucket(supabase)
    const buffer = fs.readFileSync(localPath)
    const { error } = await supabase.storage.from(BUCKET).upload(fileName, buffer, {
      contentType: 'video/mp4',
      upsert: true,
    })
    if (error) throw new Error(error.message)
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
    return data.publicUrl
  } catch (err) {
    console.error('[videoStorage] Supabase Storage 업로드 실패, 로컬 URL로 폴백:', err.message)
    return null
  }
}
