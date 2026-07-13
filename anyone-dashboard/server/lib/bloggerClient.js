// ============================================================
// Blogger API v3 - 글 작성/발행
// (네트워크 호출이라 이 환경에서 직접 실행 검증하지 못했습니다.
//  공식 문서 스펙: POST https://www.googleapis.com/blogs/v3/blogs/{blogId}/posts)
// ============================================================

export async function publishToBloggerApi({ accessToken, blogId, title, content, isDraft = false }) {
  if (!blogId) throw new Error('BLOGGER_BLOG_ID가 서버 .env에 설정되어 있지 않아요.')

  const url = `https://www.googleapis.com/blogs/v3/blogs/${blogId}/posts${isDraft ? '?isDraft=true' : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, content }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Blogger 발행 실패: ${JSON.stringify(data).slice(0, 300)}`)
  }
  return data // { id, url, ... }
}
