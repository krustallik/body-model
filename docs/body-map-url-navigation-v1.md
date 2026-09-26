# Body Map URL navigation v1

The development viewer keeps one semantic navigation state and mirrors it to the URL through the browser History API. Next.js 16's native `pushState` and `replaceState` integration updates the App Router without navigating away from the mounted viewer.

## Parameters

| Parameter | Values | Default |
| --- | --- | --- |
| `group` | Stable Body Map group ID | omitted (overview) |
| `region` | Stable anatomy ID belonging to `group` | omitted (group detail) |
| `view` | `default`, `front`, `back`, `left`, `right` | overview: `front`; group: its catalog camera direction |
| `mode` | `muscle`, `fascia`, `skeleton`, `both-context` | `muscle` |
| `deep` | `1` | omitted |

Example:

```text
/dev/body-map?group=hip_adductors&region=adductor_longus&view=back
```

`view=default` preserves the catalog's exact oblique group camera direction where one exists. Cardinal buttons use the corresponding cardinal view. The Hip adductors catalog direction is posterior (`back`).

Bilateral muscles and subregions always select and highlight their represented left and right geometry together. The anatomical mesh manifest still preserves stable left/right mesh identities; they are asset identities, not navigation state. `view=left` and `view=right` remain camera orientations.

## History and recovery

- A user selection creates one history entry with `pushState`; repeated identical state does not add a duplicate entry.
- Browser Back/Forward parses the URL and applies the complete bilateral selection, camera orientation and display state to the mounted scene.
- Unknown groups recover to overview, except a valid region can recover to its first catalog membership. A region outside a valid requested group is dropped while retaining that group.
- Legacy `side=left`, `side=right` and `side=both` query parameters are ignored and removed with `replaceState`; the restored region remains bilateral. Camera `view=left` and `view=right` are preserved.
- Invalid view and display values recover to their defaults. Deep mode is cleared when a selected region has no deep visual geometry.
- Canonical recovery uses `replaceState`; unrelated query parameters and the hash are preserved.
- Hover, camera tween progress and graphics-quality choice are transient and are not serialized.

The URL contract is implemented in `src/modules/training/body-map-url-state-v1.ts` and covered by `tests/body-map-url-state-v1.test.ts`. Browser-level navigation and scene-persistence checks are recorded by the Checkpoint 10 follow-up QA script.
