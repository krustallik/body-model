# Body Map local development

The interactive viewer is development-only at `/dev/body-map`. It reads a local runtime manifest and one GLB from `3d-model/local-assets/`. That directory is ignored by Git. A fresh checkout builds without anatomy files, but the viewer reports that its local asset is unavailable until the developer supplies a matching manifest/GLB pair.

## Local files

Place these files under the ignored directory:

```text
3d-model/local-assets/body-map-runtime-manifest.json
3d-model/local-assets/body-map-full-body.glb
```

The manifest's single `runtimeAssets[0].path` must be `3d-model/local-assets/body-map-full-body.glb`. Its SHA-256 and byte length must match the GLB in both `runtimeAssets[0]` and `viewerAsset`. The manifest must preserve the BodyCast group, taxonomy, bilateral selection, visual identity, and camera-bound contracts. Do not use synthetic production identities to fill a missing manifest.

## Obtaining and preparing an anatomy asset

The prior local prototype used Z-Anatomy source revision `e38ea5e6c7e22d229a975f3fde563a5aca52099e`, opened with Blender 5.2.2. Obtain any source only from the [official Z-Anatomy repository](https://github.com/Z-Anatomy/Models-of-human-anatomy) and inspect its pinned [`License.txt`](https://raw.githubusercontent.com/Z-Anatomy/Models-of-human-anatomy/e38ea5e6c7e22d229a975f3fde563a5aca52099e/License.txt) before use. That file states CC BY-SA 4.0 for Z-Anatomy material and requests these model credits when distributing copied or derived model content:

```text
BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan
Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0
```

The pinned notice also identifies the original model authors (Kousaku OKUBO for BodyParts3D; Gauthier KERVYN for Z-Anatomy design, 3D and anatomy) and separately lists reference or adapted components: University of Washington/Brainder white matter, University of Dundee cranial nerves and foramina (CC BY 4.0), University of Dundee inner ear (CC BY-NC-SA 4.0), and Lissie Cowley kidney (CC BY-NC 4.0). The notice does not state a separate license for every named component. Check the actual objects and their provenance in any candidate asset; exclude non-commercial or uncleared components from redistribution. Do not assume the current BodyParts3D CC BY 4.0 notice retroactively changes the license attached to older downloaded derivatives: the archived 2011 BodyParts3D terms state CC BY-SA 2.1 Japan.

The current repository publishes neither the upstream license file nor any derived GLB, Blender file, mesh inventory, object binding, generated manifest, or preview. These attribution instructions apply to a locally used or separately approved derived anatomy asset only. They do not declare a license for the original BodyCast application code and do not authorize redistribution of an asset.

The original full-body source-selection bindings and export specifications remain in the preserved local development archive because they encode source-specific object selections. They are not part of this clean publication history. The checked-in Blender utility can remove explicitly identified non-selectable context meshes from a local editable scene; it does not reconstruct the source selection manifest. A developer needs a locally licensed source asset and a matching local runtime manifest. Do not add the local inputs or derived outputs to Git, GitHub Releases, Pages, a CDN, or a deployment without a separate asset-level license review. The checked-in viewer code does not grant rights to redistribute anatomy data.

For this machine, retain the existing ignored Blender/GLB sources in the original archive worktree. To inspect that pipeline without changing the archive, use:

```powershell
git show bodycast/full-3d-local-archive-20260926:3d-model/checkpoint-10-20260925/scripts/export_z_anatomy_full_body_v2.py
```

Copy the editable `.blend` input and matching runtime manifest into `3d-model/local-assets/`. Run the Blender helper with context identities verified from that local manifest, then prepare and validate the runtime manifest:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background `
  '3d-model/local-assets/input.blend' `
  --python scripts/body-map/filter-local-scene.py -- `
  --manifest '3d-model/local-assets/input-manifest.json' `
  --output-blend '3d-model/local-assets/body-map-full-body.blend' `
  --output-glb '3d-model/local-assets/body-map-full-body.glb' `
  --report '3d-model/local-assets/export-report.json' `
  --exclude-id '<local-context-mesh-id>'

node scripts/body-map/prepare-local-manifest.mjs `
  '3d-model/local-assets/input-manifest.json' `
  '3d-model/local-assets/body-map-runtime-manifest.json' `
  '3d-model/local-assets/body-map-full-body.glb' `
  '3d-model/local-assets/export-report.json' `
  '<same-local-context-mesh-id>'
node scripts/body-map/validate-local-runtime.mjs
```

Repeat `--exclude-id` and the trailing mesh-ID argument for each verified context mesh to omit. The helpers verify that each requested ID is present in the local manifest, marked non-selectable, and present in the editable scene before removal. They preserve all selectable identities and write only beneath the ignored local-assets directory. The viewer reads only `3d-model/local-assets/body-map-runtime-manifest.json` and never downloads an asset during build or startup.

## Validate and run

With a local manifest/GLB pair present:

```powershell
node scripts/body-map/validate-local-runtime.mjs
npm run dev -- --port 3187
```

The validator checks the manifest/asset checksum, GLB mesh identities, selectable versus context counts, taxonomy/group bindings, and the Khronos glTF Validator result. Its JSON report is written into the ignored local asset directory. The normal production build does not execute the local asset pipeline and the viewer route returns not found outside development.

The local runtime manifest and geometry remain separate files. The viewer code does not contain the source meshes or source object bindings; it consumes a manifest supplied locally. The presence of source attribution does not clear third-party components or authorize asset redistribution. No root software license is added by this workflow.

## BodyCast contracts versus source bindings

The checked-in catalog, exercise exposure contract, URL state, and selection logic use BodyCast-owned stable IDs and standard anatomical terms. They contain no upstream FMA IDs, Z-Anatomy object names, source mesh IDs, copied mesh inventory, or geometry. The association from a local asset's objects to BodyCast taxonomy IDs lives in the separately supplied runtime manifest, which is ignored by Git. This describes the contents and boundary of the checked-in code; it is not a license for a future manifest or asset. Re-audit any generated source names, identifiers, selection tables, or other extracted metadata before publishing them.
