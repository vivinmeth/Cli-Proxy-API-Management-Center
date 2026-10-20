import { describe, expect, test } from 'bun:test';
import { BRAND_LOGO, BRAND_NAME, resolveDeployEnv } from '../src/tmx/brand';

describe('tokenmaxx brand', () => {
  test('ships an inline SVG logo so the single-file build stays self-contained', () => {
    expect(BRAND_NAME).toBe('TokenMAXX Proxy');
    expect(BRAND_LOGO.startsWith('data:image/svg+xml,')).toBe(true);
  });

  test.each([
    ['http://tmx-proxy.alien.vin', 'prod'],
    ['tmx-proxy.alien.vin', 'prod'],
    ['http://alien.vin:8318', 'prod'],
    ['http://alien.tail3aa7d9.ts.net:8318', 'prod'],
    ['http://staging.tmx-proxy.alien.vin', 'staging'],
    ['alien.vin:8319', 'staging'],
    ['alien.vin:8317', 'dev'],
    ['http://localhost:5173', 'dev'],
    ['http://127.0.0.1', 'dev'],
  ] as const)('%s → %s', (apiBase, env) => {
    expect(resolveDeployEnv(apiBase)).toBe(env);
  });

  test('unknown or malformed bases get no pill', () => {
    expect(resolveDeployEnv('https://example.com')).toBeNull();
    expect(resolveDeployEnv('')).toBeNull();
    expect(resolveDeployEnv('http://[bad')).toBeNull();
  });
});
