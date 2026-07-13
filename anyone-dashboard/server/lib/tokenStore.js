// ============================================================
// 구글(Blogger) 토큰 저장소
//
// 혼자 쓰는 개인 도구라 DB 없이 서버 로컬의 JSON 파일 하나에 토큰을 저장합니다.
// (여러 사용자를 지원해야 한다면 나중에 Supabase 테이블로 옮기는 게 좋아요.)
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export function createTokenStore(filePath) {
  const dir = path.dirname(filePath)

  function ensureDir() {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  function read() {
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      return null
    }
  }

  function save(tokens) {
    ensureDir()
    const current = read() || {}
    const merged = { ...current, ...tokens, updated_at: new Date().toISOString() }
    writeFileSync(filePath, JSON.stringify(merged, null, 2))
    return merged
  }

  function clear() {
    ensureDir()
    writeFileSync(filePath, JSON.stringify({}, null, 2))
  }

  function isConnected() {
    const tokens = read()
    return Boolean(tokens && tokens.access_token)
  }

  return { read, save, clear, isConnected }
}
