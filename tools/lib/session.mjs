// Browser session driver for the review tooling.
//
// Boots the real app in headless Chromium against a real Vite server and exposes a small
// API for driving it. Two design choices matter:
//
//   * Game time is advanced through the app's own `__vs.advance(seconds)` fixed-step clock,
//     never through wall-clock sleeps. Headless software GL runs at a few frames a second,
//     so any wall-clock wait would advance a sliver of game time and make every measurement
//     of movement, animation or timing wrong in a way that mimics a real bug.
//
//   * Console errors and failed requests are collected from the first byte, so a reviewer
//     can never mistake a broken build for a design choice.

import { spawn } from "node:child_process";
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");

function endTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", shell: true });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* still starting */
    }
    if (Date.now() > deadline) throw new Error(`server did not answer in time: ${url}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Open the game and hand a driver to `body`. Always tears the server and browser down.
 *
 * @param {object} opts
 * @param {number} [opts.width]   viewport width (default 1920)
 * @param {number} [opts.height]  viewport height (default 1080)
 * @param {string} [opts.lang]    locale to pin via ?lang=
 * @param {string} [opts.tier]    quality tier to pin via ?tier=
 * @param {boolean}[opts.built]   serve the production build instead of dev
 * @param {number} [opts.scale]   deviceScaleFactor for supersampled captures
 */
export async function openGame(opts, body) {
  const {
    width = 1920,
    height = 1080,
    lang = null,
    tier = null,
    built = false,
    scale = 1,
    query = {},
  } = opts || {};

  const port = await freePort();
  const argv = built
    ? ["vite", "preview", "--port", String(port), "--strictPort"]
    : ["vite", "--port", String(port), "--strictPort"];

  const server = spawn("npx", argv, { cwd: ROOT, stdio: "pipe", shell: true });
  let serverOut = "";
  server.stdout.on("data", (d) => (serverOut += d));
  server.stderr.on("data", (d) => (serverOut += d));

  let browser = null;
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, 60000);

    browser = await chromium.launch({
      args: [
        // SwiftShader gives a real, if slow, GL implementation in CI-style headless runs;
        // without it the WebGL context can silently fail and the reviewer sees a blank frame.
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-lcd-text",
        "--force-color-profile=srgb",
        "--hide-scrollbars",
      ],
    });

    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: scale,
      reducedMotion: "no-preference",
    });

    const consoleErrors = [];
    const consoleWarnings = [];
    const failedRequests = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
      else if (m.type() === "warning") consoleWarnings.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e.stack || e)));
    page.on("requestfailed", (r) =>
      failedRequests.push(`${r.url()} — ${r.failure()?.errorText ?? "failed"}`)
    );

    const params = new URLSearchParams(query);
    if (lang) params.set("lang", lang);
    if (tier) params.set("tier", tier);
    const qs = params.toString();
    const url = `http://127.0.0.1:${port}/${qs ? `?${qs}` : ""}`;

    await page.goto(url, { waitUntil: "load", timeout: 90000 });
    await page
      .waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), {
        timeout: 90000,
      })
      .catch(() => {});

    const driver = {
      page,
      url,
      consoleErrors,
      consoleWarnings,
      failedRequests,
      serverOut: () => serverOut,

      /** Advance exact game seconds through the app's fixed-step clock. */
      advance: (seconds) => page.evaluate((s) => window.__vs?.advance?.(s), seconds),

      /** Advance in slices so per-frame systems observe realistic frame deltas. */
      async play(seconds, slice = 1 / 30) {
        await page.evaluate(
          ([total, dt]) => {
            const n = Math.max(1, Math.round(total / dt));
            for (let i = 0; i < n; i++) window.__vs.advance(dt);
          },
          [seconds, slice]
        );
      },

      /** Hold keys for a number of game seconds, advancing time while they are down. */
      async hold(keys, seconds, { release = true } = {}) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) await page.keyboard.down(k);
        await driver.play(seconds);
        if (release) for (const k of list) await page.keyboard.up(k);
      },

      async look(dx, dy, steps = 8) {
        const box = page.viewportSize();
        let x = box.width / 2;
        let y = box.height / 2;
        await page.mouse.move(x, y);
        for (let i = 0; i < steps; i++) {
          x += dx / steps;
          y += dy / steps;
          await page.mouse.move(x, y);
          await driver.play(1 / 60);
        }
      },

      report: () => page.evaluate(() => window.__vs?.report?.() ?? { ready: false }),
      probe: (name) => page.evaluate((n) => window.__vs?.probe?.(n), name),
      run: (fn, arg) => page.evaluate(fn, arg),

      async shoot(outPath, { clip, fullPage = false, timeout = 180000 } = {}) {
        fs.mkdirSync(path.dirname(path.resolve(ROOT, outPath)), { recursive: true });
        // Playwright's 30s default is far too short here. One frame of a shadow-cascaded scene
        // through SwiftShader can legitimately take minutes, and several review agents usually run
        // at once on the same machine. A timeout in that situation is contention, not a bug — but it
        // looks exactly like a hang and has already cost a review cycle.
        const shot = { path: path.resolve(ROOT, outPath), fullPage, timeout };
        if (clip) shot.clip = clip;
        await page.screenshot(shot);
        return outPath;
      },
    };

    return await body(driver);
  } finally {
    await browser?.close().catch(() => {});
    endTree(server.pid);
  }
}

export function arg(name, fallback = null) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

export function has(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

export function positional(index = 0) {
  return process.argv.slice(3).filter((a) => !a.startsWith("--"))[index] ?? null;
}
