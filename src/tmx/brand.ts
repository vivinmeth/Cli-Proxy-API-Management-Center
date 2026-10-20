// tokenmaxx fork: product branding and environment detection. Kept in src/tmx/ so upstream
// merges only touch the few call sites that import from here.

export const BRAND_NAME = 'TokenMAXX Proxy';
export const BRAND_SHORT = 'TokenMAXX';
export const BRAND_TAGLINE = 'Proxy Console';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#f05a28"/></linearGradient></defs>
<rect width="64" height="64" rx="15" fill="#16130f"/>
<rect x="2" y="2" width="60" height="60" rx="13" fill="none" stroke="url(#g)" stroke-width="2.5"/>
<path d="M14 15h36v9H36.5v25h-9V24H14z" fill="url(#g)"/>
<path d="M40 40l5-5 5 5M40 48l5-5 5 5" fill="none" stroke="url(#g)" stroke-width="3.5"
 stroke-linecap="round" stroke-linejoin="round"/>
<path d="M14 40l5-5 5 5M14 48l5-5 5 5" fill="none" stroke="url(#g)" stroke-width="3.5"
 stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const BRAND_LOGO = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;

export type DeployEnv = 'prod' | 'staging' | 'dev';

// Ports and hosts of the tokenmaxx deployments on `alien` (see the umbrella AGENTS.md).
const PORT_ENV: Record<string, DeployEnv> = {
  '8317': 'dev',
  '5173': 'dev',
  '8318': 'prod',
  '8319': 'staging',
  // tailnet HTTPS via `tailscale serve` (443 is taken by Dokploy's Traefik)
  '8443': 'prod',
  '9443': 'staging',
};

/**
 * Which deployment an API base points at. The pill reflects the backend being managed, not the
 * page origin, so a dev UI connected to prod still says PROD. Unknown hosts return null.
 */
export function resolveDeployEnv(apiBase: string): DeployEnv | null {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(apiBase) ? apiBase : `http://${apiBase}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host.startsWith('staging.') || host.includes('.staging.')) return 'staging';
  if (host.startsWith('dev.')) return 'dev';
  const byPort = PORT_ENV[url.port];
  if (byPort) return byPort;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return 'dev';
  }
  if (host === 'tmx-proxy.alien.vin') return 'prod';
  return null;
}

export const DEPLOY_ENV_LABEL: Record<DeployEnv, string> = {
  prod: 'PROD',
  staging: 'STAGING',
  dev: 'DEV',
};
