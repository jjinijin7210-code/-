import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'

const PLATFORM_OPTIONS = ['블로그', '스레드', '유튜브']
const SOURCE_OPTIONS = ['공식 API', '트렌드 도구']
const CATEGORY_OPTIONS = ['인테리어/생활용품', '푸드쇼핑']

const emptyForm = {
  keyword: '',
  platform: PLATFORM_OPTIONS[0],
  source_type: SOURCE_OPTIONS[0],
  category: CATEGORY_OPTIONS[0],
  popularity_score: '',
  note: '',
}

export default function BenchmarkReports() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('benchmark_reports', {
    orderBy: 'collected_at',
  })
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)

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
    if (editing) await updateRow(editing.id, form)
    else await insertRow(form)
    setModalOpen(false)
  }

  return (
    <div>
      <PageHeader
        title="벤치마킹 리포트"
        emoji="🔍"
        description="리서처가 찾은 인기 키워드·주제 (매일 오전 10시 리포트 대상)"
        onAddClick={openAdd}
        addLabel="리포트 추가"
      />

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && rows.length === 0 && <EmptyView />}

      {/* 푸드 카테고리 이미지 소싱 원칙 리마인더 */}
      <div className="mb-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-ink/60">
        💡 푸드 상품 후보는 도매 사이트(1688, 도매꾹 등)·도우인 이미지만 참고하고, 한국 사이트 이미지는 사용하지 않아요.
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => openEdit(row)}
            className="block w-full rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{row.keyword}</span>
              {row.popularity_score != null && (
                <span className="stamp-badge border-stamp-amber text-stamp-amber bg-stamp-amber/5">
                  인기도 {row.popularity_score}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/50">
              <span>{row.platform}</span>
              <span>·</span>
              <span>{row.source_type}</span>
              <span>·</span>
              <span>{row.category}</span>
            </div>
            {row.note && <p className="mt-1 text-xs text-ink/60">{row.note}</p>}
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '리포트 수정' : '리포트 추가'}>
        <form onSubmit={handleSave}>
          <FormField label="키워드" required value={form.keyword} onChange={(v) => setForm({ ...form, keyword: v })} />
          <div className="grid grid-cols-2 gap-2">
            <FormField
              label="플랫폼"
              type="select"
              options={PLATFORM_OPTIONS}
              value={form.platform}
              onChange={(v) => setForm({ ...form, platform: v })}
            />
            <FormField
              label="수집 방식"
              type="select"
              options={SOURCE_OPTIONS}
              value={form.source_type}
              onChange={(v) => setForm({ ...form, source_type: v })}
            />
          </div>
          <FormField
            label="카테고리"
            type="select"
            options={CATEGORY_OPTIONS}
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
          />
          <FormField
            label="인기도 점수"
            type="number"
            value={form.popularity_score}
            onChange={(v) => setForm({ ...form, popularity_score: v })}
          />
          <FormField label="메모" type="textarea" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 리포트를 삭제할까요? 휴지통으로 이동해요.')
                  if (!ok) return
                  await deleteRow(editing.id)
                  setModalOpen(false)
                }}
                className="text-sm text-stamp-reject hover:underline"
              >
                삭제
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              <SaveStatusIndicator status={saveStatus} />
              <button type="submit" className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90">
                저장
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
