# Design references

Published screenshots and press images of Android desktop mode and Google's laptop products. They are here only as
design references for interface analysis. They are never shipped in a Bun OS product, image, package or WebOS asset, and
build, packaging and asset pipelines must not pick up this directory. Each file's origin, credit and licence is recorded
in [SOURCES.json](SOURCES.json). Android Developers images are CC BY 4.0. Google press images and third-party press
screenshots (9to5Google, Android Authority) remain copyright of their owners.

- `android-17-desktop/`: Android desktop windowing (header bar, taskbar, app drawer, instance switcher) from the
  developer.android.com desktop experience guidelines and the desktop windowing guide.
- `google-pc/`: Googlebook hardware and Googlebook OS UI.

## Googlebook: verified as a real product

"Googlebook" is a real Google product name. It is a line of Gemini-centred laptops built by Acer, ASUS, Dell, HP and
Lenovo, and it succeeds the Chromebook line.

- Announced 2026-05-12 on The Keyword:
  [Introducing Googlebook, designed for Gemini Intelligence](https://blog.google/products-and-platforms/platforms/android/meet-googlebook/).
  The post says it combines Android and ChromeOS and is "built on part of the Android tech stack". Headline features are
  Magic Pointer, Create your Widget, phone app and file integration, and the glowbar.
- Pre-orders opened 2026-09-21. Retail availability started 2026-10-04 in the US and 2026-10-05 in CA, UK, IE, FR, DE
  and AU, from $899. The OS is branded "Googlebook OS", with up to 10 years of updates:
  [Googlebook: the laptop your Android phone has been waiting for](https://blog.google/products-and-platforms/devices/googlebook/pre-order-googlebook/).
- Press reviews: [9to5Google review (2026-10-12)](https://9to5google.com/2026/10/12/googlebook-os-review/) and
  [Android Authority hands-on](https://www.androidauthority.com/googlebooks-hands-on-impressions-3713390/). Press and
  leak reports name the Android 17-based OS "Aluminium OS" (ALOS). That is a codename, and Google does not use it.

## Android desktop emulator images

The Android SDK repository lists desktop system images under the `android-desktop` tag. The listing is
`https://dl.google.com/android/repository/sys-img/android-desktop/sys-img2-4.xml` (sys-img2-3.xml is the same). It has
API 32, 33, 34, 37.0 and 37.1, and no API 36. Each needs emulator 36.5 or newer.

| Package                                                 | Name                                                     | Channel | Size    | URL                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------- | ------- | ------- | --------------------------------------------------------------------------------------- |
| `system-images;android-37.1;android-desktop;x86_64`     | Google APIs Desktop (Preview) Intel x86_64 Atom          | beta    | 2.02 GB | https://dl.google.com/android/repository/sys-img/android-desktop/x86_64-37.1_r01.zip    |
| `system-images;android-37.1;android-desktop;arm64-v8a`  | Google APIs Desktop (Preview) ARM 64 v8a                 | beta    | 1.97 GB | https://dl.google.com/android/repository/sys-img/android-desktop/arm64-v8a-37.1_r01.zip |
| `system-images;android-37.0;android-desktop;x86_64`     | AOSP Desktop (Preview) Intel x86_64 Atom                 | dev     | 929 MB  | https://dl.google.com/android/repository/sys-img/android-desktop/x86_64-37.0_r01.zip    |
| `system-images;android-37.0;android-desktop;arm64-v8a`  | AOSP Desktop (Preview) ARM 64 v8a                        | dev     | 874 MB  | https://dl.google.com/android/repository/sys-img/android-desktop/arm64-v8a-37.0_r01.zip |

All four URLs returned HTTP 200 on 2026-11-03. Nothing was downloaded.

## Own emulator captures (attempted 2026-11-03)

The 37.1 desktop image (build CLE3.260929.004) boots headless on `vps`, with KVM and the `desktop_large` profile at
1920x1080. Under swiftshader, the guest `screencap` aborts on the gfxstream `hasReadColorBufferDma` assertion.
Disabling GLDMA, or using `-gpu guest`, makes system_server crash on that same assertion. No own capture is stored yet;
see docs/DESIGN-M3-WINDOWS.md.
