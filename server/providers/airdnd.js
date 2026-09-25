// ==============================================================================
// AirDnD Tactical Provider Proxy for God's Eye View Backend
// Provides /api/esp32/stream, /api/cot, and /api/ai/bda
// ==============================================================================

import dgram from 'node:dgram';

export function airDndProxy() {
  const udpClient = dgram.createSocket('udp4');

  return {
    name: 'airdnd-provider-proxy',
    configureServer(server) {
      // Helper to parse JSON body
      const parseJsonBody = (req) => {
        return new Promise((resolve) => {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            try {
              resolve(body ? JSON.parse(body) : {});
            } catch {
              resolve({});
            }
          });
        });
      };

      // 1. ESP32 Hardware Bus Stream (Server-Sent Events)
      server.middlewares.use('/api/esp32/stream', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const interval = setInterval(() => {
          const loopTime = (2.2 + Math.random() * 0.8).toFixed(1);
          const freeHeap = Math.round(313 + Math.random() * 4);
          const epoch = Math.round(Date.now() / 500);
          const line = `TELEMETRY:LOOP=${loopTime}ms,HEAP=${freeHeap}KB,EPOCH=${epoch},STATUS=ARMED`;
          res.write(
            `data: ${JSON.stringify({ raw: line, loopMs: loopTime, heapKb: freeHeap })}\n\n`
          );
        }, 500);

        req.on('close', () => clearInterval(interval));
      });

      // 2. ATAK Cursor-on-Target (CoT) Broadcast Endpoint
      server.middlewares.use('/api/cot', async (req, res) => {
        if (req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { id, type, lat, lon, alt, callsign } = body;
          const nowIso = new Date().toISOString();
          const staleIso = new Date(Date.now() + 10000).toISOString();
          const cotXml = `<?xml version="1.0" standalone="yes"?><event version="2.0" uid="${id}" type="${type || 'a-f-A-M-F-Q'}" time="${nowIso}" start="${nowIso}" stale="${staleIso}" how="m-g"><point lat="${lat}" lon="${lon}" hae="${alt || 0}" ce="10.0" le="10.0"/><detail><contact callsign="${callsign || id}"/><remarks>AirDnD Swarm C2</remarks></detail></event>`;

          const message = Buffer.from(cotXml);
          udpClient.send(message, 4242, '127.0.0.1', () => {});

          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ status: 'broadcasted', uid: id }));
        }

        res.setHeader('Content-Type', 'text/xml');
        res.end(
          `<?xml version="1.0"?><cotFeed provider="AirDnD" status="active" targetPort="4242"/>`
        );
      });

      // 3. Generative BDA Report (OpenAI)
      server.middlewares.use('/api/ai/bda', async (req, res) => {
        if (req.method === 'POST') {
          const body = await parseJsonBody(req);
          const {
            threatsNeutralized,
            strategy,
            isJamming,
            netAdvantage,
            hwLoopMs,
          } = body;
          res.setHeader('Content-Type', 'application/json');

          const openAiKey = process.env.OPENAI_API_KEY;
          if (openAiKey) {
            try {
              const prompt = `You are the Tactical C2 AI of AirDnD. Write a concise, 4-section military Battle Damage Assessment (BDA) for the Chief of Air Force regarding an asymmetric drone raid over the Singapore Strait.
Data:
- Threats Neutralized: ${threatsNeutralized || 0} of 12
- Strategy: ${strategy || 'Waterline Intercept'}
- Adversarial Jamming: ${isJamming ? '100% telemetry loss' : 'None'}
- Net Defense Economics: +$${(netAdvantage || 0).toLocaleString()}
- Physical Hardware Node: ESP32-C6 RISC-V @ 160MHz (${hwLoopMs || '2.4 ms'} execution loop)
- Result: 0.0% leakage over land, zero collateral damage to HDB estates.
Use all-caps military header format. Keep it under 22 lines.`;

              const aiRes = await fetch(
                'https://api.openai.com/v1/chat/completions',
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${openAiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 450,
                    temperature: 0.3,
                  }),
                }
              );

              if (aiRes.ok) {
                const data = await aiRes.json();
                const report = data.choices[0]?.message?.content;
                if (report) {
                  return res.end(JSON.stringify({ status: 'ok', report }));
                }
              }
            } catch (_) {}
          }

          res.end(JSON.stringify({ status: 'fallback', report: null }));
        }
      });
    },
  };
}
