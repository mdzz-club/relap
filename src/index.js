/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npx wrangler dev src/index.js` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npx wrangler publish src/index.js --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

let lastTimestamp = 0;

/** @type Set<string[]> */
let Words = new Set();

const CORS = { "access-control-allow-origin": "*" }

async function xbol0Words() {
  try {
    const res = await fetch("https://raw.githubusercontent.com/xbol0/nostr-spam-words/main/words.txt")
    const list = (await res.text()).split("\n")
    return list.map(i => i.split(' '))
  } catch {
    return [];
  }
}

async function nostrBandWords() {
  try {
    const res = await fetch("https://spam.nostr.band/spam_api?method=get_current_spam");
    if (res.status !== 200) return [];
    const json = await res.json();
    return json.cluster_words.map(i => i.words)
  } catch {
    return []
  }
}

async function updateWords() {
  const all = await Promise.all([xbol0Words(), nostrBandWords()])
  lastTimestamp = Date.now();
  Words.clear();
  for (const i of all.flat()) {
    Words.add(i)
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.addEventListener("error", reject, { once: true })
    ws.addEventListener("open", () => resolve(ws), { once: true })
  })
}

/**
* @param {WebSocket} local
* @param {WebSocket} remote
*/
function bind(local, remote) {
  local.accept();
  local.addEventListener("close", () => remote.close())
  local.addEventListener("error", () => remote.close())
  remote.addEventListener("close", () => local.close())
  remote.addEventListener("error", () => local.close())

  remote.addEventListener("message", (e) => {
    try {
      const json = JSON.parse(e.data)
      if (!Array.isArray(json)) return;

      if (json[0] === "EVENT") {
        const event = json[2]
        if (event.kind === 1) {
          for (const items of Words) {
            let count = 0;
            for (const w of items) {
              if (event.content.includes(w)) {
                count++;
              }

              if (count >= ~~(items.length / 2)) return;
            }
          }
        }
      }

      local.send(e.data)
    } catch {
      return;
    }
  })

  local.addEventListener("message", e => remote.send(e.data))
}

export default {
  /**
  * @param {Request} req
  */
  async fetch(req) {
    if (!lastTimestamp || Date.now() - lastTimestamp > 60000) {
      await updateWords();
      console.log("update words:", Words.size)
    }

    const url = new URL(req.url)
    const host = url.pathname.slice(1) || "relay.damus.io"

    if (req.headers.get("accept") === "application/nostr+json") {
      return fetch(`https://${host}/`, { headers: req.headers })
    }

    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Please use Nostr client to connect", {
        headers: { ...CORS, "content-type": "text/plain" }
      })
    }

    try {
      console.log("host:", host)
      const ws = await connect(`wss://${host}/`)
      const [webSocket, server] = Object.values(new WebSocketPair())
      bind(server, ws)

      return new Response(null, { webSocket, status: 101 })
    } catch (err) {
      return new Response(err.message, {
        headers: { ...CORS, "content-type": "text/plain" },
        status: 400,
      })
    }
  },
};
