import { expect, type Page, test } from '@playwright/test'

// What went wrong on a page while it rendered: an exception nobody caught, an error on the console.
function errorsOf(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()} (${message.location().url})`)
  })
  return errors
}

// Long enough for a few of the mock's snapshots, one a second, to go through the page.
const A_FEW_SNAPSHOTS_MS = 3000

test('the Operator view renders on the mock feed, without a runtime error', async ({ page }) => {
  const errors = errorsOf(page)

  await page.goto('/')

  await expect(page.locator('[data-connection]')).toHaveAttribute('data-connection', 'open')
  // The Status the Command Post computes, and the Readings of its last snapshot.
  await expect(page.locator('[data-slot=card] [data-status]')).toHaveAttribute(
    'data-status',
    /^(nominal|elevated|critical)$/,
  )
  await expect(page.getByText(/^\d+[,.]\d °C$/)).toBeVisible()
  // The curves are drawn.
  await expect(page.locator('.recharts-surface').first()).toBeVisible()

  await page.waitForTimeout(A_FEW_SNAPSHOTS_MS)
  expect(errors).toEqual([])
})

test('the Digital Twin renders on the mock feed, without a runtime error', async ({ page }) => {
  const errors = errorsOf(page)

  await page.goto('/twin')

  await expect(page.locator('[data-connection]')).toHaveAttribute('data-connection', 'open')
  await expect(page.locator('.stage-caption')).toContainText(/Outpost Status: (nominal|elevated|critical) · Gas: \d+/)

  // The scene has a WebGL context, alive, with something to draw into.
  const canvas = page.locator('.stage canvas')
  await expect(canvas).toBeVisible()
  await page.waitForTimeout(A_FEW_SNAPSHOTS_MS)
  const gl = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('webgl2')
    return context && { lost: context.isContextLost(), pixels: context.drawingBufferWidth * context.drawingBufferHeight }
  })
  expect(gl).not.toBeNull()
  expect(gl?.lost).toBe(false)
  expect(gl?.pixels).toBeGreaterThan(0)

  expect(errors).toEqual([])
})
