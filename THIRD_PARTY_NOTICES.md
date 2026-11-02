# Third-party notices

Codex Manager's own contributions are licensed under CC BY-NC-SA 4.0. Third-party components retain their own licenses. The project's noncommercial restriction does not change the independent rights granted by those components.

## Main JavaScript components

Installed versions reviewed on 2026-11-02 are listed below, including development tools for transparency. License texts were copied without modification.

| Component | Version | License | License / notice text |
| --- | --- | --- | --- |
| fastify | 5.12.7 | MIT | [LICENSE](licenses/npm/fastify--LICENSE) |
| lucide-react | 1.65.0 | ISC | [LICENSE](licenses/npm/lucide-react--LICENSE) |
| zod | 4.6.7 | MIT | [LICENSE](licenses/npm/zod--LICENSE) |
| ws | 8.22.1 | MIT | [LICENSE](licenses/npm/ws--LICENSE) |
| react | 19.3.1 | MIT | [LICENSE](licenses/npm/react--LICENSE) |
| react-dom | 19.3.1 | MIT | [LICENSE](licenses/npm/react-dom--LICENSE) |
| electron | 45.2.1 | MIT | [LICENSE](licenses/npm/electron--LICENSE) |
| vite | 6.4.5 | MIT | [LICENSE.md](licenses/npm/vite--LICENSE.md) |
| typescript | 5.9.3 | Apache-2.0 | [LICENSE.txt](licenses/npm/typescript--LICENSE.txt), [ThirdPartyNoticeText.txt](licenses/npm/typescript--ThirdPartyNoticeText.txt) |
| tsx | 4.23.15 | MIT | [LICENSE](licenses/npm/tsx--LICENSE) |
| smol-toml | 1.9.1 | BSD-3-Clause | [LICENSE](licenses/npm/smol-toml--LICENSE) |
| electron-builder | 26.18.0 | MIT | [LICENSE](licenses/npm/electron-builder--LICENSE) |

Full lockfile inventory: [dependency-licenses.json](docs/dependency-licenses.json). It includes transitive and platform-specific optional packages. The table above is not a complete notice bundle for every transitive dependency; distributions must retain the required notices for the components they include.

Among the 51 production dependencies, `abstract-logging` 2.0.1 has no standalone LICENSE file and its README links to its author's MIT license page. An unchanged copy is included as the [MIT notice](licenses/npm/abstract-logging--MIT.html); its README is retained in the package.

Lucide's license includes the MIT notice for Feather-derived icons. Electron distributions must retain both `LICENSE` and `LICENSES.chromium.html`; Chromium's notices do not replace Electron's MIT license.

## IBM Plex fonts

Font files used as IBM Plex Sans / Mono are located in `ui/public/fonts/` and `electron/assets/fonts/`. IBM Plex is distributed under the SIL Open Font License 1.1.

- [Upstream source](https://github.com/IBM/plex)
- [IBM Plex OFL](licenses/ibm-plex/OFL.txt)
- Copyright © 2017 IBM Corp. with Reserved Font Name "Plex".

The fonts are not relicensed under the project's noncommercial restriction. This review did not trace the binary files to a specific upstream IBM release; that provenance check remains outstanding.

## Antigravity Manager

The separate core process, local gateway and account-pool architecture were inspired by Antigravity Manager. A local comparison found no clear copied application implementation. The [provenance review](docs/provenance-audit.md) records the method, short common patterns and limitations. This attribution does not imply that Antigravity source is distributed here or that its authors endorse this project.
