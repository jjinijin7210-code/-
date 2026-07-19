import { Router } from 'express'
import { search1688Products } from '../lib/sourcingClient.js'
import { searchCoupangProducts } from '../lib/coupangClient.js'
import { fetchSourcingImageAsDataUrl } from '../lib/sourcingImageFetcher.js'

const router = Router()

router.get('/sourcing/1688', async (req, res) => {
  const { q, maxProducts, sortType } = req.query

  if (!q || !String(q).trim()) {
    return res.status(400).json({ error: '검색어(q)는 필수예요.' })
  }

  try {
    const products = await search1688Products({
      query: q,
      maxProducts: maxProducts ? Number(maxProducts) : undefined,
      sortType: sortType || undefined,
    })
    res.json({ products })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 1688에서 소싱한 상품이 실제로 쿠팡에도 팔리고 있는지 확인 (있어야 구매 링크를 붙일 수 있음)
router.get('/sourcing/coupang', async (req, res) => {
  const { q } = req.query

  if (!q || !String(q).trim()) {
    return res.status(400).json({ error: '검색어(q)는 필수예요.' })
  }

  try {
    const products = await searchCoupangProducts({ query: q })
    res.json({ products })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 소싱 검색 결과의 상품 이미지를 첨부용 data URL로 변환
router.get('/sourcing/fetch-image', async (req, res) => {
  const { url } = req.query
  if (!url) {
    return res.status(400).json({ error: '이미지 주소(url)는 필수예요.' })
  }
  try {
    const dataUrl = await fetchSourcingImageAsDataUrl(String(url))
    res.json({ dataUrl })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
