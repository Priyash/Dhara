import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { errorHandler } from '../src/middleware/errorHandler.js'

const makeRes = () => {
  const res = { statusCode: null, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json   = (body)  => { res.body = body }
  return res
}

describe('errorHandler', () => {
  it('uses err.status when present', () => {
    const res = makeRes()
    errorHandler({ status: 404, message: 'Not found' }, { method: 'GET', path: '/x' }, res, () => {})
    assert.equal(res.statusCode, 404)
    assert.equal(res.body.error, 'Not found')
  })

  it('falls back to err.statusCode', () => {
    const res = makeRes()
    errorHandler({ statusCode: 422, message: 'Unprocessable' }, { method: 'POST', path: '/x' }, res, () => {})
    assert.equal(res.statusCode, 422)
  })

  it('defaults to 500 when no status on error', () => {
    const res = makeRes()
    errorHandler({ message: 'Unexpected' }, { method: 'POST', path: '/x' }, res, () => {})
    assert.equal(res.statusCode, 500)
  })
})
