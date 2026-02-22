# VMill

VMill is a browser CNC simulator built with React, Three.js, and a WASM machine kernel.

## What it includes

- CNC jog and work offset workflow
- G-code playback with path visualization
- Tool/holder assembly management
- STEP import preview workflow
- Experimental stock material removal (Manifold)

## Tech stack

- Vite + React + TypeScript
- Three.js
- Rust/WASM kernel consumed from `machine-core/pkg`

## Local development

```bash
npm ci
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to Vercel

This folder is Vercel-ready (`vercel.json` included).

If your repository root is one level above this folder, set:

- Root Directory: `vmill`
- Build Command: `npm run build`
- Output Directory: `dist`

CLI deploy:

```bash
vercel
vercel --prod
```

## New Git repo quick start

From this folder (`vmill`):

```bash
git init
git branch -M main
git add .
git commit -m "Initial VMill import"
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

## License

This project is released under the included non-commercial license (`LICENSE`).
Commercial use is not permitted without written authorization.
