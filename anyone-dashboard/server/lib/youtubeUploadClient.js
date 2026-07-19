// ============================================================
// 유튜브 영상 업로드 - YouTube Data API v3 videos.insert
//
// googleapis SDK 없이 bloggerClient.js와 같은 스타일로 fetch만 사용. YouTube 업로드는
// multipart/related 요청(메타데이터 JSON + 영상 바이너리를 boundary로 이어붙임)이 필요해서
// FormData 대신 Buffer를 직접 조립함 - multipart/form-data와는 다른 형식이라 FormData로는 못 만듦.
// ============================================================

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status'

// 순수 함수로 분리 - 네트워크 없이 제목 길이 제한/태그 개수 제한 규칙을 검증할 수 있게
// (테스트: scripts/test-youtube-upload-client.mjs)
export function buildVideoMetadata({ title, description, tags, privacyStatus = 'public' }) {
  return {
    snippet: {
      title: (title || '').slice(0, 100), // 유튜브 제목 길이 제한(100자)
      description: description || '',
      tags: Array.isArray(tags) ? tags.slice(0, 30) : [], // 유튜브 태그 개수 관례상 제한
      categoryId: '22', // People & Blogs
    },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
  }
}

export async function uploadVideoToYoutube({ accessToken, videoBuffer, title, description, tags, privacyStatus = 'public' }) {
  if (!accessToken) throw new Error('accessToken이 필요해요.')
  if (!videoBuffer || videoBuffer.length === 0) throw new Error('videoBuffer가 비어있어요.')
  if (!title || !title.trim()) throw new Error('title이 필요해요.')

  const metadata = buildVideoMetadata({ title, description, tags, privacyStatus })

  const boundary = `anyone-dashboard-${Date.now()}`
  const metadataPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    'utf-8'
  )
  const videoPartHeader = Buffer.from(`--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`, 'utf-8')
  const closingBoundary = Buffer.from(`\r\n--${boundary}--`, 'utf-8')
  const body = Buffer.concat([metadataPart, videoPartHeader, videoBuffer, closingBoundary])

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`유튜브 업로드 실패 (${res.status}): ${JSON.stringify(data).slice(0, 400)}`)
  }
  return { videoId: data.id, url: `https://www.youtube.com/watch?v=${data.id}` }
}
