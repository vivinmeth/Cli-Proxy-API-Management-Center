# AGENTS.TMX.md — tokenmaxx fork guidance

This repo is `vivinmeth/Cli-Proxy-API-Management-Center` ("CPAMC"), a fork of
`router-for-me/Cli-Proxy-API-Management-Center` used by the tokenmaxx home proxy. Everything in
`AGENTS.md` (upstream's rules: bun, six-locale i18n, `bun run verify`) still applies. This file
adds fork-only rules and overrides `AGENTS.md` where they conflict. It's kept separate so
upstream merges don't conflict with it.

## Where things are

Work happens in the **`Cli-Proxy-API-Management-Center/` submodule of the umbrella repo**
`~/workspace/vivinmeth/repos/tokenmaxx-proxy`. The umbrella's `AGENTS.md` and `wiki/` hold the
full context (machine, network, ports, Dokploy, secrets); read `../AGENTS.md` before anything that
touches releases, prod, or secrets.

(A separate clone at `~/workspace/vivinmeth/repos/Cli-Proxy-API-Management-Center` and a matching
T3 project exist but are **parked**. Don't work there; see `../wiki/parked-fork-clones.md`.)

## Our changes vs upstream (keep these working)

- Ledger quota view (the default view on Quota Management): `src/features/quota/`,
  `ledgerModel.ts`, `emailMask.ts`.
- `reset-soonest` option in the Config Panel routing strategy, in all 6 locales.
- **TokenMAXX Proxy branding + environment pill**: everything lives in `src/tmx/` (`brand.ts` =
  name, inline SVG logo, `resolveDeployEnv`; `EnvPill.tsx`; `useEnvDocumentTitle.ts`). Call sites
  (`MainLayout`, `LoginPage`, `SystemPage`, `main.tsx`) only import from there. The pill reflects
  the **API base being managed**, not the page origin (dev UI → prod backend says PROD). Product
  names are not translated; upstream's "CLI Proxy API" strings that refer to the backend stay.
- Claude summary card leads with the 5-hour + general 7-day windows (`LEDGER_HEADLINE_WINDOWS`);
  Fable and other model-scoped buckets sit in the collapsed extras.
- **Request History** page (`src/tmx/requests/`, route `/requests`, Observe group): reads the
  backend's `/v8/management/tmx/requests*`. Strings under `tmx_requests.*` in all 6 locales.
- **Reset credits** on the Ledger (`src/tmx/resets/`: summary cell, pending-resets timeline, row
  chip + drawer, confirm dialog): reads `/v8/management/tmx/resets`, renders nothing when the
  backend lacks it. `QuotaLedger.tsx` only carries the mount points. Strings under `tmx_resets.*`
  in all 6 locales; logic tests in `tests/tmxResets.test.ts`. Cards view keeps upstream's reset UI.
  Details: `../wiki/reset-credits.md`.
- Details: `../wiki/ui-ledger-and-releases.md`, `../wiki/observability-plan.md`.

## Git

- Identity is set locally (`Vivin Meth <vivinmeth@surkyl.com>`). Never change global git config.
- `git submodule update` leaves this checkout on a detached HEAD: `git checkout main` (and
  `git pull --ff-only`) before committing.
- Committing and pushing straight to `main` is fine. Never force-push or rebase `main`.
- Remotes: `origin` = fork, `upstream` = `router-for-me/Cli-Proxy-API-Management-Center` (add it
  if missing). Sync by merge, not rebase (`../wiki/upstream-sync.md`).
- `CLAUDE.md` is git-ignored upstream; ours is force-tracked (`git add -f`) and only imports
  `AGENTS.md` and this file.
- After pushing, commit the new submodule pointer in the umbrella
  (`git add Cli-Proxy-API-Management-Center`) and push.

## Dev UI (port 5173)

This checkout runs the dev UI (Vite HMR) as the user systemd service `tokenmaxx-dev-ui`, so edits
show up live without a restart.

```sh
export PATH=$HOME/.bun/bin:$PATH          # `bun run verify` calls `bun` by name
bun install --frozen-lockfile
bun run verify                            # tests + lint + build; required before handing off
../scripts/dev-services.sh restart ui     # only if Vite needs a restart; logs: /tmp/tokenmaxx-ui.log
```

- Don't start Vite with `nohup`/`setsid` from your shell. T3 kills every process in an agent's
  session scope when the session ends, so it would die. Use the service.
- Log in at `http://alien.vin:5173` with API address `alien.vin:8317` and the dev management
  key (`../.dev-keys`).
- T3's built-in preview browser is blocked by AppArmor on this host. For screenshots, use the
  Playwright scripts in `~/.local/share/tokenmaxx-shot/` (see `../wiki/dev-environment.md`).

## Releases (how UI changes reach prod)

Prod downloads `management.html` from this fork's **latest GitHub release**. Tag scheme:
`vX.Y.Z-tokenmaxx.N`. `VERSION=<tag> bun run build`, then publish `dist/index.html` as the
`management.html` asset and mark the release latest. Full steps:
`../wiki/ui-ledger-and-releases.md`.

## Secrets

Never print, commit, or paste keys; refer to them by variable name. Locations are listed in
`../AGENTS.md`.
