import { Router } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'

const router = Router()

// 실제로 자동 파이프라인이 수행하는 단계에 맞춘 AI 직원팀 구성.
// (department는 EmployeeStatus.jsx가 기대하는 값: 리서치 / 콘텐츠 제작 / 현지화 / 검수 / 성과 분석 / 발행·CS)
const EMPLOYEE_ROSTER = [
  {
    department: '리서치',
    role_name: '소싱 담당 (1688 · 쿠팡 교차 확인)',
    role_emoji: '🔍',
    current_task: '카테고리 키워드로 1688 유사 상품을 찾고, 쿠팡에도 실제로 판매 중인지 확인',
  },
  {
    department: '리서치',
    role_name: '소싱 담당 (네이버 쇼핑·클립)',
    role_emoji: '🛍️',
    current_task: '네이버 쇼핑(스마트스토어)에서 실제 판매 중인 상품과 구매 링크를 바로 찾아옴',
  },
  {
    department: '콘텐츠 제작',
    role_name: '작성자 (AI 초안 생성)',
    role_emoji: '✍️',
    current_task: '소싱된 상품 정보로 채널별 게시물 초안(제목/본문/해시태그) 작성',
  },
  {
    department: '콘텐츠 제작',
    role_name: '영상 제작 담당 (팬줌 합성 · 내레이션)',
    role_emoji: '🎬',
    current_task: '유사 상품 사진 여러 장을 모아 쇼츠용 영상으로 합성, AI 내레이션 생성',
  },
  {
    department: '검수',
    role_name: '검수자 A (1차 - 팩트체크·과장표현·AI스러움)',
    role_emoji: '🧐',
    current_task: '초안의 사실관계·과장 표현·AI 특유 어투 확인',
  },
  {
    department: '검수',
    role_name: '검수자 B (교차 검수)',
    role_emoji: '🔁',
    current_task: '1차 검수와 독립적으로 같은 기준을 다시 확인',
  },
  {
    department: '검수',
    role_name: '검수자 C (가독성)',
    role_emoji: '📖',
    current_task: '20대 초반 독자 기준 자연스러움/가독성만 집중 확인',
  },
  {
    department: '발행·CS',
    role_name: 'CS 담당 (댓글 트리거 → 인포크 안내)',
    role_emoji: '💬',
    current_task: "댓글에 '정보' 키워드가 달리면 인포크 링크 안내 문구가 게시물에 포함되도록 관리",
  },
]

// 관리용 1회성 시딩 엔드포인트 - AUTO_RUN_SECRET으로 보호 (자동 파이프라인과 동일한 보안 수준).
// 이미 등록된 role_name은 건너뛰어서 여러 번 호출해도 중복 생성되지 않음.
router.post('/seed/employees', async (req, res) => {
  const { token } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    return res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
  }
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    return res.status(500).json({ error: 'AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.' })
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data: existing, error: fetchError } = await supabase
      .from('employee_status')
      .select('role_name')
      .eq('user_id', targetUserId)
    if (fetchError) throw new Error(fetchError.message)

    const existingNames = new Set((existing || []).map((e) => e.role_name))
    const toInsert = EMPLOYEE_ROSTER.filter((e) => !existingNames.has(e.role_name)).map((e) => ({
      ...e,
      user_id: targetUserId,
      status: '대기',
    }))

    if (toInsert.length === 0) {
      return res.json({ ok: true, inserted: 0, message: '이미 전부 등록되어 있어요.' })
    }

    const { data: inserted, error: insertError } = await supabase.from('employee_status').insert(toInsert).select()
    if (insertError) throw new Error(insertError.message)

    res.json({ ok: true, inserted: inserted.length })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
