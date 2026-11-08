/**
 * What the showcase records (clips) and how the video is cut (scenes).
 * Everything runs against the mock/demo build: demo data only, no real Home
 * Assistant, no real names, tokens or photos.
 */

export const PORTRAIT = { width: 390, height: 844 }
export const LANDSCAPE = { width: 844, height: 390 }

export const TAGLINE = 'An iOS-style wall and guest dashboard for Home Assistant, installable as a web app.'

const dock = (page) => page.locator('nav.liquid-dock__nav button')

async function centre(page, selector, behavior = 'instant') {
  await page.locator(selector).first().evaluate((el, b) => el.scrollIntoView({ block: 'center', behavior: b }), behavior)
}

/** Drag along an arc around the centre of `box` (angles in degrees, 0 = right, clockwise). */
async function arcDrag(page, box, from, to, steps = 40) {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const r = Math.min(box.width, box.height) * 0.42
  const at = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)]
  await page.mouse.move(...at(from))
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(...at(from + ((to - from) * i) / steps))
    await page.waitForTimeout(25)
  }
  await page.mouse.up()
}

/**
 * Clips: one page load each, recorded with the CDP screencast.
 *   prepare(page)  runs before recording starts (not in the clip)
 *   run(page)      the recorded part
 */
export const CLIPS = [
  {
    name: 'home',
    url: '/?lang=en&safe=59,34&theme=light',
    run: async (page) => {
      await page.waitForTimeout(900)
      for (const i of [1, 2, 3, 0]) {
        await dock(page).nth(i).click()
        await page.waitForTimeout(1200)
      }
    },
  },
  {
    name: 'controls',
    url: '/?lang=en&safe=59,34&theme=light',
    run: async (page) => {
      await page.waitForTimeout(500)
      await page.getByText('Lampa', { exact: true }).first().click() // tap a light tile
      await page.waitForTimeout(900)
      await centre(page, '.dial-tile', 'smooth')
      await page.waitForTimeout(900)
      const box = await page.locator('.dial-tile svg.dial-svg').first().boundingBox()
      await arcDrag(page, box, -100, -30)
      await page.waitForTimeout(300)
      await arcDrag(page, box, -30, -70, 25)
      await page.waitForTimeout(900)
    },
  },
  ...['card', 'plain', 'lockscreen', 'glass'].map((style) => ({
    name: `header-${style}`,
    url: `/?lang=en&safe=59,34&theme=light&headerStyle=${style}`,
    run: (page) => page.waitForTimeout(1500),
  })),
  { name: 'theme-light', url: '/?lang=en&safe=59,34&theme=light', run: (page) => page.waitForTimeout(2300) },
  { name: 'theme-dark', url: '/?lang=en&safe=59,34&theme=dark', colorScheme: 'dark', run: (page) => page.waitForTimeout(2300) },
  // obviously fake pairing code; the mock build never contacts a Home Assistant
  { name: 'guest-pair', url: '/?lang=en&safe=59,34#pair=DEMO-0000-FAKE', ready: 'body', run: (page) => page.waitForTimeout(1800) },
  {
    name: 'guest-limit',
    url: '/?lang=en&safe=59,34&guest=1',
    run: async (page) => {
      await page.waitForTimeout(700)
      await centre(page, 'svg.dial-svg', 'smooth')
      await page.waitForTimeout(900)
      const box = await page.locator('svg.dial-svg').first().boundingBox()
      await page.mouse.click(box.x + box.width - 4, box.y + box.height - 4) // 30 °C, the demo pass allows 25
      await page.locator('[data-testid="guest-toast"]').waitFor({ state: 'visible', timeout: 5000 })
      await page.waitForTimeout(2600)
    },
  },
  {
    name: 'wide',
    url: '/?lang=en&theme=light&safe=0,59,21,59',
    viewport: LANDSCAPE,
    run: async (page) => {
      await page.waitForTimeout(1000)
      for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft']) {
        await page.keyboard.press(key)
        await page.waitForTimeout(1300)
      }
    },
  },
  {
    name: 'vinyl',
    url: '/?lang=en&safe=59,34&theme=dark',
    colorScheme: 'dark',
    prepare: async (page) => {
      await dock(page).filter({ hasText: 'Přehled' }).click() // the demo overview page
      await page.waitForTimeout(800)
      await centre(page, '[data-media-stage="vinyl"]')
    },
    run: (page) => page.waitForTimeout(2800),
  },
  {
    name: 'library',
    url: '/?lang=en&safe=59,34&theme=dark',
    colorScheme: 'dark',
    prepare: async (page) => {
      await dock(page).filter({ hasText: 'Přehled' }).click()
      await page.waitForTimeout(800)
      await centre(page, '[data-library-tile="trending"]')
    },
    run: async (page) => {
      await page.waitForTimeout(600)
      await page.locator('[data-library-tile="trending"] .lib-poster-btn').first().click()
      await page.locator('[data-library-sheet]').waitFor()
      await page.waitForTimeout(2200)
    },
  },
]

/**
 * Scenes in order; durations in seconds. A part takes `dur` seconds of a clip,
 * starting `from` seconds in (a short clip holds its last frame). `fade` cross-
 * fades into the next part. `real: true` marks where showcase/real/*.mp4 goes.
 */
export const SCENES = [
  { name: '01-title', dur: 3, card: 'title' },
  { name: '02-rooms', dur: 6, caption: 'Rooms, one tap away', parts: [{ clip: 'home', from: 0.3, dur: 6 }] },
  { name: '03-controls', dur: 5, caption: 'Native-feeling controls', parts: [{ clip: 'controls', from: 0.2, dur: 5 }] },
  {
    name: '04-style',
    dur: 5,
    caption: 'Your style',
    parts: ['card', 'plain', 'lockscreen', 'glass'].map((s) => ({ clip: `header-${s}`, from: 0.2, dur: 1.25 })),
  },
  {
    name: '05-theme',
    dur: 4,
    caption: 'Light and dark',
    parts: [
      { clip: 'theme-light', from: 0.2, dur: 2, fade: 0.4 },
      { clip: 'theme-dark', from: 0.2, dur: 2 },
    ],
  },
  {
    name: '06-guest',
    dur: 6,
    caption: 'Locked-down mode for guests',
    parts: [
      { clip: 'guest-pair', from: 0.2, dur: 1.5 },
      { clip: 'guest-limit', from: 0.3, dur: 4.5 },
    ],
  },
  { name: '07-wide', dur: 5, caption: 'Tablets and wall panels', landscape: true, parts: [{ clip: 'wide', from: 0.3, dur: 5 }] },
  { name: 'real', real: true },
  {
    name: '08-media',
    dur: 5,
    caption: 'Music and media in one place',
    parts: [
      { clip: 'vinyl', from: 0.2, dur: 2.5 },
      { clip: 'library', from: 0.2, dur: 2.5 },
    ],
  },
  { name: '09-end', dur: 4, card: 'end' },
]

/** README hero GIF: home -> tile/dial -> theme switch, about 8 s. */
export const GIF_PARTS = [
  { clip: 'home', from: 0.3, dur: 2.6 },
  { clip: 'controls', from: 1.8, dur: 3.2 },
  { clip: 'theme-light', from: 0.2, dur: 1 },
  { clip: 'theme-dark', from: 0.2, dur: 1.2 },
]
