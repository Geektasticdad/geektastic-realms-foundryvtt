# Releasing a new version

This module has no build step — a release is just a tagged snapshot of
`module.json` + `scripts/` (plus `README.md`/`CHANGELOG.md`/`LICENSE`) zipped
up and attached to a GitHub Release, so Foundry's **Install Module → Manifest
URL** flow has a real `download` artifact to fetch (module.json's `manifest`
field always points at `main`; its `download` field always points at the
*latest* release).

## Checklist

1. **Bump the version** in [`module.json`](module.json) (`version` field).
   Keep `compatibility.minimum`/`.verified` in sync with whatever Foundry
   version you last actually tested against — don't bump `.verified` on faith.
2. **Update [`CHANGELOG.md`](CHANGELOG.md)** — move `[Unreleased]` entries
   (if any) under a new `## [x.y.z] - YYYY-MM-DD` heading matching the version
   from step 1, and add the compare-link line at the bottom of the file next
   to the existing ones.
3. **Commit and push** both files to `main`.
4. **Tag and push the tag** — this is what triggers the release:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
5. **Verify the run**: [`.github/workflows/release.yml`](.github/workflows/release.yml)
   checks the tag matches `module.json`'s version (fails loudly if not), zips
   `module.json`, `scripts/`, `README.md`, `CHANGELOG.md`, and `LICENSE` at the
   zip root (**no wrapping folder** — Foundry's installer creates
   `Data/modules/<id>/` itself and extracts the zip straight into it), and
   publishes a GitHub Release with `module.zip` attached.
6. **Smoke-test the manifest URL** in a real (or fresh) Foundry world:
   **Add-on Modules → Install Module**, paste
   `https://raw.githubusercontent.com/Geektasticdad/geektastic-realms-foundryvtt/main/module.json`,
   and confirm it installs and enables cleanly — this is the real end-to-end
   verification, not just "the workflow went green."

## If the workflow fails

The version-check step fails the run (not the tag) if you forgot step 1 —
fix `module.json`, delete the tag (`git push --delete origin vX.Y.Z` and
`git tag -d vX.Y.Z`), and re-tag once it's correct. Nothing is published
until the release step actually runs.
