// 원격 이미지 URL을 로컬 임시 파일로 내려받는다 (ffmpeg는 로컬 파일 경로가 필요함).
import fs from 'node:fs'
import path from 'node:path'

export async function downloadToFile(url, destPath) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`이미지 다운로드 실패 (${res.status}): ${url}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer))
  return destPath
}
