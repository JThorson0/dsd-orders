# Deploying the DSD Order App to GitHub Pages

The app is plain static files — no build step. You just upload the folder.

## Files in this folder

| File | What it is |
|---|---|
| `index.html` | The app page |
| `styles.css` | Navy/orange phone UI |
| `js/app.js` | All app logic |
| `js/db.js` | Firebase/Firestore layer (only loaded when configured) |
| `js/config.js` | **Your Firebase keys go here** (still says `PASTE` until you do step 1 of `FIREBASE_SETUP.md`) |
| `js/search.js`, `js/cutoffs.js` | Search + cutoff logic |
| `catalog.json` | The 215-product / 7-store catalog used for first-run seeding |
| `sw.js` | Offline cache for the app shell |
| `manifest.json` | Lets the phone "Add to Home Screen" as an app |

## 1. Create the repository

1. Go to **https://github.com/new**
2. Repository name: `dsd-orders`
3. Choose **Private** (keeps the URL unlisted — see the privacy note in `FIREBASE_SETUP.md`).
4. **Do not** add a README/license/gitignore (keeps the upload simple).
5. Click **Create repository**.

## 2. Upload the files

On the new repo page, click **"uploading an existing file"**:

1. On your computer, open this `dsd-pages-app` folder.
2. Drag **all files and the `js` folder** into the GitHub upload area
   (keep the structure: `js/` must stay a subfolder).
3. Click **Commit changes**.

## 3. Turn on Pages

1. In the repo, go to **Settings → Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)**. Click **Save**.
4. Wait 1–2 minutes. Your URL appears at the top of the Pages settings page:
   `https://YOUR-USERNAME.github.io/dsd-orders/`

## 4. After pasting your Firebase config

Whenever you change `js/config.js` (i.e. the one time you paste your Firebase keys):

1. Re-upload just that file (repo page → `js/` folder → `config.js` → pencil icon →
   paste → **Commit changes**), or drag-upload the whole folder again.
2. Wait ~1 minute and reload the app on your phone.

## Phone install

Open the URL in Chrome (Android) → menu **⋮ → Add to Home screen**.
It opens full-screen like a native app and works offline after the first visit.

## Updating later

Edit files locally, drag-upload the changed files to the repo, commit.
Pages redeploys automatically in about a minute. No build, no terminal.
