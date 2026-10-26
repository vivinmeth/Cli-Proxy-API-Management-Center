# Cli-Proxy-API-Management-Center (tokenmaxx fork)
Kind: code · Shape: single · Stack: react · Git mode: trunk

`vivinmeth/Cli-Proxy-API-Management-Center` ("CPAMC"), our fork of
`router-for-me/Cli-Proxy-API-Management-Center`: the management UI of the tokenmaxx home proxy,
shipped as one `management.html`. `AGENTS.md` is upstream's file and its rules still apply (bun,
six-locale i18n, `bun run verify`, single-file build); this overlay adds the fork's rules and wins
where they conflict. It stays a separate file so upstream merges don't conflict.

## Map

Work happens in the `Cli-Proxy-API-Management-Center/` submodule of the umbrella repo
`~/workspace/vivinmeth/repos/tokenmaxx-proxy`. Its `AGENTS.md` and `wiki/` hold the machine,
ports, Dokploy and secrets; read `../AGENTS.md` before anything that touches releases or prod. The
separate clone at `~/workspace/vivinmeth/repos/Cli-Proxy-API-Management-Center` is parked: don't
work there (`../wiki/parked-fork-clones.md`).

**New fork-only code goes under `src/tmx/`**; call sites in upstream files only import from there.
Our changes, which must keep working:

- **Ledger quota view** (the default view on Quota Management): `src/features/quota/`,
  `ledgerModel.ts`, `emailMask.ts`. The Claude summary card leads with the 5-hour + general 7-day
  windows (`LEDGER_HEADLINE_WINDOWS`); Fable and other model-scoped buckets sit in the collapsed
  extras.
- **`reset-soonest`** option in the Config Panel routing strategy, in all 6 locales.
- **TokenMAXX Proxy branding + environment pill** (`src/tmx/`: `brand.ts` = name, inline SVG logo,
  `resolveDeployEnv`; `EnvPill.tsx`; `useEnvDocumentTitle.ts`), used by `MainLayout`, `LoginPage`,
  `SystemPage`, `main.tsx`. The pill shows the **API base being managed**, not the page origin
  (dev UI → prod backend says PROD). Keep `LOGO_SVG` in sync with the umbrella's `assets/logo.svg`.
- **Request History** (`src/tmx/requests/`, route `/requests`, Observe group): reads
  `/v8/management/tmx/requests*`. Strings under `tmx_requests.*`.
- **Reset credits** on the Ledger (`src/tmx/resets/`): reads `/v8/management/tmx/resets` and renders
  nothing when the backend lacks it. `QuotaLedger.tsx` only carries the mount points; the Cards view
  keeps upstream's reset UI. Strings under `tmx_resets.*`; tests in `tests/tmxResets.test.ts`.
  `../wiki/reset-credits.md`.
- Details: `../wiki/ui-ledger-and-releases.md`, `../wiki/observability-plan.md`.

## Done

```sh
export PATH=$HOME/.bun/bin:$PATH          # `bun run verify` calls `bun` by name
bun install --frozen-lockfile
bun run verify                            # tests + lint + build; required before handing off
```

Then look at the changed route on the dev UI (it runs as the user service `tokenmaxx-dev-ui`, Vite
HMR on :5173, so edits show live): log in at `http://alien.vin:5173` with API address
`alien.vin:8317` and the dev management key (`../.dev-keys`). T3's preview browser is blocked by
AppArmor on this host; take screenshots with the Playwright scripts in
`~/.local/share/tokenmaxx-shot/` (`../wiki/dev-environment.md`).

## Project rules

- **Main is published:** never rebase or force-push it. `git submodule update` leaves a detached
  HEAD: `git checkout main` and `git pull --ff-only` before committing. After pushing, commit the
  new pointer in the umbrella (`git add Cli-Proxy-API-Management-Center`) and push.
- **Upstream:** remote `upstream` = `router-for-me/Cli-Proxy-API-Management-Center` (add it if
  missing). Sync by merge, not rebase (`../wiki/upstream-sync.md`). Fork-only guidance goes here,
  never in upstream's `AGENTS.md`.
- **`CLAUDE.md`** is git-ignored upstream; ours is force-tracked (`git add -f`) and only imports
  `AGENTS.md` and this file. This overrides upstream's note that `CLAUDE.md` mirrors `AGENTS.md`.
- **Reset-credit verdicts and summary come from the backend** (shared with fleet): don't recompute
  them here; `src/tmx/resets/model.ts` only adapts them and lays out the timeline.
- **Product names aren't translated;** upstream's "CLI Proxy API" strings that mean the backend
  stay. New strings go in all 6 locales.
- **Dev server:** don't start Vite with `nohup`/`setsid` from your shell (T3 kills the session's
  processes when it ends); restart it with `../scripts/dev-services.sh restart ui` (logs:
  `/tmp/tokenmaxx-ui.log`).
- **Git identity** is set locally (`Vivin Meth <vivinmeth@surkyl.com>`); never change global git
  config.

## Tools

**Releases** (how UI changes reach prod): prod downloads `management.html` from this fork's
**latest GitHub release**. Tag scheme `vX.Y.Z-tokenmaxx.N`: `VERSION=<tag> bun run build`, publish
`dist/index.html` as the `management.html` asset, mark the release latest, then reload both proxy
apps (`../AGENTS.md` § Tools). Full steps: `../wiki/ui-ledger-and-releases.md`.

Secret locations: `../AGENTS.md` § Project rules. Skill: `react`.
