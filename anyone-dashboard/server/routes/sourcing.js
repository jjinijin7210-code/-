import { Router } from 'express'
import { search1688Products } from '../lib/sourcingClient.js'

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

export default router
