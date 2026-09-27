#!/usr/bin/env node
/**
 * Reproducible 30-second AirDnD hook capture.
 *
 * Usage:
 *   node scripts/capture_demo.mjs
 * Environment:
 *   AIRDND_APP_URL=http://127.0.0.1:5173
 *   AIRDND_OUTPUT_DIR=presentation/captures
 *   AIRDND_EVIDENCE_PATH=/absolute/path/to/final-report.json
 *   AIRDND_HEADLESS=1
 *   AIRDND_SELECTORS=/absolute/path/to/selectors.json
 */
import { access, mkdir, readFile, rename } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(JSON.stringify({ ok: false, error: 'Missing Node dependency: playwright', install: 'npm install --save-dev playwright && npx playwright install chromium' }, null, 2));
  process.exit(2);
}
const appUrl = process.env.AIRDND_APP_URL || 'http://127.0.0.1:5173';
const outputDir = path.resolve(repo, process.env.AIRDND_OUTPUT_DIR || 'presentation/captures');
const evidencePath = process.env.AIRDND_EVIDENCE_PATH ? path.resolve(process.env.AIRDND_EVIDENCE_PATH) : null;
const headless = process.env.AIRDND_HEADLESS !== '0';
const viewport = { width: 1920, height: 1080 };
const hookSeconds = 30;

const defaults = {
  mapReady: '[data-testid="map-ready"]',
  overview: '[data-testid="view-overview"]',
  blackoutStrip: '[data-testid="blackout-status"]',
  naiveReplay: '[data-testid="replay-naive"]',
  airDnDReplay: '[data-testid="replay-airdnd"]',
  interceptorView: '[data-testid="perspective-interceptor"]',
  decisionInspector: '[data-testid="decision-inspector"]',
  rvoTrace: '[data-testid="rvo-trace"]',
  missReplay: '[data-testid="replay-miss"]',
  observerView: '[data-testid="perspective-observer"]',
  evidencePage: '[data-testid="nav-evidence"]',
  evidenceStatus: '[data-testid="evidence-status"]',
};

async function selectorMap() {
  if (!process.env.AIRDND_SELECTORS) return defaults;
  const override = JSON.parse(await readFile(path.resolve(process.env.AIRDND_SELECTORS), 'utf8'));
  return { ...defaults, ...override };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function commandExists(command) {
  return new Promise(resolve => {
    const child = spawn(command, ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', code => resolve(code === 0));
  });
}

await mkdir(outputDir, { recursive: true });
const selectors = await selectorMap();
let browser;
let context;
let rawVideo;
const errors = [];

try {
  // Readiness is checked outside the recorded context so startup time is never
  // presented as part of the 30-second hook.
  browser = await chromium.launch({ headless });
  const probe = await browser.newPage({ viewport });
  const response = await probe.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  if (!response || !response.ok()) throw new Error(`App readiness failed at ${appUrl}`);
  await probe.locator(selectors.overview).waitFor({ state: 'visible', timeout: 10_000 });
  await probe.locator(selectors.mapReady).waitFor({ state: 'attached', timeout: 30_000 });
  await probe.close();
  await browser.close();

  browser = await chromium.launch({ headless });
  context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    recordVideo: { dir: outputDir, size: viewport },
  });
  const page = await context.newPage();
  const recordingStarted = performance.now();
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.locator(selectors.overview).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(selectors.mapReady).waitFor({ state: 'attached', timeout: 30_000 });

  if (evidencePath) {
    await access(evidencePath, fsConstants.R_OK);
    await page.addInitScript(payload => localStorage.setItem('airdnd.finalEvidence', payload), await readFile(evidencePath, 'utf8'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator(selectors.mapReady).waitFor({ state: 'attached', timeout: 30_000 });
  }

  const cueOffsetSeconds = (performance.now() - recordingStarted) / 1000;
  const cueStart = performance.now();
  const at = async (seconds, task) => {
    const remaining = cueStart + seconds * 1000 - performance.now();
    if (remaining > 0) await page.waitForTimeout(remaining);
    await task();
  };
  const click = async key => {
    const target = page.locator(selectors[key]);
    await target.waitFor({ state: 'visible', timeout: 2_000 });
    await target.click({ timeout: 2_000 });
  };
  const shot = async name => page.screenshot({ path: path.join(outputDir, `${name}.png`), animations: 'disabled' });

  // Exact storyboard contract: each action is anchored to cue time rather than
  // chained delays, so minor rendering variance does not accumulate.
  await at(0, async () => { await click('overview'); await shot('00-raid-overview'); });
  await at(5, async () => { await page.locator(selectors.blackoutStrip).waitFor({ state: 'visible', timeout: 2_000 }); await shot('05-zero-rf'); });
  await at(10, async () => { await click('naiveReplay'); await shot('10-naive-duplicate-pursuit'); });
  await at(15, async () => { await click('airDnDReplay'); await click('interceptorView'); await shot('15-local-intent'); });
  await at(19, async () => { await page.locator(selectors.decisionInspector).waitFor({ state: 'visible', timeout: 2_000 }); await page.locator(selectors.rvoTrace).waitFor({ state: 'visible', timeout: 2_000 }); await shot('19-decision-and-rvo'); });
  await at(23, async () => { await click('missReplay'); await click('observerView'); await shot('23-miss-recovery'); });
  await at(27, async () => { await click('evidencePage'); await page.locator(selectors.evidenceStatus).waitFor({ state: 'visible', timeout: 2_000 }); await shot('27-evidence-freeze'); });
  await at(hookSeconds, async () => {});

  const video = page.video();
  await page.close();
  await context.close();
  rawVideo = await video.path();
  const stableRaw = path.join(outputDir, 'airdnd-hook-raw.webm');
  if (path.resolve(rawVideo) !== path.resolve(stableRaw)) await rename(rawVideo, stableRaw);

  if (!await commandExists('ffmpeg')) {
    throw new Error('ffmpeg is required to trim the Playwright recording to exactly 30.000 seconds. Raw capture was preserved.');
  }
  const finalVideo = path.join(outputDir, 'airdnd-hook-30s.webm');
  await run('ffmpeg', ['-y', '-ss', cueOffsetSeconds.toFixed(3), '-i', stableRaw, '-an', '-vf', 'tpad=stop_mode=clone:stop_duration=0.08', '-r', '25', '-frames:v', '749', '-c:v', 'libvpx-vp9', '-crf', '28', '-b:v', '0', finalVideo]);
  console.log(JSON.stringify({ ok: true, appUrl, duration_seconds: hookSeconds, video: finalVideo, screenshots: 7 }, null, 2));
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  console.error(JSON.stringify({ ok: false, appUrl, errors, hint: 'Start the app, satisfy the data-testid contract in presentation/README.md, and retry.' }, null, 2));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}
