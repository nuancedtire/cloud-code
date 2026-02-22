import { Container } from '@cloudflare/containers'
import { env } from 'cloudflare:workers'
import { processSSEStream } from './sse'

const PORT = 2633

// ─── Constants ───────────────────────────────────────────────────────────────

/** Marker header set on spinner responses so the polling script can detect them. */
const STARTING_HEADER = 'x-container-starting'

/** SSE reconnect: start at 2 s, double each failure, cap at 30 s. */
const SSE_RETRY_INIT_MS = 2_000
const SSE_RETRY_MAX_MS = 30_000

// ─── Environment ─────────────────────────────────────────────────────────────

const containerEnv = Object.fromEntries(
  Object.entries(env).filter(([, value]) => typeof value === 'string'),
)

// ─── Spinner HTML ─────────────────────────────────────────────────────────────

const SPINNER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Starting\u2026</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0d1117;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #e6edf3;
    }
    .card {
      text-align: center;
      padding: 2.5rem 3rem;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      max-width: 360px;
      width: 90%;
    }
    .spinner {
      width: 44px;
      height: 44px;
      border: 3px solid #21262d;
      border-top-color: #58a6ff;
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
      margin: 0 auto 1.5rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; }
    p { font-size: 0.85rem; color: #8b949e; line-height: 1.5; margin-bottom: 0.25rem; }
    .status { font-size: 0.78rem; color: #6e7681; margin-top: 0.75rem; min-height: 1.1em; }
    .error-box {
      display: none;
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      background: #1f1b1b;
      border: 1px solid #6e2020;
      border-radius: 8px;
      font-size: 0.82rem;
      color: #f85149;
    }
    button {
      margin-top: 0.75rem;
      padding: 0.4rem 1rem;
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e6edf3;
      font-size: 0.82rem;
      cursor: pointer;
    }
    button:hover { background: #30363d; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner" id="sp"></div>
    <h1>Starting up\u2026</h1>
    <p>The container is warming up.</p>
    <p class="status" id="st">This page will refresh automatically.</p>
    <div class="error-box" id="err">
      <p style="color:#f85149">The container is taking longer than expected.</p>
      <button onclick="location.reload()">Retry</button>
    </div>
  </div>
  <script>
    (function () {
      var POLL_INTERVAL = 2500;
      var SLOW_INTERVAL = 6000;
      var TIMEOUT_MS = 5 * 60 * 1000; // 5 min
      var started = Date.now();
      var attempt = 0;

      function poll() {
        if (Date.now() - started > TIMEOUT_MS) {
          document.getElementById('sp').style.display = 'none';
          document.getElementById('st').textContent = '';
          document.getElementById('err').style.display = 'block';
          return;
        }

        attempt++;
        var interval = attempt > 20 ? SLOW_INTERVAL : POLL_INTERVAL;
        document.getElementById('st').textContent =
          'Checking\u2026 (attempt ' + attempt + ')';

        fetch(location.href, {
          method: 'HEAD',
          cache: 'no-store',
          credentials: 'include',
        })
          .then(function (r) {
            // Auth expired or forbidden \u2014 let the browser re-challenge
            if (r.status === 401 || r.status === 403) {
              location.reload();
              return;
            }
            // Container ready when response is ok and our marker header is absent
            if (r.ok && r.headers.get('${STARTING_HEADER}') !== '1') {
              location.reload();
              return;
            }
            setTimeout(poll, interval);
          })
          .catch(function () {
            setTimeout(poll, interval);
          });
      }

      setTimeout(poll, POLL_INTERVAL);
    })();
  </script>
</body>
</html>`

// ─── AgentContainer ───────────────────────────────────────────────────────────

export class AgentContainer extends Container {
  sleepAfter = '10m'
  defaultPort = PORT

  private _watchPromise?: Promise<void>

  envVars = {
    ...containerEnv,
    PORT: PORT.toString(),
  }

  /**
   * Continuously monitors the OpenCode SSE event stream.
   * Renews the container's activity timeout whenever a session update event
   * arrives, preventing the container from sleeping while the UI is in active use.
   *
   * Uses exponential backoff when the stream is unavailable (e.g. during the
   * few seconds it takes OpenCode to finish its own startup after the container
   * process is running).
   */
  async watchContainer(): Promise<void> {
    let delay = SSE_RETRY_INIT_MS

    while (true) {
      try {
        const res = await this.containerFetch('http://container/global/event')
        const reader = res.body?.getReader()

        if (reader) {
          // Successful connection — reset backoff
          delay = SSE_RETRY_INIT_MS

          await processSSEStream(reader, (event) => {
            const eventType = event.payload?.type

            if (eventType === 'session.updated') {
              this.renewActivityTimeout()
              console.info('Renewed container activity timeout')
            }

            if (eventType !== 'message.part.updated') {
              console.info('SSE event:', JSON.stringify(event.payload))
            }
          })

          // Stream ended cleanly (container shutdown / stream closed by server)
          console.info('SSE stream ended, reconnecting\u2026')
        }
      } catch (error) {
        console.error('SSE connection error:', error)
      }

      // Wait before reconnecting with exponential backoff
      console.info(`SSE reconnecting in ${delay} ms`)
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, SSE_RETRY_MAX_MS)
    }
  }

  override async onStart(): Promise<void> {
    // Fire-and-forget: keep SSE watcher running in the background.
    // Do not await — that would block blockConcurrencyWhile.
    this._watchPromise = this.watchContainer()
  }
}

// ─── Request forwarding ───────────────────────────────────────────────────────

const SINGLETON_CONTAINER_ID = 'cf-singleton-container'

/** Returns true when the request's Accept header prefers HTML. */
function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('Accept') ?? ''
  return accept.includes('text/html')
}

/** A minimal HTML loading page returned while the container cold-starts. */
function spinnerResponse(): Response {
  return new Response(SPINNER_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache',
      [STARTING_HEADER]: '1',
    },
  })
}

/**
 * A machine-readable 503 for non-HTML requests (API / SSE / fetch calls from
 * the OpenCode UI) that arrive while the container is cold-starting.
 * The `Retry-After` header tells well-behaved clients when to retry.
 */
function startingApiResponse(): Response {
  return new Response(
    JSON.stringify({ error: 'Container is starting, please retry shortly' }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache',
        'Retry-After': '3',
      },
    },
  )
}

export async function forwardRequestToContainer(request: Request) {
  const objectId = env.AGENT_CONTAINER.idFromName(SINGLETON_CONTAINER_ID)
  const container = env.AGENT_CONTAINER.get(objectId, {
    locationHint: 'wnam',
  })

  let response: Response

  try {
    response = await container.fetch(request)
  } catch {
    // container.fetch() threw — the container is unreachable (cold start, crash, etc.)
    return wantsHtml(request) ? spinnerResponse() : startingApiResponse()
  }

  // Treat a bare 502 / 503 from the container layer (not from OpenCode itself)
  // as a signal that the container is still initialising.
  // OpenCode's own 503s are forwarded as-is; only intercept when the response
  // body is empty, which is the case for infrastructure-level errors.
  if ((response.status === 502 || response.status === 503) && wantsHtml(request)) {
    const clone = response.clone()
    const text = await clone.text().catch(() => '')
    if (!text) {
      return spinnerResponse()
    }
  }

  return response
}
