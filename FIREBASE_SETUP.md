# Firebase setup for the DSD Order App

Do this once, on a computer (not your phone). About 10 minutes.

## 1. Create the Firebase project

1. Go to **https://console.firebase.google.com**
2. Click **Add project** (or "Create a project").
3. Name it `dsd-orders` (any name works).
4. When it asks about Google Analytics: choose **off** (simplest), then **Create project**.
5. Wait for it to finish, then click **Continue**.

## 2. Register a web app and copy the config

1. On the project overview page, click the **`</>`** (web) icon to add a web app.
2. Nickname: `dsd-pages`. Leave "Firebase Hosting" **unchecked**.
3. Click **Register app**.
4. You'll see a code block with `firebaseConfig`. Click **Continue to console** — you can
   get the config again any time under **Project settings** (gear icon, top-left) →
   **General** → **Your apps** → **SDK setup and configuration** → **Config**.
5. Open `js/config.js` in the app folder and paste your values over the `"PASTE"` placeholders:

```js
const firebaseConfig = {
  apiKey: "AIzaSy…",            // ← paste yours
  authDomain: "dsd-orders.firebaseapp.com",
  projectId: "dsd-orders",
  storageBucket: "dsd-orders.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef…",
};
```

That's the only file you ever need to edit. Upload the folder to GitHub Pages again
after pasting (see `DEPLOY.md`).

## 3. Turn on Firestore

1. In the left menu, click **Build → Firestore Database**.
2. Click **Create database**.
3. Choose **Start in production mode** (we set the real rules below), click **Next**.
4. Pick the location closest to you (e.g. `us-east1`), click **Enable**.
5. Wait a minute for it to provision.

## 4. Turn on Anonymous Auth

1. In the left menu, click **Build → Authentication**.
2. Click **Get started**.
3. Open the **Sign-in method** tab.
4. Click **Anonymous**, flip the **Enable** switch, click **Save**.

The app signs in anonymously on every load — no password, no login screen.

## 5. Set the security rules

1. In Firestore Database, open the **Rules** tab.
2. Replace everything with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

3. Click **Publish**.

## What these rules actually mean (read this)

These rules say: **anyone who is signed in may read and write everything.**
Anonymous Auth signs in every visitor automatically and silently — there is no
password and no identity check. So in practice, **anyone who opens your app's URL
can read and change your orders.**

That is fine as long as the URL stays private (GitHub Pages can host it, but the
URL itself isn't secret — anyone who guesses or receives the link gets full
access). What it does NOT give you:

- It does **not** restrict access to only your phone or only your Google account.
- It does **not** stop someone with the link from editing or deleting data.

If you ever want true privacy, the upgrade path is switching Anonymous Auth to
**Google sign-in** (one extra step in the console + a small code change) and
tightening the rules to `request.auth.token.email == "your-email"`. The app is
structured so that change is small — ask and it can be done.

## First run

1. Open the app URL once **with internet** — it signs in, seeds the 215-product
   catalog into Firestore, and caches the app shell for offline use.
2. After that, it works in dead-signal stores: changes save to the phone and
   sync to Firestore automatically when you're back online.
