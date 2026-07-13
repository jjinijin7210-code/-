import { useEffect, useRef, useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import AttachmentSection from '../components/AttachmentSection'
import { LoadingView, ErrorView } from '../components/StateViews'
import { BRAND_TEXT_FIELDS, getEmptyBrand, getDefaultBrandSeeds } from '../data/brandCenter'

const LOGO_KIND = [{ key: 'logo', label: '로고 파일' }]

export default function BrandCenter() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('brands', {
    orderBy: 'name',
    ascending: true,
  })
  const confirm = useConfirm()
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const seededRef = useRef(false)

  // 브랜드 테이블이 비어있으면(=처음 사용) 요청하신 5개 브랜드로 자동 시딩 (한 번만)
  useEffect(() => {
    if (loading || seededRef.current || rows.length > 0) return
    seededRef.current = true
    ;(async () => {
      for (const brand of getDefaultBrandSeeds()) {
        await insertRow(brand)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows.length])

  const openEdit = (row) => {
    setEditing(row)
    setForm({ ...getEmptyBrand(row.name), ...row, logo: row.logo || [] })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    await updateRow(editing.id, form)
    setEditing(null)
  }

  const handleAddBrand = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    await insertRow(getEmptyBrand(newName.trim()))
    setNewName('')
    setAddOpen(false)
  }

  const handleDelete = async () => {
    const ok = await confirm(`"${editing.name}" 브랜드를 삭제할까요?`)
    if (!ok) return
    await deleteRow(editing.id)
    setEditing(null)
  }

  return (
    <div>
      <PageHeader
        title="브랜드 센터"
        emoji="🏷️"
        description="AnyOne · Luna Creative Studio · June · 트롯충전소 · 제나 스튜디오 - 브랜드별 색상/폰트/말투/스타일 가이드"
        onAddClick={() => setAddOpen(true)}
        addLabel="브랜드 추가"
      />

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => openEdit(row)}
            className="rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
          >
            <p className="font-semibold">{row.name}</p>
            <p className="mt-1 truncate text-xs text-ink/50">{row.tone || '말투 미입력'}</p>
            <p className="mt-1 truncate text-xs text-ink/40">{row.default_hashtags || '해시태그 미입력'}</p>
          </button>
        ))}
      </div>

      {/* 새 브랜드 추가 */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="브랜드 추가">
        <form onSubmit={handleAddBrand}>
          <FormField label="브랜드명" required value={newName} onChange={setNewName} />
          <div className="mt-4 flex justify-end">
            <button type="submit" className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90">
              추가
            </button>
          </div>
        </form>
      </Modal>

      {/* 브랜드 상세/수정 */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.name}>
        {form && (
          <form onSubmit={handleSave}>
            <div className="my-2">
              <p className="mb-2 text-xs font-bold text-ink/70">로고</p>
              <AttachmentSection attachments={form.logo} kinds={LOGO_KIND} onChange={(next) => setForm({ ...form, logo: next })} />
            </div>

            {BRAND_TEXT_FIELDS.map((f) => (
              <FormField
                key={f.key}
                label={f.label}
                type={f.type}
                hint={f.hint}
                value={form[f.key]}
                onChange={(v) => setForm({ ...form, [f.key]: v })}
              />
            ))}

            <div className="mt-4 flex items-center justify-between">
              <button type="button" onClick={handleDelete} className="text-sm text-stamp-reject hover:underline">
                브랜드 삭제
              </button>
              <div className="ml-auto flex items-center gap-3">
                <SaveStatusIndicator status={saveStatus} />
                <button type="submit" className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90">
                  저장
                </button>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
