#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function parseBoolean(input, fallback) {
  if (input == null) return fallback;
  const normalized = String(input).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function parseNumber(input, fallback) {
  if (input == null) return fallback;
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const maybeValue = argv[index + 1];
    if (!maybeValue || maybeValue.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = maybeValue;
    index += 1;
  }
  return args;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    console.error(
      '[playwright-probe] Unable to import `playwright` from current project. ' +
        'Install with: npm install -D playwright && npm exec playwright install chromium',
    );
    throw error;
  }
}

function includesText(events, text) {
  if (!text) return false;
  return events.some((event) => event.type === 'console' && String(event.text || '').includes(text));
}

async function main() {
  const args = parseArgs(process.argv);
  const url = args.url;
  if (!url) {
    console.error('[playwright-probe] Missing --url');
    process.exit(2);
  }

  const outDir = args['out-dir'] ?? 'artifacts';
  const screenshotName = args['screenshot-name'] ?? 'playwright-probe.png';
  const jsonName = args['json-name'] ?? 'playwright-probe.json';
  const clickText = args['click-text'] ?? '';
  const clickSelector = args['click-selector'] ?? '';
  const preWaitMs = parseNumber(args['pre-wait-ms'], 6000);
  const postClickWaitMs = parseNumber(args['post-click-wait-ms'], 7000);
  const clickTimeoutMs = parseNumber(args['click-timeout-ms'], 5000);
  const gotoTimeoutMs = parseNumber(args['goto-timeout-ms'], 60000);
  const successText = args['success-text'] ?? '';
  const failText = args['fail-text'] ?? 'Maximum update depth exceeded';
  const forbidText = args['forbid-text'] ?? '';
  const strict = parseBoolean(args.strict, true);
  const headless = parseBoolean(args.headless, true);

  const { chromium } = await loadPlaywright();
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, jsonName);
  const screenshotPath = path.join(outDir, screenshotName);

  const events = [];
  const push = (event) => events.push({ ts: new Date().toISOString(), ...event });

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (message) => {
    push({ type: 'console', level: message.type(), text: message.text() });
  });

  page.on('pageerror', (error) => {
    push({ type: 'pageerror', message: error.message });
  });

  page.on('requestfailed', (request) => {
    push({
      type: 'requestfailed',
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText ?? 'unknown',
    });
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: gotoTimeoutMs });
  await page.waitForTimeout(preWaitMs);

  if (clickSelector) {
    const locator = page.locator(clickSelector).first();
    if ((await locator.count()) > 0) {
      await locator.click({ timeout: clickTimeoutMs });
      push({ type: 'action', action: 'click', by: 'selector', value: clickSelector });
      await page.waitForTimeout(postClickWaitMs);
    } else {
      push({ type: 'action', action: 'click_skipped', by: 'selector', value: clickSelector });
    }
  } else if (clickText) {
    const locator = page.locator(`text=${clickText}`).first();
    if ((await locator.count()) > 0) {
      await locator.click({ timeout: clickTimeoutMs });
      push({ type: 'action', action: 'click', by: 'text', value: clickText });
      await page.waitForTimeout(postClickWaitMs);
    } else {
      push({ type: 'action', action: 'click_skipped', by: 'text', value: clickText });
    }
  }

  const alerts = await page.locator('div[role="alert"]').allTextContents();
  const forbidVisible = forbidText ? (await page.locator(`text=${forbidText}`).count()) > 0 : false;
  const successSeen = successText ? includesText(events, successText) : true;
  const failSeen = failText ? includesText(events, failText) : false;

  const summary = {
    url,
    strict,
    successText: successText || null,
    failText: failText || null,
    forbidText: forbidText || null,
    successSeen,
    failSeen,
    forbidVisible,
    alertCount: alerts.length,
    alerts,
  };

  push({ type: 'summary', ...summary });

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await browser.close();

  const payload = {
    capturedAt: new Date().toISOString(),
    summary,
    events,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const failing = (successText && !successSeen) || failSeen || forbidVisible;
  if (strict && failing) {
    console.error('[playwright-probe] FAIL', summary);
    process.exit(1);
  }

  console.log('[playwright-probe] PASS', summary);
}

main().catch((error) => {
  console.error('[playwright-probe] ERROR', error);
  process.exit(1);
});
