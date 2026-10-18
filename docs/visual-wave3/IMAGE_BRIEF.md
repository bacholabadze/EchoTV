# Wave 3 — image-generation brief (optional, not required for anything shipped)

Nothing in Wave 3 depends on a generated image. The set already has a modelled ECHO / Hacktoberfest board (`festival-set.glb`); the opening uses lights, camera and an HTML lower-third. If a generated backdrop is ever wanted, this is the brief. Generated imagery must never be presented as proof that the programme works.

**Asset:** one LED-wall backdrop texture for the board behind the moderator.
**Prompt for ChatGPT image generation:**
> Flat, front-on graphic for a television studio LED wall. Deep forest-green background (#10271f) with a very subtle darker vignette. Centered thin brass-gold horizontal rule, and above it the word "ECHO" in a clean geometric sans-serif, light cream (#d3dbc5), wide letter-spacing. Below the rule, small caps "THE TABLE" in the same cream. No people, no photographs, no gradients that read as screen glare, no logos other than the text, no borders. Minimal, editorial, broadcast-design quality.
**Format:** 2048×1024 PNG, sRGB, no alpha. Text within the central 70% so the board's bevel does not clip it.
**Fallback already in place:** the modelled board, and the procedural canvas wordmark in `room.js` (hidden while the festival set is loaded).
