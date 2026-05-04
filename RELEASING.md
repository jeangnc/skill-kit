# Releasing

CI handles publishes. To cut a release:

```sh
# bump version (edits package.json, commits, tags)
npm version patch   # or minor / major

# push commit + tag
git push --follow-tags
```

The `release.yml` workflow fires on any `v*` tag push:

1. Verifies the tag matches `package.json` version
2. Runs lint + tests
3. Builds `dist/`
4. `npm publish --access public --provenance` using OIDC

`--provenance` records a supply-chain attestation linking the published tarball to this commit + workflow run. Visible on the package page on npmjs.com.

## One-time setup (Trusted Publishing via OIDC)

Configure once on npmjs.com — no token to manage or rotate.

1. https://www.npmjs.com/package/@jean.gnc/skill-kit/access → "Trusted publishers" → "Add"
2. Provider: **GitHub Actions**
3. Organization: `jeangnc`
4. Repository: `skill-kit`
5. Workflow filename: `release.yml`
6. Environment name: *(leave blank)*

The workflow already has `permissions: id-token: write`, so `npm publish` requests an OIDC token from GitHub at publish time, npm verifies it matches the trusted-publisher config, and the package ships.
