# Time Tracker

A personal, local-first work-time tracker you install as a Progressive Web App.
It keeps your own reliable record of working hours:

- **Stored on your device first.** It works fully offline.
- **Optional sync to a private GitHub repository.** Every change becomes a commit there, so the history is tamper-evident.
- **No third-party platform.**

## Features

- **Today:**
  - One-tap **Clock in** / **Clock out**, stamped in Europe/Berlin time whatever timezone the device is set to.
  - A running clock and live net time.
  - A week chart: each day drawn as a bar on an hour axis, so you see *when* you worked, not just how long. Tap any day to edit it or fill it in.
  - Manual entry for forgotten or past days, with "Now" buttons and one-tap break choices.
- **Log:**
  - Entries grouped by ISO week (Mon–Sun), each with start, end, break, net hours and a note, plus weekly totals.
  - Tap a day to edit or delete it. A delete can be undone right away or later from Settings → Recently deleted.
- **Totals:**
  - Current week and month.
  - Optional contracted weekly hours, with a progress bar and "ahead / behind" measured only against workdays that are already over, so mid-week numbers aren't alarming.
- **Breaks:**
  - A default break (30 min unless you change it).
  - An optional warning when a break is below the German legal minimum (ArbZG §4: 30 min after 6 h, 45 min after 9 h). It only warns; your numbers are never changed.
- **Overnight shifts:** an end time earlier than the start means the next day. Daylight-saving changes are handled correctly (a 22:00–06:00 shift is 7 h in March and 9 h in October).
- **Export:**
  - CSV per week, per month, or everything, for spreadsheets. Formula injection is neutralised.
  - JSON backup and restore. Restore merges by date: the newest change wins.
- **Sync (optional):** a private GitHub repository holds one JSON file per ISO week (`2026/2026-W40.json`), with commit messages like `W40: update Wed 2026-09-30`.
  - Offline writes are queued and pushed later.
  - Concurrent edits are merged by date. If the same day changed in two places, you choose which version to keep.
- **Design:** installable and offline-capable, with light and dark themes. Keyboard and screen-reader friendly.

## Privacy and security

- **Your data:** stays in this browser's IndexedDB. With sync enabled, it also goes to _your_ private repository, and only there.
- **Third parties:** none. No analytics, CDNs, external fonts or third-party scripts. A strict Content-Security-Policy allows network access only to `api.github.com`.
- **The GitHub token:**
  - It is stored only on the device you enter it on.
  - It is never logged, never included in backups, and only ever sent to `api.github.com`.
  - Settings → GitHub sync → **Remove token** deletes it.
  - Anyone with access to this browser profile could read it, so use a fine-grained token limited to the one data repository, with a short expiry.
- **Public repository check:** the app checks whether the data repository is public. If it is, the app warns you and pauses sync.
- **Rendering:** all user input is rendered as plain text.

> GitHub Pages cannot send HTTP headers, so the CSP is delivered as a `<meta>` tag. The
> `frame-ancestors` directive therefore can't be set.

## Local development

Requires Node.js 22 (see `.nvmrc`).

```sh
npm install
npm run dev          # start the dev server
npm test             # unit tests (Vitest)
npm run lint         # ESLint + Prettier check
npm run typecheck    # TypeScript, strict
npm run build        # production build into dist/
npm run preview      # serve the production build (with service worker and CSP)
npm run check        # everything above, as CI runs it
```

- **Project layout:**

  ```
  src/domain   pure time logic: Berlin time, ISO weeks, net hours, breaks, merge, CSV/JSON
  src/storage  StorageProvider interface, IndexedDB, GitHub client and sync engine
  src/app      service layer that orchestrates domain + storage
  src/ui       views and components (DOM only, no business rules)
  src/pwa      service-worker registration and update prompt
  tests/       unit tests (domain, storage/sync with a fake GitHub, UI with jsdom)
  ```

- **Tests and timezones:** tests run with `TZ=America/New_York` to prove that nothing depends on the device timezone.
- **Icons:** regenerate them with `node scripts/generate-icons.mjs`.

## Set up the private data repository and token

1. **Create the data repository.** On GitHub go to **New repository**, name it e.g. `work-hours-data`, and choose **Private**.
   - Tick **Add a README** so the `main` branch exists.
2. **Create a fine-grained personal access token.** Go to GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**, and set:
   - **Expiration:** 90 days (or less). Put a reminder in your calendar to renew it.
   - **Repository access:** _Only select repositories_ → your data repository.
   - **Permissions → Repository permissions:**
     - **Contents: Read and write.**
     - **Metadata: Read-only** (added automatically).
     - Nothing else.

   Generate the token and copy it. GitHub shows it only once.

3. **Connect the app.** In the app, open **Settings → GitHub sync**:
   1. Enter owner, repository and branch (`main`) and paste the token.
   2. Tick **Sync with a private GitHub repository**.
   3. Press **Test connection**, then **Save sync settings**.

   Existing entries are uploaded on the first sync.

4. **Renew the token before it expires.** Create a new token, paste it, and save. Revoke old tokens on GitHub.

Do this on each device you use. Every device keeps its own full copy and syncs through the repository.

## Deploy to GitHub Pages

The app repository can be public; it contains no data.

1. Push this repository to GitHub, for example as `time-tracker`.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main`. The **Deploy to GitHub Pages** workflow runs lint, typecheck, tests and build, then publishes to `https://<user>.github.io/<repo>/`.

- **Base path:** the workflow sets `BASE=/<repo>/`. If you deploy from a `<user>.github.io` repository, change `BASE` to `/` in `.github/workflows/deploy.yml`.
- **CI:** `.github/workflows/ci.yml` runs lint, typecheck, tests and build on every push and pull request.

**Install the app:**

- **Android/Chrome:** open the site and choose **Install app** in the menu.
- **iOS Safari:** choose **Share → Add to Home Screen**.

When a new version is deployed, the app shows **A new version is available — Reload**.

## Backups

Your data lives in browser storage, and browsers can clear it. For example, clearing site data or uninstalling the browser removes it, and so can storage pressure if the app is not installed.

- **Install the app.** Settings shows whether the browser granted persistent storage.
- **Enable GitHub sync.** The private repository then holds a full, versioned copy.
- **Download a JSON backup regularly** (Settings → Export and backup), e.g. monthly. Keep it outside the browser: a cloud drive, a USB stick, or email to yourself.
- **Before switching phones or browsers,** check that sync is up to date or download a backup.
- **Use CSV exports for spreadsheets or for sharing.** The JSON backup is the complete record, including deletions.

## Limitations

- One entry per day. If you work in two blocks, record the gap as break minutes.
- Month targets assume Monday–Friday and do not know public holidays.
- On the night clocks go back, a time between 02:00 and 03:00 is read as its first occurrence (summer time).
