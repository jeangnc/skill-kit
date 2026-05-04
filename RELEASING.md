# Releasing

CI handles publishes. To cut a release:

```sh
# bump version (edits package.json)
npm version patch   # or minor / major

# this creates a tag like v0.3.1 and a commit; push both
git push --follow-tags
```

The `release.yml` workflow fires on any `v*` tag push:

1. Verifies the tag matches `package.json` version
2. Runs lint + tests
3. Builds `dist/`
4. `pnpm publish --access public --provenance` using `NPM_TOKEN` secret

`--provenance` records a supply-chain attestation linking the published tarball to this commit + workflow run. Visible on the package page on npmjs.com.

## One-time setup

1. **Create npm token** — npmjs.com → Profile → Access Tokens → Generate New Token → "Granular Access Token"
   - Permissions: `Read and write` on packages
   - Scope: `@jean.gnc/skill-kit` (or the entire `@jean.gnc` scope)
   - Expiration: choose one
2. **Add as GitHub secret** — `gh secret set NPM_TOKEN` (or via repo settings → Secrets → Actions)

## Migrating to OIDC (later)

Trusted Publishers on npm avoid token rotation entirely:

1. npmjs.com → package settings → "Trusted publishers" → add GitHub Actions
2. Repo: `jeangnc/skill-kit`, workflow file: `.github/workflows/release.yml`
3. Drop the `NPM_TOKEN` secret and the `NODE_AUTH_TOKEN` env line; the `id-token: write` permission already in the workflow will authenticate via OIDC.
