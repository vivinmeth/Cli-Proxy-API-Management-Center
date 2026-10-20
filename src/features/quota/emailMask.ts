/**
 * Mask anything email-shaped inside a credential label.
 *
 * Auth-file names usually embed the account email (`claude-theo@example.dev.json`),
 * which is exactly what should not be on screen during a screen share. The
 * ledger shows `claude-t•••@e•••.dev.json` until the operator opts in.
 *
 * Pure and React-free so the masking rules are pinned by tests.
 */

export const MASK_GLYPH = '•••';

/**
 * Provider prefixes that auth-file names put in front of the email. They are
 * not part of the address, so they stay readable: `codex-john@…` keeps
 * `codex-` and masks `john`, rather than treating `codex-john` as the local part.
 */
const DEFAULT_PREFIXES = [
  'antigravity',
  'claude',
  'codex',
  'devin',
  'gemini',
  'grok',
  'iflow',
  'kimi',
  'meta',
  'qwen',
  'xai',
];

/** Trailing file extensions that a greedy domain match would otherwise swallow. */
const FILE_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'txt', 'toml']);

const EMAIL_PATTERN = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

const maskPart = (part: string): string => (part ? `${part[0]}${MASK_GLYPH}` : part);

export interface MaskEmailOptions {
  /** Readable prefixes before the local part; defaults to known provider ids. */
  prefixes?: readonly string[];
}

/**
 * Replace every email-like substring: the local part and every domain label
 * except the top-level one keep only their first character.
 */
export function maskEmailsInText(text: string, options: MaskEmailOptions = {}): string {
  if (!text || !text.includes('@')) return text;
  const prefixes = (options.prefixes ?? DEFAULT_PREFIXES).map((prefix) => prefix.toLowerCase());

  return text.replace(EMAIL_PATTERN, (_match, rawLocal: string, rawDomain: string) => {
    // Split a known provider prefix (`claude-`, `codex_`) off the local part.
    let prefix = '';
    let local = rawLocal;
    const prefixMatch = /^([A-Za-z0-9]+)([-_])(.+)$/.exec(rawLocal);
    if (prefixMatch && prefixes.includes(prefixMatch[1].toLowerCase())) {
      prefix = `${prefixMatch[1]}${prefixMatch[2]}`;
      local = prefixMatch[3];
    }

    // Peel file extensions back off the domain (`example.dev.json` → `.json`).
    const labels = rawDomain.split('.');
    const suffix: string[] = [];
    while (labels.length > 2 && FILE_EXTENSIONS.has(labels[labels.length - 1].toLowerCase())) {
      suffix.unshift(labels.pop() as string);
    }
    const tld = labels.pop() as string;
    const maskedDomain = [...labels.map(maskPart), tld].join('.');
    const tail = suffix.length > 0 ? `.${suffix.join('.')}` : '';

    return `${prefix}${maskPart(local)}@${maskedDomain}${tail}`;
  });
}
