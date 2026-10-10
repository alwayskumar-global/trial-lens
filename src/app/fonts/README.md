# Self-hosted fonts

Latin subsets of the three fonts in the Claude Design handoff, committed so the build never depends on a font
download (the `next/font/google` build failed on Vercel with Turbopack: "next/font/google queries have exactly one
entry") and so visitors' browsers make no request to Google.

| File | Family | Weights | License |
|---|---|---|---|
| `fraunces-latin-variable.woff2` | Fraunces (variable) | 500, 600 used | SIL Open Font License 1.1 |
| `figtree-latin-variable.woff2` | Figtree (variable) | 400, 500, 600 used | SIL Open Font License 1.1 |
| `ibm-plex-mono-400-latin.woff2` | IBM Plex Mono | 400 | SIL Open Font License 1.1 |

Source: the Google Fonts woff2 files for the `latin` subset (fonts.google.com). Characters outside the latin subset
(for example some Latin Extended letters) fall back to the system font stack. OFL 1.1: https://openfontlicense.org
