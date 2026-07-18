import { useEffect, useRef, useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import StatusBadge from '../components/StatusBadge'
import { LoadingView, ErrorView } from '../components/StateViews'
import { DEFAULT_ANYONE_ROSTER, ANYONE_DEPARTMENT_ORDER, ANYONE_TEAM_ORDER, getTeamFromDepartment } from '../data/anyoneRoster'

const STATUS_OPTIONS = ['대기', '작업중', '완료', '이슈발생']

const emptyForm = { department: '콘텐츠 제작', role_name: '', role_emoji: '🤖', status: '대기', current_task: '', note: '' }

export default function EmployeeStatus() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('employee_status', {
    orderBy: 'updated_at',
  })
  const confirm = useConfirm()
  const [openDepartments, setOpenDepartments] = useState(() => new Set(ANYONE_DEPARTMENT_ORDER))
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const seededRef = useRef(false)

  // 테이블이 비어있으면(=처음 사용) 계획서 기준 14명을 자동으로 채워넣음 (한 번만 실행)
  useEffect(() => {
    if (loading || seededRef.current || rows.length > 0) return
    seededRef.current = true
    ;(async () => {
      for (const person of DEFAULT_ANYONE_ROSTER) {
        await insertRow({ ...person, status: '대기', current_task: '', note: '' })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows.length])

  const toggleDepartment = (dept) => {
    setOpenDepartments((prev) => {
      const next = new Set(prev)
      if (next.has(dept)) next.delete(dept)
      else next.add(dept)
      return next
    })
  }

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm(row)
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (editing) {
      await updateRow(editing.id, form)
    } else {
      await insertRow(form)
    }
    setModalOpen(false)
  }

  const handleDelete = async () => {
    const ok = await confirm('이 직원 정보를 삭제할까요? 휴지통으로 이동해요.')
    if (!ok) return
    await deleteRow(editing.id)
    setModalOpen(false)
  }

  // 총괄 팀장 아래 채널별 팀(인스타틱톡팀/스레드블로그팀/유튜브팀)으로 먼저 묶고,
  // 그 안에서 다시 부서(리서치/콘텐츠제작/검수 등)로 묶어서 보여줌 (2026-07-19 팀 재편)
  const knownDepartments = new Set(ANYONE_DEPARTMENT_ORDER)
  const extraDepartments = [...new Set(rows.map((r) => r.department).filter((d) => d && !knownDepartments.has(d)))]
  const departmentOrder = [...ANYONE_DEPARTMENT_ORDER, ...extraDepartments]
  const knownTeams = new Set(ANYONE_TEAM_ORDER)
  const extraTeams = [...new Set(departmentOrder.map(getTeamFromDepartment).filter((t) => !knownTeams.has(t)))]
  const teamOrder = [...ANYONE_TEAM_ORDER, ...extraTeams]

  const teamGroups = teamOrder
    .map((team) => {
      const teamDepartments = departmentOrder.filter((d) => getTeamFromDepartment(d) === team)
      const groups = teamDepartments
        .map((dept) => ({ department: dept, members: rows.filter((r) => (r.department || '기타') === dept) }))
        .filter((g) => g.members.length > 0)
      const memberCount = groups.reduce((sum, g) => sum + g.members.length, 0)
      return { team, groups, memberCount }
    })
    .filter((t) => t.memberCount > 0)
  const uncategorized = rows.filter((r) => !r.department)

  return (
    <div>
      <PageHeader
        title="직원 현황 — AnyOne 팀"
        emoji="🧑‍💼"
        description="총괄 팀장 아래 채널별 3개 팀(인스타/틱톡·스레드/블로그·유튜브)의 현재 작업 상태"
        onAddClick={openAdd}
        addLabel="직원 추가"
      />

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}

      {!loading && !error && (
        <div className="space-y-6">
          {teamGroups.map(({ team, groups, memberCount }) => (
            <div key={team}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-stamp-amber">
                {team} <span className="text-xs font-normal text-ink/40">({memberCount}명)</span>
              </h2>
              <div className="space-y-3">
                {groups.map(({ department, members }) => {
                  const isOpen = openDepartments.has(department)
                  return (
                    <div key={department} className="rounded-xl bg-paper-card shadow-card">
                      <button
                        onClick={() => toggleDepartment(department)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left"
                      >
                        <span className="font-semibold text-ink">
                          {department.includes(' · ') ? department.split(' · ')[1] : department}{' '}
                          <span className="ml-1 text-xs font-normal text-ink/40">({members.length})</span>
                        </span>
                        <span className="text-ink/40">{isOpen ? '▾' : '▸'}</span>
                      </button>
                      {isOpen && (
                        <div className="grid grid-cols-1 gap-2 border-t border-ink/5 p-3 sm:grid-cols-2 lg:grid-cols-3">
                          {members.map((row) => (
                            <button
                              key={row.id}
                              onClick={() => openEdit(row)}
                              className="rounded-lg border border-ink/10 p-3 text-left hover:bg-ink/[0.03]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-sm font-medium">
                                  <span aria-hidden>{row.role_emoji}</span>
                                  {row.role_name}
                                </span>
                                <StatusBadge status={row.status} />
                              </div>
                              {row.current_task && <p className="mt-1 truncate text-xs text-ink/50">{row.current_task}</p>}
                              {row.note && <p className="mt-1 truncate text-xs text-ink/30">{row.note}</p>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {uncategorized.length > 0 && (
            <div className="rounded-xl bg-paper-card shadow-card">
              <div className="px-4 py-3 font-semibold text-ink">기타 ({uncategorized.length})</div>
              <div className="grid grid-cols-1 gap-2 border-t border-ink/5 p-3 sm:grid-cols-2 lg:grid-cols-3">
                {uncategorized.map((row) => (
                  <button
                    key={row.id}
                    onClick={() => openEdit(row)}
                    className="rounded-lg border border-ink/10 p-3 text-left hover:bg-ink/[0.03]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <span aria-hidden>{row.role_emoji}</span>
                        {row.role_name}
                      </span>
                      <StatusBadge status={row.status} />
                    </div>
                    {row.current_task && <p className="mt-1 truncate text-xs text-ink/50">{row.current_task}</p>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {grouped.length === 0 && uncategorized.length === 0 && (
            <p className="rounded-lg border border-dashed border-ink/15 py-8 text-center text-sm text-ink/40">
              직원 목록을 불러오는 중이에요...
            </p>
          )}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '직원 정보 수정' : '직원 추가'}>
        <form onSubmit={handleSave}>
          <FormField
            label="부서"
            type="select"
            options={ANYONE_DEPARTMENT_ORDER}
            value={form.department}
            onChange={(v) => setForm({ ...form, department: v })}
          />
          <FormField
            label="역할 이름"
            required
            value={form.role_name}
            onChange={(v) => setForm({ ...form, role_name: v })}
          />
          <FormField
            label="이모지"
            value={form.role_emoji}
            onChange={(v) => setForm({ ...form, role_emoji: v })}
          />
          <FormField
            label="상태"
            type="select"
            options={STATUS_OPTIONS}
            value={form.status}
            onChange={(v) => setForm({ ...form, status: v })}
          />
          <FormField
            label="지금 하는 작업"
            type="textarea"
            value={form.current_task}
            onChange={(v) => setForm({ ...form, current_task: v })}
          />
          <FormField label="메모" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button type="button" onClick={handleDelete} className="text-sm text-stamp-reject hover:underline">
                삭제
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              <SaveStatusIndicator status={saveStatus} />
              <button
                type="submit"
                className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90"
              >
                저장
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
