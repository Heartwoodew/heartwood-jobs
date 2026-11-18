# CallUp for Windows

CallUp for Windows is a small desktop program that opens the live app at <https://app.callupapp.com.au/app/>. Sign-in, jobs, quotes, files and billing stay in that site. This folder does not copy them.

The program is [Tauri 2](https://v2.tauri.app/). The window is the system web view (WebView2 on Windows). The same CallUp account works in the browser and in the program.

Publisher: Heartwood Earthworx Pty Ltd. App name: CallUp. Package id: `com.callupapp.desktop`.

## What the window does

- Email and password sign-in, and the in-app “Email reset link” button, run on the live site. The reset message arrives in the person’s inbox. That link opens in the normal browser, where they choose a new password, then they sign in again in CallUp.
- Stripe Checkout, the billing portal, map links and `mailto:` links open in the normal browser. CallUp itself stays open.
- CSV exports, PDFs and other downloads are saved in the user’s Downloads folder. If that name is already there, the next file is `name (2).ext`.
- File pickers are the normal Windows pickers from the web page. Printing uses the page’s print command, including a quote or SWMS opened in a second window.
- A Google sign-in popup, if one is added to the site later, stays in a CallUp window so it can return to the page. The site today signs in with email and password.
- Login, IndexedDB and offline data stay in the WebView2 profile (`%APPDATA%\com.callupapp.desktop`). Closing the program does not sign the person out.
- A second launch focuses the window that is already open.
- The window remembers its size, position and whether it was maximized.
- The icon is the CallUp app icon from `app/icons/icon-512.png`.

The page can see `window.__CALLUP_DESKTOP__`. That flag hides the browser’s “Install on this PC” / “Download for Windows” bar inside the program. It does not grant the page access to the disk or the shell.

## Build on Windows

Install the [Microsoft C++ build tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Desktop development with C++), the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (already present on current Windows 10 and 11), [Rust](https://rustup.rs/), and Node.js 22.

WiX 3 is required for the `.msi`. `light.exe` must be on `PATH`. The GitHub workflow unpacks WiX 3.14 if the runner does not have it. NSIS is fetched by Tauri.

```powershell
cd desktop
npm ci
npm run tauri build
```

Installers:

- `desktop/src-tauri/target/release/bundle/nsis/*-setup.exe` (current user, no administrator prompt)
- `desktop/src-tauri/target/release/bundle/msi/*.msi`

`npm run tauri dev` opens a debug window on the live site.

To produce updater signatures locally, set the private key first (see Updates) and run:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw path\to\callup-updater.key
node scripts/updater-artifacts.mjs
npm run tauri build
```

`scripts/updater-artifacts.mjs` sets `bundle.createUpdaterArtifacts` from whether `TAURI_SIGNING_PRIVATE_KEY` is set. The committed config leaves it `false`, so a build with no key still produces installers.

## Test

Link rules (no Windows machine required):

```powershell
cargo test --manifest-path desktop/src-tauri/Cargo.toml
```

On Linux the same command needs the Tauri GTK dependencies (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`) because the desktop crate links the web view.

The browser install bar:

```powershell
cd cloud
node --test test/desktop-install.test.js
```

On a Windows PC, after installing:

1. Sign in with email and password. Close CallUp, open it again, and confirm you are still signed in.
2. Use Forgot password and open the email on this PC. The link should open in the browser. Set a password there, then sign in in CallUp.
3. Export a CSV (hours or invoices). The file should land in Downloads.
4. Upload a file from a job or a receipt.
5. Print a quote, or use Print / save as PDF.
6. Open a map link and a billing link. The browser should open. CallUp should stay on the page you were on.
7. Start CallUp a second time. The existing window should come forward, not a second copy.
8. Resize the window, quit, and open it again. The size and position should return.

## Release

1. Bump `version` in `desktop/src-tauri/tauri.conf.json` and `desktop/package.json` to the same `x.y.z`. The updater compares that number, not the git tag.
2. Commit and push.
3. Tag and push `desktop-vX.Y.Z` (for example `desktop-v0.1.0`). Do this when you want a release. Pushing the tag starts the Windows build.
4. The workflow `.github/workflows/desktop-windows.yml` runs on `windows-latest` and uploads the `.exe` and `.msi` as workflow artifacts. For a tag, it also creates a **draft** GitHub Release and attaches the installers. It does not publish the release.
5. Open the draft, read it, and publish it when the installer is the one you want people to download. Updates only see a published release. GitHub’s `releases/latest` ignores drafts.
6. When the download should appear in the browser, set `WINDOWS_DOWNLOAD_URL` in `app/features/desktop-install.js` to an `https` URL (the release page, or a stable installer URL) and deploy the CallUp web app. An empty string hides the link. That deploy is separate from this installer.

You can also run the workflow by hand: Actions → Desktop Windows → Run workflow. That produces artifacts and does not create a release. The workflow file has to be on the default branch before GitHub will show that button. A pull request that changes `desktop/` builds an installer on the pull request without a release.

## Updates

The program checks GitHub Releases at startup:

`https://github.com/Heartwoodew/heartwood-jobs/releases/latest/download/latest.json`

If that file offers a newer signed version, CallUp downloads it and installs it in the background (a small progress window on Windows), then restarts. A missing file, a draft release, or a bad signature is ignored and CallUp still opens.

Tauri signs those update files with its own minisign key. This is not the Windows Authenticode certificate below. Both can be used together.

Generate a key on a trusted computer. Do not commit the private key.

```powershell
cd desktop
npm ci
npx tauri signer generate -w $env:USERPROFILE\.callup\updater.key
```

Put the public key in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. The key already in that file matches a private key that was generated for this app and was **not** committed. If you do not have that private key, generate a new pair and replace the public key before the first update you expect people to install. An update signed by a different key will be rejected.

GitHub Actions secrets (repository Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password, or leave the secret unset if the key has none |

The workflow turns on `createUpdaterArtifacts` only when `TAURI_SIGNING_PRIVATE_KEY` is set. With the secret, the draft release also gets `latest.json` and the `.sig` files. Publish the draft for the running program to see them.

## Windows SmartScreen and code signing

These installers are not Authenticode-signed. Windows SmartScreen will say “Windows protected your PC” / “Microsoft Defender SmartScreen prevented an unrecognized app from starting”. The person can choose **More info**, then **Run anyway**. That is expected for an unsigned program. Do not turn SmartScreen off.

Buying a certificate is not part of this setup. When you have one later:

1. Export the code-signing certificate as a `.pfx` (certificate plus private key). Keep the file off the git repo.
2. Base64-encode it with no line breaks: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("callup.pfx"))`.
3. Add GitHub Actions secrets:
   - `WINDOWS_CERTIFICATE` — that base64 string
   - `WINDOWS_CERTIFICATE_PASSWORD` — the `.pfx` password
4. Tauri reads those two variables while it builds and signs the `.exe` and the installers. `bundle.windows.timestampUrl` is already `http://timestamp.digicert.com`, so the signature stays valid after the certificate expires. `bundle.windows.digestAlgorithm` is `sha256`.
5. Alternatively, install the certificate in the Windows certificate store on the build machine and set `bundle.windows.certificateThumbprint` to its thumbprint. Prefer the secrets on GitHub-hosted runners.

An ordinary OV certificate still shows a SmartScreen warning until Microsoft has seen enough installs. An EV certificate, or Azure Trusted Signing (Microsoft’s cloud signing service), usually gets a reputation sooner. Either one is a later purchase. The updater minisign key does not remove the SmartScreen warning.

## Web install

Desktop Chrome and Edge can also install the site with the browser’s own install prompt. That path is `app/features/desktop-install.js` (“Install on this PC”). It is hidden on phones, inside an installed window, and inside this program. “Download for Windows” is the link described above. The manifest already uses `display: standalone`, a start URL of `/app/`, and 192 and 512 icons. `display_override` and `launch_handler` ask a desktop install to reuse one standalone window.

Shipping that bar means deploying the web app (`app/sw.js` is `callup-shell-v133-desktop`). The Windows installer does not deploy the site.
