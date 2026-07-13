import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { createLocalStore } from '../lib/localStore'

// localStorage 어댑터는 앱 전체에서 하나만 만들어 재사용
let localStoreSingleton = null
function getLocalStore() {
  if (!localStoreSingleton && typeof window !== 'undefined') {
    localStoreSingleton = createLocalStore(window.localStorage)
  }
  return localStoreSingleton
}

/**
 * 데이터 CRUD 공통 훅.
 * - Supabase가 설정되어 있으면 실제 DB(Postgres)를 사용
 * - 설정되어 있지 않으면 브라우저 localStorage를 자동으로 사용 (일반 브라우저에서 바로 실행 가능)
 *
 * 반환값의 backend 필드로 지금 어떤 저장소를 쓰고 있는지 확인할 수 있습니다.
 */
export function useSupabaseTable(tableName, options = {}) {
  const { orderBy = 'created_at', ascending = false } = options
  const backend = isSupabaseConfigured ? 'supabase' : 'local'

  const [rows, setRows] = useState([])
  const [trash, setTrash] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saveStatus, setSaveStatus] = useState('idle') // idle | saving | saved | error

  const sortRows = useCallback(
    (list) => {
      return [...list].sort((a, b) => {
        const av = a[orderBy]
        const bv = b[orderBy]
        if (av === bv) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return ascending ? (av > bv ? 1 : -1) : av < bv ? 1 : -1
      })
    },
    [orderBy, ascending]
  )

  const flashSaved = () => {
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 1500)
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)

    if (backend === 'local') {
      const store = getLocalStore()
      setRows(sortRows(store.getAll(tableName)))
      setTrash(store.getTrash(tableName))
      setLoading(false)
      return
    }

    const { data, error: err } = await supabase
      .from(tableName)
      .select('*')
      .order(orderBy, { ascending })

    if (err) {
      setError(err.message)
      setRows([])
    } else {
      setRows(data ?? [])
    }
    setLoading(false)
  }, [tableName, orderBy, ascending, backend, sortRows])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const insertRow = useCallback(
    async (values) => {
      setSaveStatus('saving')
      try {
        if (backend === 'local') {
          const store = getLocalStore()
          const res = store.insert(tableName, values)
          if (!res.ok) throw new Error(res.error)
          setRows((prev) => sortRows([res.record, ...prev]))
          flashSaved()
          return res.record
        }
        const { data, error: err } = await supabase.from(tableName).insert(values).select()
        if (err) throw err
        setRows((prev) => [...(data ?? []), ...prev])
        flashSaved()
        return data?.[0]
      } catch (e) {
        setSaveStatus('error')
        throw e
      }
    },
    [tableName, backend, sortRows]
  )

  const updateRow = useCallback(
    async (id, values) => {
      setSaveStatus('saving')
      try {
        if (backend === 'local') {
          const store = getLocalStore()
          const res = store.update(tableName, id, values)
          if (!res.ok) throw new Error(res.error)
          setRows((prev) => sortRows(prev.map((r) => (r.id === id ? res.record : r))))
          flashSaved()
          return res.record
        }
        const { data, error: err } = await supabase
          .from(tableName)
          .update(values)
          .eq('id', id)
          .select()
        if (err) throw err
        setRows((prev) => prev.map((r) => (r.id === id ? data?.[0] ?? r : r)))
        flashSaved()
        return data?.[0]
      } catch (e) {
        setSaveStatus('error')
        throw e
      }
    },
    [tableName, backend, sortRows]
  )

  // 삭제 - local 모드는 휴지통으로 이동(복구 가능), supabase 모드는 즉시 삭제
  // (Supabase 쪽 휴지통/복구는 deleted_at 컬럼 + RLS 정책 추가가 필요해 다음 단계 과제로 남겨둠 - 미구현)
  const deleteRow = useCallback(
    async (id) => {
      setSaveStatus('saving')
      try {
        if (backend === 'local') {
          const store = getLocalStore()
          const res = store.softDelete(tableName, id)
          if (!res.ok) throw new Error(res.error)
          setRows((prev) => prev.filter((r) => r.id !== id))
          setTrash(store.getTrash(tableName))
          flashSaved()
          return
        }
        const { error: err } = await supabase.from(tableName).delete().eq('id', id)
        if (err) throw err
        setRows((prev) => prev.filter((r) => r.id !== id))
        flashSaved()
      } catch (e) {
        setSaveStatus('error')
        throw e
      }
    },
    [tableName, backend]
  )

  const restoreRow = useCallback(
    async (id) => {
      if (backend !== 'local') return // Supabase 모드는 아직 미지원
      const store = getLocalStore()
      const res = store.restore(tableName, id)
      if (!res.ok) throw new Error(res.error)
      setRows(sortRows(store.getAll(tableName)))
      setTrash(store.getTrash(tableName))
    },
    [tableName, backend, sortRows]
  )

  const permanentlyDeleteRow = useCallback(
    async (id) => {
      if (backend !== 'local') return
      const store = getLocalStore()
      const res = store.permanentDelete(tableName, id)
      if (!res.ok) throw new Error(res.error)
      setTrash(store.getTrash(tableName))
    },
    [tableName, backend]
  )

  return {
    rows,
    trash,
    loading,
    error,
    saveStatus,
    backend,
    refresh: fetchAll,
    insertRow,
    updateRow,
    deleteRow,
    restoreRow,
    permanentlyDeleteRow,
  }
}
