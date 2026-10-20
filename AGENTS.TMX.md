# AGENTS.TMX.md — tokenmaxx fork guidance

This checkout is `vivinmeth/Cli-Proxy-API-Management-Center` ("CPAMC"), a fork of
`router-for-me/Cli-Proxy-API-Management-Center` used by the tokenmaxx home proxy. Everything in
`AGENTS.md` (upstream's rules: bun, six-locale i18n, `bun run verify`) still applies. This file
adds fork-only rules and overrides `AGENTS.md` where they conflict. It's kept separate so
upstream merges don't conflict with it.

## Where things are

| What | Path |
|---|---|
| This repo (working clone, T3 project `Cli-Proxy-API-Management-Center`) | `~/workspace/vivinmeth/repos/Cli-Proxy-API-Management-Center` |
| Backend fork (working clone, T3 project `CLIProxyAPI`) | `~/workspace/vivinmeth/repos/CLIProxyAPI` |
| Umbrella repo (orchestration, wiki, deploy, pins) | `~/workspace/vivinmeth/repos/tokenmaxx-proxy` |

The umbrella's `AGENTS.md` and `wiki/` hold the full context (machine, network, ports, Dokploy,
secrets). Read `tokenmaxx-proxy/AGENTS.md` before anything that touches releases, prod, or
secrets. The umbrella's `Cli-Proxy-API-Management-Center/` submodule is a **read-only pin**:
never edit or commit there; all work happens in this clone.

## Our changes vs upstream (keep these working)

- Ledger quota view (the default view on Quota Management): `src/features/quota/`,
  `ledgerModel.ts`, `emailMask.ts`.
- `reset-soonest` option in the Config Panel routing strategy, in all 6 locales.
- Details: `tokenmaxx-proxy/wiki/ui-ledger-and-releases.md`.

## Git

- Identity is set locally (`Vivin Meth <vivinmeth@surkyl.com>`). Never change global git config.
- Committing and pushing straight to `main` is fine; branches and worktrees are optional (use
  them for parallel work). Never force-push or rebase `main`.
- Remotes: `origin` = fork, `upstream` = `router-for-me/Cli-Proxy-API-Management-Center`. Sync by
  merge, not rebase (`tokenmaxx-proxy/wiki/upstream-sync.md`).
- `CLAUDE.md` is git-ignored upstream; ours is force-tracked (`git add -f`) and only imports
  `AGENTS.md` and this file.
- After pushing, record the new commit in the umbrella:
  `~/workspace/vivinmeth/repos/tokenmaxx-proxy/scripts/bump-pins.sh` (then commit + push there).
  Only pushed commits may be pinned.

## Dev UI (port 5173)

The main checkout of this clone **is** the dev UI.

```sh
~/.bun/bin/bun install --frozen-lockfile
setsid nohup ~/.bun/bin/bun run dev --host 0.0.0.0 --port 5173 --strictPort > /tmp/tokenmaxx-ui.log 2>&1 < /dev/null &
```

- Log in at `http://alien.vin:5173` with API address `alien.vin:8317` and the dev management
  key (`tokenmaxx-proxy/.dev-keys`).
- Before handing off: `~/.bun/bin/bun run verify` (tests + lint + build).
- **In a worktree, don't touch the dev server.** Port 5173 belongs to the main checkout. Run
  `bun install` and `bun run verify`; if you need a dev server, use another port.
- To stop Vite, kill it by PID (`ss -ltnp | grep 5173`); don't `pkill -f vite` from a shell whose
  command line contains "vite".
- T3's built-in preview browser is blocked by AppArmor on this host. For screenshots, use the
  Playwright scripts in `~/.local/share/tokenmaxx-shot/` (see `tokenmaxx-proxy/wiki/dev-environment.md`).

## Releases (how UI changes reach prod)

Prod downloads `management.html` from this fork's **latest GitHub release**. Tag scheme:
`vX.Y.Z-tokenmaxx.N`. `VERSION=<tag> bun run build`, then publish `dist/index.html` as the
`management.html` asset and mark the release latest. Full steps:
`tokenmaxx-proxy/wiki/ui-ledger-and-releases.md`.

## Secrets

Never print, commit, or paste keys; refer to them by variable name. Locations are listed in
`tokenmaxx-proxy/AGENTS.md`.
