// ============================================================
// 아침 브리핑 (계획서 7장 - "매일 오전 10시 리포트")
//
// 이 모듈은 "화면에서 눌러서 생성하는 브리핑"만 다룹니다.
// 실제 매일 오전 10시에 서버가 알아서 이메일/카카오톡/슬랙으로 자동 발송하는 기능은
// 크론잡 등 서버가 필요한 별도 2단계 작업이며, 여기서는 다루지 않습니다 (README 참고).
// ============================================================

// 두 날짜(문자열 or Date)가 같은 날인지 확인
export function isSameDay(dateA, dateB) {
  if (!dateA || !dateB) return false
  const a = new Date(dateA)
  const b = new Date(dateB)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// items 중에서 dateField 값이 referenceDate와 같은 날인 것만 추림
export function filterToday(items, dateField, referenceDate) {
  return (items || []).filter((item) => isSameDay(item[dateField], referenceDate))
}

function formatDateKo(date) {
  return new Date(date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

/**
 * 오늘의 콘텐츠/검수/벤치마킹 데이터를 모아 브리핑 텍스트를 만듭니다.
 * @param {object} params
 * @param {Date|string} params.referenceDate - 기준 날짜 (기본: 지금)
 * @param {object[]} params.drafts - content_drafts 전체 목록
 * @param {object[]} params.reviews - review_log 전체 목록
 * @param {object[]} params.benchmarks - benchmark_reports 전체 목록
 */
export function buildBriefingText({ referenceDate = new Date(), drafts = [], reviews = [], benchmarks = [] } = {}) {
  const todayDrafts = filterToday(drafts, 'created_at', referenceDate)
  const publishedToday = filterToday(drafts, 'published_at', referenceDate)
  const todayReviews = filterToday(reviews, 'checked_at', referenceDate)
  const todayBenchmarks = filterToday(benchmarks, 'collected_at', referenceDate)

  const passedReviews = todayReviews.filter((r) => r.result === '통과')
  const rejectedReviews = todayReviews.filter((r) => r.result === '반려')

  // 오늘 만들어진 것만이 아니라, 자동 파이프라인이 만들어 놓고 아직 사용자 확인을 못 받은 것 전부
  // (검수중/통과/반려) - "무슨 상품을 어떻게 처리 중인지" 한눈에 보여주는 게 이 섹션의 목적
  const actionable = (drafts || []).filter((d) => ['통과', '반려', '검수중'].includes(d.status))
  const actionOrder = { 반려: 0, 통과: 1, 검수중: 2 }
  actionable.sort((a, b) => actionOrder[a.status] - actionOrder[b.status])

  const lines = []
  lines.push(`📋 애니원 아침 브리핑 - ${formatDateKo(referenceDate)}`)
  lines.push('')

  lines.push('■ 지금 확인이 필요해요')
  if (actionable.length === 0) {
    lines.push('- 지금 확인이 필요한 항목이 없어요.')
  } else {
    for (const d of actionable) {
      const hint =
        d.status === '반려'
          ? `반려 사유: ${d.reject_reason || '사유 미기재'}`
          : d.status === '통과'
            ? '발행해주세요'
            : '검수 대기 중'
      lines.push(`- [${d.status}] ${d.title || '(제목 없음)'} (${d.platform || '채널 미기재'}) - ${hint}`)
    }
  }
  lines.push('')

  lines.push('■ 오늘 콘텐츠 현황')
  if (todayDrafts.length === 0 && publishedToday.length === 0) {
    lines.push('- 오늘 새로 등록되거나 발행된 콘텐츠가 없어요.')
  } else {
    if (todayDrafts.length > 0) lines.push(`- 오늘 새로 등록된 초안: ${todayDrafts.length}건`)
    if (publishedToday.length > 0) {
      lines.push(`- 오늘 발행 완료: ${publishedToday.length}건`)
      for (const d of publishedToday) lines.push(`  · ${d.title}`)
    }
  }
  lines.push('')

  lines.push('■ 검수 결과')
  if (todayReviews.length === 0) {
    lines.push('- 오늘 진행된 검수가 없어요.')
  } else {
    lines.push(`- 통과 ${passedReviews.length}건 / 반려 ${rejectedReviews.length}건`)
    for (const r of rejectedReviews) {
      lines.push(`  · [반려] ${r.check_type || '검수'} - ${r.reason || '사유 미기재'}`)
    }
  }
  lines.push('')

  lines.push('■ 벤치마킹 발견 사항')
  if (todayBenchmarks.length === 0) {
    lines.push('- 오늘 수집된 벤치마킹 항목이 없어요.')
  } else {
    for (const b of todayBenchmarks) {
      lines.push(`- ${b.keyword} (${b.platform || '플랫폼 미기재'}${b.popularity_score != null ? `, 인기도 ${b.popularity_score}` : ''})`)
    }
  }

  return lines.join('\n')
}

// 브리핑 내용을 바탕으로 루나 요청서 초안을 빠르게 만들 때 쓰는 기본값
export function buildLunaRequestFromBriefing(briefingText, referenceDate = new Date()) {
  const dateLabel = new Date(referenceDate).toLocaleDateString('ko-KR')
  return {
    request_title: `${dateLabel} 브리핑 기반 요청`,
    department: '아트본부',
    status: '요청 작성',
    note: briefingText,
  }
}
