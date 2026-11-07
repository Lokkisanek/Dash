# Third-party code

| Component | Version | License | Location | Used for |
|---|---|---|---|---|
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase | 2.0.4 | MIT | `custom_components/guest_ha_dashboard/www/vendor/qrcode-generator/` | QR codes in the HA panel (pairing and Wi-Fi); no network access |

- Copied unmodified from the npm package `qrcode-generator@2.0.4` (`dist/qrcode.mjs`, `dist/qrcode_UTF8.mjs`; tarball integrity `sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g==`) and renamed to `.js`, so every web server serves them as JavaScript.
- The license text is in `LICENSE` next to the files, taken from the upstream repository.
- "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

The guest app in `src/` uses the npm dependencies listed in `package.json`.
