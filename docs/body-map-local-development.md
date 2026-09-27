# Body Map asset and local development

The interactive viewer is development-only at `/dev/body-map`. It reads a local runtime manifest and GLB from the ignored `3d-model/local-assets/` directory. The current migration provides a versioned BodyParts3D 4.0 GLB and a static production-compatible asset package under `public/body-map/bodyparts3d-v3/`; it does not add the viewer to production navigation. See [the migration record](bodyparts3d-migration/README.md) for provenance, coverage, attribution, hashes, and validation steps.

## Review the versioned source asset

The viewer defaults to the versioned v3 manifest in ignored local assets on this feature branch. To review another local candidate, set the dev-only manifest path before starting Next:

```powershell
$env:BODY_MAP_MANIFEST_PATH = '3d-model/local-assets/bodyparts3d-v3/body-map-runtime-manifest-v3.json'
npm run dev -- --port 3193
```

The override must remain within the repository. The viewer continues to use the existing scene, picking, group/subregion navigation, camera transitions, URL state, and bilateral identities.

## BodyParts3D source and license

The selected geometry uses official BodyParts3D Release 4.0 IS-A/PART-OF archives. The current official [README dated 2025-02-27](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html) lists both exact OBJ archives and states CC BY 4.0, with a required attribution. Every archive OBJ header scanned still includes the older CC BY-SA 2.1 Japan notice. The branch follows the current official terms for the listed release while preserving the required credit and disclosing the embedded-header discrepancy. It does not assume that the older notices have been rewritten or that the discrepancy has no legal interpretation risk.

The four structures absent from those source tables and meshes (latissimus dorsi, rectus abdominis, internal oblique and transversus abdominis) are independently authored BodyCast educational approximations. They are not source-derived and are not covered by the BodyParts3D credit. They require anatomy review before being treated as authoritative.

## Historical source boundary

Z-Anatomy was part of an earlier local prototype and is not used by the current feature branch, its GLB, mapping or static delivery. Its older local assets remain in the separate archive worktrees as user-requested backups. This worktree does not copy or delete those archive files.

## Validation

The local validation script checks checksums, object identities, selectable/context counts, taxonomy bindings and the Khronos glTF Validator. Its JSON output belongs under ignored local assets. Public-delivery smoke checks should fetch both the static manifest and GLB after building the application.
