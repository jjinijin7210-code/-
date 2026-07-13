// Luna 조직도 관련 데이터 로직을 Node.js에서 실제로 실행해보는 테스트.
// (LunaStudio.jsx 안의 useEffect 시딩 로직과 동일한 순서로 직접 재현해서 검증합니다.
//  React 컴포넌트 자체의 렌더링은 브라우저가 없어 여기서 확인하지 못합니다 - README 참고)
// 실행: node scripts/test-luna-staff.mjs

import assert from 'node:assert/strict'
import { createLocalStore } from '../src/lib/localStore.js'
import { DEFAULT_ROSTER, DEPARTMENT_ORDER, LUNA_STATUS_OPTIONS } from '../src/data/lunaRoster.js'

function makeFakeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  }
}

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ❌ ${name}`)
    console.log(`     -> ${e.message}`)
    process.exitCode = 1
  }
}

console.log('=== 1. 기본 조직도 데이터 자체 검증 ===')
check('DEFAULT_ROSTER는 18명 (디렉터 1 + 6개 본부)', () => {
  assert.equal(DEFAULT_ROSTER.length, 18)
})
check('모든 구성원의 department가 DEPARTMENT_ORDER 안에 있음', () => {
  for (const person of DEFAULT_ROSTER) {
    assert.ok(DEPARTMENT_ORDER.includes(person.department), `${person.role_name}의 부서 ${person.department}가 목록에 없음`)
  }
})
check('요청하신 부서별 인원 수가 정확함 (아트4/영상3/콘텐츠3/브랜드2/QA3/연구소2/디렉터1)', () => {
  const countBy = (dept) => DEFAULT_ROSTER.filter((p) => p.department === dept).length
  assert.equal(countBy('디렉터'), 1)
  assert.equal(countBy('아트본부'), 4)
  assert.equal(countBy('영상본부'), 3)
  assert.equal(countBy('콘텐츠본부'), 3)
  assert.equal(countBy('브랜드본부'), 2)
  assert.equal(countBy('QA본부'), 3)
  assert.equal(countBy('연구소'), 2)
})
check('업무 상태 옵션이 9단계 그대로임', () => {
  assert.deepEqual(LUNA_STATUS_OPTIONS, [
    '대기', '업무 접수', '작업 중', '내부 검수 중', '수정 중', '교차 검수 중', '진희 승인 대기', '완료', '반려',
  ])
})

console.log('=== 2. 시딩(seed) 로직 - LunaStudio.jsx의 useEffect와 동일하게 재현 ===')
{
  const store = createLocalStore(makeFakeStorage())

  check('빈 테이블에 18명을 insert하면 모두 성공', () => {
    for (const person of DEFAULT_ROSTER) {
      const res = store.insert('luna_staff', { ...person, status: '대기' })
      assert.equal(res.ok, true)
    }
    assert.equal(store.getAll('luna_staff').length, 18)
  })

  check('부서별로 grouping 했을 때 인원 수가 화면에 표시될 개수와 일치', () => {
    const rows = store.getAll('luna_staff')
    const grouped = DEPARTMENT_ORDER.map((dept) => ({
      department: dept,
      members: rows.filter((r) => r.department === dept),
    })).filter((g) => g.members.length > 0)
    const total = grouped.reduce((sum, g) => sum + g.members.length, 0)
    assert.equal(total, 18)
    assert.equal(grouped.length, 7) // 디렉터 + 6개 본부
  })

  check('한 명의 상태를 "작업 중"으로 바꾸면 해당 레코드만 갱신됨', () => {
    const rows = store.getAll('luna_staff')
    const target = rows.find((r) => r.role_name === '캐릭터 디자이너')
    const res = store.update('luna_staff', target.id, { status: '작업 중', current_task: 'June 캐릭터 정면 이미지 제작' })
    assert.equal(res.ok, true)
    assert.equal(res.record.status, '작업 중')

    const others = store.getAll('luna_staff').filter((r) => r.id !== target.id)
    assert.ok(others.every((r) => r.status === '대기'), '다른 직원 상태는 영향받지 않아야 함')
  })

  check('이미 18명이 있는 상태에서 다시 시딩 로직을 돌리면(=빈 테이블 아님) 추가로 채워지면 안 됨', () => {
    // LunaStudio.jsx는 rows.length > 0이면 시딩을 건너뜀 - 그 조건만 재현해서 확인
    const rows = store.getAll('luna_staff')
    const shouldSeed = rows.length === 0
    assert.equal(shouldSeed, false)
  })
}

console.log(`\n총 ${passed}개 테스트 통과`)
