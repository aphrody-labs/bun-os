# Bun OS Android session image

Container image of the Android session that the WebOS session manager streams to the browser.

| Layer  | Content                                                                                                                                                                                                                                                                      | License                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Base   | redroid `13.0.0-240527` (amd64 digest pinned in `apps.json`): AOSP Android 13 userdebug built from android.googlesource.com, with its AOSP apps (Contacts, Calendar, Clock, Gallery, Search, AOSP Keyboard, DocumentsUI, Package Installer, Print, WebView shell, providers) | Apache-2.0 (AOSP), per-project NOTICE files in the image |
| microG | GmsCore 0.3.17.252432, FakeStore (`com.android.vending`), GsfProxy: open-source Google Play services replacement                                                                                                                                                             | Apache-2.0                                               |
| Stores | F-Droid 1.23.2 + F-Droid Privileged Extension 0.2.14 (unattended installs), Aurora Store 4.8.4                                                                                                                                                                               | GPL-3.0 / Apache-2.0                                     |

## Build and run (VPS)

```sh
sh factory/images/bunos-android/fetch.sh                      # pinned APKs, sha256-verified
docker build -t bunos-android:latest factory/images/bunos-android
sh factory/images/bunos-android/run.sh bunos-android 5555      # loads binder_linux, starts the session
```

The session manager owns the container lifecycle, the per-user `/data` volume and the stream (scrcpy/adb on
loopback). `run.sh` is the reference invocation.

## Store publication

`extract-aosp-apks.sh <dir>` copies the standalone AOSP apps of the base (launcher activity, no
`sharedUserId`) with an `index.tsv`; with the `publish: true` entries of `apps.json` (upstream-signed, unmodified)
they are the Android apps the Store publishes in the Bun OS F-Droid repository. Framework components (providers,
Settings, Telephony, Package Installer) are not published: they only work inside a system image.

## Google apps and Play Store: user-side only

The image contains no Google proprietary binary. Google Play services, the Play Store, Pixel apps, Gmail, Maps,
YouTube and the other Google apps are licensed only for preinstallation by Google-certified device makers and
must not be mirrored or redistributed by Bun OS (repositories, site or image). Inside their own session a user can:

- install Play apps with **Aurora Store** (downloads from Google's servers, anonymous or with the user's account);
- use **microG** for account sign-in, push and location APIs. Full microG (apps that verify the Play services
  signature) needs signature spoofing, which the stock redroid build does not include; without it, apps that
  require genuine Play services keep reporting them missing;
- replace microG with the official Play Store by flashing a GApps package they obtain themselves
  (MindTheGapps/OpenGApps-style) into their own session volume, then register the session's Android ID at
  `https://www.google.com/android/uncertified` and sign in. Bun OS neither ships nor downloads that package.

## Notes

- `privapp-permissions-bunos.xml` allowlists the privileged extension's two permissions; the other apps are
  plain system apps (`/system/app`) and need no allowlist.
- Android 17 (`android-17.0.0_r1`, see `factory/aosp/projects.json`) and 16 have no bootable redroid build on this host (kernel 7.3 is not LTS).
- Why Android 13: Android 15+ (V) images refuse non-LTS kernels in `NetBpfLoad` and reboot-loop on the VPS kernel
  7.3 (`Android V+ only supports LTS kernels`); redroid 13 boots there with binderfs (`aphrody-binderfs.service`).
  Move to a newer base only on an LTS host kernel.
