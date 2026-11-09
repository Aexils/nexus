import { readFileSync } from 'node:fs';
import { Agent, request } from 'node:https';

// Client mTLS de l'API privée kube-aggregator, avec le certificat DÉDIÉ à Nexus
// (kagg-private-nexus), jamais celui de Kodi. Les fichiers sont montés depuis un Secret.

export interface KaggReply {
  status: number;
  body: unknown;
}

export type KaggTransport = (method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown) => Promise<KaggReply>;

export interface KaggConfig {
  url: string;
  serverName: string;
  tlsDir: string;
  timeoutMs: number;
}

export function kaggConfig(env: NodeJS.ProcessEnv = process.env): KaggConfig | null {
  const url = env['KAGG_URL'];
  const tlsDir = env['KAGG_TLS_DIR'];
  if (!url || !tlsDir) return null;
  return { url, serverName: env['KAGG_SERVER_NAME'] ?? 'kagg-api', tlsDir, timeoutMs: 8000 };
}

export function httpsTransport(config: KaggConfig): KaggTransport {
  const agent = new Agent({
    ca: readFileSync(`${config.tlsDir}/ca.crt`),
    cert: readFileSync(`${config.tlsDir}/client.crt`),
    key: readFileSync(`${config.tlsDir}/client.key`),
    servername: config.serverName,
    keepAlive: false,
  });
  const base = new URL(config.url);
  return (method, path, body) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const call = request(
        {
          host: base.hostname, port: base.port || 443, path, method, agent, servername: config.serverName,
          headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
          timeout: config.timeoutMs,
        },
        response => {
          const chunks: Buffer[] = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            try {
              resolve({ status: response.statusCode ?? 0, body: text ? JSON.parse(text) : {} });
            } catch {
              resolve({ status: response.statusCode ?? 0, body: {} });
            }
          });
        },
      );
      call.on('timeout', () => call.destroy(new Error('délai dépassé')));
      call.on('error', reject);
      if (payload) call.write(payload);
      call.end();
    });
}
