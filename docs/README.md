# Project record

Design notes, implementation plans, turn reports and review records, kept in date order.

These moved here from `charlie754/Discord-Translator`, the original userplugin repository, when
that repo was archived — the paper trail belongs with the code it describes.

| | |
|---|---|
| `superpowers/plans/` | what was going to be built, and why that shape |
| `superpowers/specs/` | what was actually built, with the evidence each claim came from |
| `council/` | independent reviews of that work |

Two conventions worth knowing if you read these:

**Claims name their evidence layer.** "Verified" is not enough — a check against the source proves
something different from a check against the built artifact, and several defects here were found
precisely because an earlier claim had been measured at the wrong layer.

**Defects are recorded, including the ones introduced while fixing something else.** The reports are
a record of what happened, not a case for the work. Where a fix was wrong the first time, that is
written down too.
