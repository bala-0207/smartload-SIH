/**
 * UI verification harness.
 *
 * Drives the running dev server in a real browser and checks the things a
 * jsdom smoke test cannot: that nothing overflows horizontally at the required
 * breakpoints, that the prediction band's PLL crossing actually fires, that a
 * fault raised on /simulator reaches /operator, and that the certificate hash
 * chain links successive wagons.
 *
 * Usage:  npm run dev   (in one terminal)
 *         node scripts/verify-ui.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = './shots';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

// ---- Routing: the combined stage is what opens ---------------------------
for (const path of ['/', '/nonsense/deep/path']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const onDemo =
    (await page.locator('section[aria-label="Operator console"]').count()) === 1 &&
    (await page.locator('section[aria-label="Loading physics"]').count()) === 1;
  check(`${path} lands on the demo stage`, onDemo, page.url());
}
{
  await page.goto(`${BASE}/operator`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check('/operator still serves the product on its own route',
    (await page.locator('section[aria-label="Loading physics"]').count()) === 0 &&
    (await page.locator('main > section').count()) === 5);
  await page.goto(`${BASE}/simulator`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check('/simulator still serves on its own route',
    (await page.locator('section[aria-label="Wagon cross-section"]').count()) === 1);
}

// ---- New wagon transition: appears on click, clears itself ---------------
{
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);

  const before = await page.locator('[data-testid="new-wagon-transition"]').count();
  await page.getByRole('button', { name: 'Overload' }).click();
  await page.waitForTimeout(250);

  const banner = page.locator('[data-testid="new-wagon-transition"]').last();
  const shown = (await banner.count()) > 0;
  const text = shown ? (await banner.innerText()).split(String.fromCharCode(10)).join(' ') : '';
  check('scenario click names the new wagon', shown && /NEW WAGON/i.test(text), text);
  check('transition shows a wagon id', /BOXN\d+/.test(text), text);
  check('no confirmation dialog blocks the switch', before === 0 &&
    (await page.locator('[role="dialog"]').count()) === 0);
  await page.screenshot({ path: `${OUT}/demo-new-wagon.png` });

  // Real timers, so the exit transition actually completes here — jsdom with
  // fake timers cannot observe a framer-motion exit, which is why this lives
  // in the browser harness rather than the unit suite.
  await page.waitForTimeout(3000);
  check('transition clears itself',
    (await page.locator('[data-testid="new-wagon-transition"]').count()) === 0);

  // And the console kept reporting throughout.
  const consoleCount = await page.locator('section[aria-label="Operator console"] > section').count();
  check('console stays mounted across a scenario switch', consoleCount === 5, `${consoleCount} elements`);
}

// ---- Fixed-stage routes must not scroll in EITHER axis -------------------
// /operator hangs on a fixed screen in a cab and /demo runs on a projector.
// Anything below the fold does not exist on either.
for (const route of ['operator', 'demo']) {
  await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      sh: document.documentElement.scrollHeight,
      ch: document.documentElement.clientHeight,
    }));
    check(`${route} @${w}x${h} zero scroll`, m.sw <= m.cw + 1 && m.sh <= m.ch + 1,
      `w ${m.sw}/${m.cw}  h ${m.sh}/${m.ch}`);

    // Every one of the five console elements must be inside the viewport.
    const labels = ['Current wagon mass', 'Load status', 'Next best action',
                    'Left right mass distribution', 'Sensor health'];
    let allIn = true;
    let worst = '';
    for (const label of labels) {
      const box = await page.locator(`section[aria-label="${label}"]`).first().boundingBox();
      if (!box) continue;
      if (box.y + box.height > h + 1) { allIn = false; worst = `${label} ends at ${Math.round(box.y + box.height)}`; }
    }
    check(`${route} @${w}x${h} all five elements above the fold`, allIn, worst);
    await page.screenshot({ path: `${OUT}/${route}-${w}x${h}.png` });
  }
}

// ---- Responsive: no horizontal scroll at any required breakpoint ---------
for (const route of ['operator', 'simulator']) {
  await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  for (const w of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => ({
      s: document.documentElement.scrollWidth,
      c: document.documentElement.clientWidth,
    }));
    check(`${route} @${w}px no horizontal scroll`, m.s <= m.c + 1, `${m.s} vs ${m.c}`);
    await page.screenshot({ path: `${OUT}/${route}-${w}.png` });
  }
}

// ---- The status band says SAFE, never LOADING ---------------------------
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/operator`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const bandWord = (await page.locator('section[aria-label="Load status"]').innerText()).trim();
check('status band reports risk level, not loading state',
  ['SAFE', 'CAUTION', 'STOP'].includes(bandWord), bandWord);

// ---- No bare 0% or 100% risk ever reaches the screen ---------------------
{
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  const seen = new Set();
  let bare = null;
  for (let i = 0; i < 130; i += 1) {
    await page.waitForTimeout(500);
    const t = (await page.locator('section[aria-label="Next best action"]').innerText()).trim();
    seen.add(t);
    if (/0%/.test(t) || /100%/.test(t)) { bare = t; break; }
    if ((await page.locator('aside').count()) > 0) break;
  }
  check('never displays a bare 0% or 100% risk', bare === null, bare ?? `${seen.size} distinct actions seen`);
  check('saturated form reached the screen',
    [...seen].some((t) => t.includes('<1%') || t.includes('>99%')),
    [...seen].filter((t) => /[<>]/.test(t))[0] ?? 'none seen this run');
}

// ---- THE DEMO MOMENT: curve flare and status band flip on ONE frame ------
{
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  let sameFrame = null;
  for (let i = 0; i < 260; i += 1) {
    await page.waitForTimeout(250);
    // Read both panels in ONE evaluate, so the sample is a single paint.
    const snap = await page.evaluate(() => {
      const breach = !!document.querySelector('text');
      const flare = Array.from(document.querySelectorAll('text'))
        .some((t) => (t.textContent ?? '').includes('PREDICTED BREACH'));
      const band = (document.querySelector('section[aria-label="Load status"]')?.textContent ?? '').trim();
      void breach;
      return { flare, band };
    });
    if (snap.flare) { sameFrame = snap; break; }
    if ((await page.locator('aside').count()) > 0) break;
  }
  check('demo moment: curve flares the PLL intersection', sameFrame !== null);
  check('demo moment: status band has left SAFE in the same paint',
    sameFrame !== null && sameFrame.band !== 'SAFE', sameFrame ? `band read "${sameFrame.band}"` : 'no flare seen');
  if (sameFrame) await page.screenshot({ path: `${OUT}/demo-moment.png` });
}

// ---- The prediction band crosses PLL before the weight curve does --------
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${BASE}/simulator`, { waitUntil: 'networkidle' });
let flared = false;
for (let i = 0; i < 240; i += 1) {
  await page.waitForTimeout(500);
  if ((await page.locator('text=PREDICTED BREACH').count()) > 0) {
    flared = true;
    await page.screenshot({ path: `${OUT}/sim-crossing.png` });
    break;
  }
  if ((await page.locator('aside').count()) > 0) break;
}
check('prediction band flares on crossing PLL', flared);

// ---- Certificate on /demo overlays the RIGHT column only -----------------
{
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  await page.waitForSelector('aside', { timeout: 180000 });
  await page.waitForTimeout(2500);

  const cert = await page.locator('aside').boundingBox();
  const consoleCol = await page.locator('section[aria-label="Operator console"]').boundingBox();
  const physicsCol = await page.locator('section[aria-label="Loading physics"]').boundingBox();

  check('demo certificate stays inside the physics column',
    !!cert && !!physicsCol && cert.x >= physicsCol.x - 1 &&
      cert.x + cert.width <= physicsCol.x + physicsCol.width + 1,
    cert ? `cert x ${Math.round(cert.x)}..${Math.round(cert.x + cert.width)}` : 'no cert');
  check('demo certificate never covers the operator console',
    !!cert && !!consoleCol && cert.x >= consoleCol.x + consoleCol.width - 1,
    cert && consoleCol ? `console ends ${Math.round(consoleCol.x + consoleCol.width)}, cert starts ${Math.round(cert.x)}` : '');

  // The console keeps reporting underneath it — the certificate is the VERIFY
  // step of the loop, not a modal that ends the demo.
  const weight = await page.locator('section[aria-label="Current wagon mass"]').innerText();
  check('console still readable behind the certificate', /[0-9]/.test(weight),
    weight.split(String.fromCharCode(10)).join(' '));
  await page.screenshot({ path: `${OUT}/demo-certificate.png` });

  // Dismissible, and dismissing restores the physics column.
  await page.locator('aside button[aria-label="Dismiss certificate"]').click();
  await page.waitForTimeout(900);
  check('demo certificate is dismissible', (await page.locator('aside').count()) === 0);
  check('scenario strip usable after dismissal',
    await page.getByRole('button', { name: 'Normal' }).isEnabled());
}

// ---- Certificate + hash chain across two wagons --------------------------
// Self-contained: navigate explicitly and clear the persisted chain, so this
// section does not depend on which route or run state an earlier check left
// behind. An order-dependent check is one that passes for the wrong reason.
await page.goto(`${BASE}/simulator`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}/simulator`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Reset' }).click();
await page.waitForTimeout(800);

async function waitForCert() {
  await page.waitForSelector('aside', { timeout: 180000 });
  await page.waitForTimeout(2200);
  const codes = await page.locator('aside code').allInnerTexts();
  const text = await page.locator('aside').innerText();
  return { prev: codes[0], hash: codes[1], seq: (text.match(/RECORD (\d+)/) || [])[1], text };
}
const a = await waitForCert();
check('certificate issued', !!a.hash, `record ${a.seq}`);
check('genesis prev hash is all zero', /^0{64}$/.test(a.prev));
check('certificate is labelled tamper-evident', /TAMPER-EVIDENT/.test(a.text));
check('certificate never claims tamper-proof', !/TAMPER-PROOF/i.test(a.text));
await page.screenshot({ path: `${OUT}/cert.png`, fullPage: true });

await page.getByRole('button', { name: 'Reset' }).click();
await page.waitForTimeout(800);
const b = await waitForCert();
check('hash chain links wagon 2 to wagon 1', b.prev === a.hash);
check('chain sequence advances', b.seq === '1', `record ${b.seq}`);

// ---- One stream: a fault on /simulator reaches /operator ------------------
await page.getByRole('link', { name: 'Simulator' }).click();
await page.getByRole('button', { name: 'LiDAR Dust Fault' }).click();
await page.waitForTimeout(22000);
await page.getByRole('link', { name: 'Operator' }).click();
await page.waitForTimeout(2000);
const strip = await page.locator('section[aria-label="Sensor health"]').innerText();
check('sensor fault propagates to operator console', /LIDAR/i.test(strip), strip.replace(/\n/g, ' '));
check('degradation names the fallback sensor', /load cells/i.test(strip));
await page.screenshot({ path: `${OUT}/op-dust.png` });

await page.getByRole('link', { name: 'Simulator' }).click();
await page.getByRole('button', { name: 'Uneven Load' }).click();
await page.waitForTimeout(26000);
await page.getByRole('link', { name: 'Operator' }).click();
await page.waitForTimeout(2000);
const action = await page.locator('section[aria-label="Next best action"]').innerText();
check('uneven load yields a side instruction', /NEXT BUCKET (LEFT|RIGHT)/.test(action), action);
check('advice is never a rate instruction', !/rate|reduce|slow/i.test(action));
await page.screenshot({ path: `${OUT}/op-uneven.png` });

// ---- Reduced motion keeps every piece of information visible -------------
const rmCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const rm = await rmCtx.newPage();
await rm.goto(`${BASE}/simulator`, { waitUntil: 'networkidle' });
await rm.waitForTimeout(14000);
const label = await rm.locator('section[aria-label="Wagon cross-section"] svg').getAttribute('aria-label');
check('reduced motion still renders the wagon', /\d+ percent/.test(label ?? ''), label ?? '');
await rm.screenshot({ path: `${OUT}/sim-reduced-motion.png` });
await rmCtx.close();

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
