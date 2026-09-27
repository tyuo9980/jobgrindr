# jobgrindr

Track job applications, interviews, and offers.

- **Dashboard**: summary stats and a Sankey diagram showing how applications flow
  through your stages to an outcome.
- **Applications table**: company, role (linked to the posting), status, date applied,
  last update, location / work mode, salary, source, contact and notes. Sortable,
  searchable and filterable; change a status inline and it is recorded in the
  application's history.
- **Custom statuses**: add, rename, recolor, reorder and delete statuses. A *stage* is a
  step an application moves through (the flow diagram follows their order); an
  *outcome* ends it. New accounts start with Applied → Screening → Interviewing → Offer
  and Accepted / Declined / Rejected / No response / Withdrawn.

## Layout

```
src/       React + TypeScript client (Vite), on GitHub Pages at t98.dev/jobgrindr/
server/    Express + SQLite via node:sqlite; API at api.t98.dev/jobgrindr/api
deploy/    systemd unit, Caddy config and deploy script for the EC2 host
```

## Development

Requires Node 22.21 or newer, for `node:sqlite`.

```sh
npm install
(cd server && npm install)
npm run dev:server   # API on http://127.0.0.1:3001, db at server/data/jobgrindr.db
npm run dev          # client on http://localhost:5173/jobgrindr/, proxies the API
```

Without `GOOGLE_CLIENT_ID` the server runs with no sign-in and a single local user.
Set it (and add `http://localhost:5173` as an authorized origin on the OAuth client)
to exercise the real sign-in locally.

## Server configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3001` | listen port |
| `HOST` | `127.0.0.1` | bind address |
| `BASE_PATH` | `/jobgrindr` | path prefix for the client and API |
| `DB_PATH` | `server/data/jobgrindr.db` | SQLite file |
| `GOOGLE_CLIENT_ID` | unset | OAuth "Web application" client whose ID tokens are accepted; required when `NODE_ENV=production` |
| `ALLOWED_EMAILS` | unset | comma-separated accounts allowed to sign in; unset allows any Google account |
| `CORS_ORIGINS` | unset | comma-separated origins whose pages may call the API with credentials |
| `APP_URL` | unset | where the client is hosted; page requests to this server redirect there |

Signing in exchanges a Google ID token for a 30-day session cookie. Only a hash of the
session token is stored. Every status and application belongs to one account.

## Deployment

**Client**: GitHub Pages. Every push to `main` that touches the client runs
`.github/workflows/pages.yml`, which builds with
`VITE_API_BASE=https://api.t98.dev/jobgrindr/api` and publishes `dist/`. The user site
(tyuo9980.github.io) owns the `t98.dev` domain, so this repo is served at
`https://t98.dev/jobgrindr/`. The repo's Pages source must be set to *GitHub Actions*.

**API**: the same EC2 host as 1x1, behind the same Caddy and Cloudflare setup, at
`https://api.t98.dev/jobgrindr/api`. Caddy sends `/jobgrindr` and everything under it to
port 3001 and everything else to 1x1 (see `deploy/Caddyfile`). The page and the API are
different origins but the same site, so the SameSite=Lax session cookie still flows;
the server answers CORS only for `CORS_ORIGINS`.

The OAuth client needs `https://t98.dev` as an authorized JavaScript origin.

One-time setup on the host:

1. `mkdir -p ~/jobgrindr-data` and create `~/jobgrindr-data/jobgrindr.env` from
   `deploy/jobgrindr.env.example`
2. install `deploy/jobgrindr.service` to `/etc/systemd/system/` and
   `sudo systemctl enable jobgrindr`
3. update the `api.t98.dev` block in `/etc/caddy/Caddyfile` to match `deploy/Caddyfile`
   and `sudo systemctl reload caddy`

Then, for every API release (deploy it before pushing a client that depends on it):

```sh
deploy/deploy.sh        # copies server/ over ssh, installs deps, restarts
```

