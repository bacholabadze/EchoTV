# Rehearsal media

Stand-ins until the real creators upload their own work from the Production Board.
Uploading replaces the asset, changes its SHA-256 and requires new editorial approval.

| Asset | Work | Rights |
|---|---|---|
| art-1.jpg | Katsushika Hokusai, *Under the Wave off Kanagawa (The Great Wave)*, ca. 1830–32 | Public domain (CC0), The Met Open Access — https://www.metmuseum.org/art/collection/search/45434 |
| art-2.jpg | Vincent van Gogh, *Wheat Field with Cypresses*, 1889 | Public domain (CC0), The Met Open Access — https://www.metmuseum.org/art/collection/search/436535 |
| art-3.jpg | Georges Seurat, *Circus Sideshow (Parade de cirque)*, 1887–88 | Public domain (CC0), The Met Open Access — https://www.metmuseum.org/art/collection/search/437654 |
| demo-track.mp3 | *First Light*, 60 s, synthesised deterministically by `tools/make-demo-track.py` (no samples, no AI generation) | CC0, authored for ECHO |

`isPublicDomain: true` was checked through the Met collection API on 2026-10-17; images were downscaled to 1920 px width.
In the demo, the gallery is presented as a curated selection by Creator A, credited to the original artists. It is not presented as Creator A's own artwork.
Host voice lines are synthesised at publish time with Piper `en_US-ljspeech-high` (see `dist/studio/audio/ATTRIBUTION.txt`).
