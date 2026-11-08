# Releasing dash

A release is a `vX.Y.Z` tag. Pushing it runs [`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds the web app, creates the GitHub Release with notes from `CHANGELOG.md` and a `dash-web-X.Y.Z.zip`, and pushes a Docker image to `ghcr.io/lokkisanek/dash` (the name comes from `github.repository`) (`X.Y.Z` and `latest`).

HACS installs the integration from the latest GitHub Release, so a tag alone is not enough: the release must exist.

## Steps

1. **Bump the version** in all three places (Semantic Versioning, same value everywhere):
   - `package.json` → `"version"`
   - `custom_components/guest_ha_dashboard/manifest.json` → `"version"`
   - `custom_components/guest_ha_dashboard/const.py` → `VERSION`

   Check with `npm run check:versions`.
2. **Update `CHANGELOG.md`**: add a `## [X.Y.Z] - YYYY-MM-DD` section (replace `Unreleased` with the date) and the link at the bottom. Preview the release notes with `node scripts/changelog-section.mjs X.Y.Z`.
3. **Open a PR and merge it** into `main` once CI and Validate are green.
4. **Tag the merge commit and push the tag**:

   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z -m "dash X.Y.Z"
   git push origin vX.Y.Z
   ```

   The workflow fails if the tag does not equal `v` + the `package.json` version, or if the three versions differ.
5. **Verify the release**: the Release workflow is green, the GitHub Release shows the changelog notes and the zip, and the GHCR package has the new tag.
6. **Test the update through HACS** on a real Home Assistant: HACS → dash → Redownload / Update to `X.Y.Z`, restart Home Assistant, open the panel and the dashboard on a phone.
7. **Redeploy** the hosted instance (and the public demo) from the new release.
