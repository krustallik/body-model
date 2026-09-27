# BodyParts3D migration (feature branch)

This branch replaces the previous anatomy source in its active Body Map asset path with a versioned BodyParts3D 4.0 scene. The browser viewer remains development-only; the production-compatible deliverable is a versioned static GLB plus a static visual manifest, ready for later integration. No physiology, workout, energy, or database code is part of this migration.

## Source and provenance

- Official download page: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
- Official license page: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- Official README dated 2025-02-27: https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html
- Exact archives named by that README: `isa_BP3D_4.0_obj_99.zip` and `partof_BP3D_4.0_obj_99.zip`.
- SHA-256: IS-A `40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e`; PART-OF `9fbc713fffeee924a5a657d9813d84d7eb957bded63adb854931dd5e3eb61c97`.
- Current official README/database grant: CC BY 4.0 with attribution: “BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International”. The same README explicitly lists the two Release 4.0 archives used here.

The provenance validator scans the official compound/element tables, checks both archive SHA/size/ZIP CRC, and reads all 3,492 OBJ headers. Every scanned OBJ header carries the old CC BY-SA 2.1 Japan notice. The README date is 2025-02-27; the README license section says 2025-02-25, and update history says the license was updated on 2025-02-27. This branch follows the current official README/database terms for the expressly listed archives, includes the exact attribution and modification notice, and discloses rather than edits away the older embedded notices. That reading is evidence-based but the old-header discrepancy remains an interpretive uncertainty. No extra written-permission prerequisite is assumed where the current official grant covers the listed material.

Validation report (local source archives are intentionally not committed): `3d-model/checkpoint-11-20260926/sources/bodyparts3d-release-4.0/source-validation-report-v2.json`. Re-run with `python scripts/body-map/validate-bodyparts3d-source-v2.py -- --source-root 3d-model/checkpoint-11-20260926/sources/bodyparts3d-release-4.0`; the validator refuses to replace an existing report.

## Required missing muscles

Exact-name searches of the six official IS-A/PART-OF names, inclusion, and compound/element tables find no mesh entry for latissimus dorsi, rectus abdominis, internal oblique, or transversus abdominis. The generic `FMA9620` muscle-of-abdomen and `FMA20278` anterior-abdominal-wall compounds resolve to FJ1452/FJ1452M; their OBJ headers identify right/left external oblique. They do not supply the four required structures. No neighboring mesh is relabeled.

The branch adds bilateral, independently authored closed volumes with stable IDs for those four concepts. Construction records the anatomical attachment and fiber-direction intent and is not copied from Z-Anatomy or from a neighboring BodyParts3D object. These are educational visualization approximations, not clinical/surgical models; an anatomy-qualified visual review remains required before claiming authoritative geometry.

| BodyCast anatomy ID | Representation | Selection identity | Side coverage | Depth |
|---|---|---|---|---|
| `latissimus_dorsi` | BodyCast-authored closed volume | `bodycast-authored-latissimus-dorsi-{left,right}` | Bilateral | Superficial |
| `rectus_abdominis` | BodyCast-authored paired belly volumes | `bodycast-authored-rectus-abdominis-{left,right}` | Bilateral | Superficial |
| `internal_oblique` | BodyCast-authored closed flank volumes | `bodycast-authored-internal_oblique-{left,right}` | Bilateral | Deep |
| `transversus_abdominis` | BodyCast-authored closed flank volumes | `bodycast-authored-transversus_abdominis-{left,right}` | Bilateral | Deep |

The remainder of the selectable taxonomy is mapped to source objects by the versioned visual mapping. The v3 runtime manifest records 152 selectable nodes, 224 context nodes, 20 BodyCast groups and 75 taxonomy anatomy IDs. Mesh IDs for both sides of each anatomy are retained independently; the manifest drives the UI and does not add hardcoded muscle labels to the viewer.

## Files and delivery

- Editable scene: `3d-model/bodyparts3d-v3/bodyparts3d-v4.0-full-body-v3.blend` (copied from the validated local v3 output).
- Blender source generator: `scripts/body-map/add-authored-bodyparts3d-anatomy.py`.
- v3 mapping contract: `3d-model/bodyparts3d-adapter-v2/visual-mapping-v3.json`.
- Versioned static delivery: `public/body-map/bodyparts3d-v3/bodyparts3d-v4.0-full-body-v3.glb` and `public/body-map/bodyparts3d-v3/manifest.json`.
- Required credit and embedded-notice disclosure: `public/body-map/bodyparts3d-v3/ATTRIBUTION.md`.
- Blender preview renders (not browser QA): `3d-model/bodyparts3d-v3/previews/`.
- Public URL path after deployment: `/body-map/bodyparts3d-v3/bodyparts3d-v4.0-full-body-v3.glb`. The asset is not required from an ignored local path. This branch does not add the viewer to production navigation or deploy it.

The public static manifest carries the shared catalog/taxonomy/navigation/camera contracts, mesh identity manifest, source hashes and license disclosure; it omits demo exposure and user data. A deployment smoke check must still verify the public URL after a feature deployment or merge.

## Rebuild and verify

The local generator writes into an ignored, versioned path and refuses to overwrite artifacts:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background `
  '3d-model/local-assets/bodyparts3d-v4.0-full-body.blend' `
  --python scripts/body-map/add-authored-bodyparts3d-anatomy.py -- `
  --base-report 3d-model/local-assets/bodyparts3d-v4.0-generation-report.json `
  --mapping 3d-model/bodyparts3d-adapter-v2/visual-mapping-v3.json `
  --out-dir 3d-model/local-assets/bodyparts3d-v3 --revision v3

npm run body-map:manifest:v3
node scripts/body-map/validate-local-runtime.mjs `
  3d-model/local-assets/bodyparts3d-v3/body-map-runtime-manifest-v3.json `
  3d-model/local-assets/bodyparts3d-v3/validation-report-v3.json
npm run body-map:delivery:v3
```

The `wx`/existing-directory guards mean rerunning generation is intentionally non-destructive. Choose a new revision and output path for subsequent edits.

## Scope boundary

The `/dev/body-map` route remains a development prototype. On this feature branch its default local manifest is `3d-model/local-assets/bodyparts3d-v3/body-map-runtime-manifest-v3.json`; set `BODY_MAP_MANIFEST_PATH` only when reviewing another local candidate. The static delivery is a prepared model contract for future integration, not a completed production Body Map page.
