# Source and license review

Date: **2026-11-02**. Product: **Codex Manager 0.1.0**.

## Finding

Comparison against a local Antigravity Manager checkout found no exact application-file matches or clear copied application implementation. This **does not prove complete originality**. The project uses third-party libraries, icons and fonts, whose licenses must be retained.

The owner selected **CC BY-NC-SA 4.0** for project contributions. Because it restricts commercial use, the project is described as source-available rather than OSI open source. Creative Commons licenses are not specifically designed for software.

## Scope and method

- Compared 43 product `.ts`, `.tsx`, `.js`, `.cjs`, `.mjs`, `.css`, `.html` and `.svg` files against 1,511 reference files with matching extensions.
- Excluded `node_modules`, `.git`, `dist`, `.vite`, `.taste-skill` and `coverage`.
- Partially normalized comments and whitespace, searched for shared 25-token sequences, and measured the longest common token sequence in candidate pairs.
- Checked SHA-256 for exact source/asset matches. The main LICENSE and npm lockfile were excluded from that exact-match finding.
- Manually reviewed meaningful candidates. Protocol fields and conventional programming patterns were not treated as independent evidence of copying.

Machine output, candidates and the reviewed product-file hashes are preserved in [provenance-audit.json](provenance-audit.json). This report describes that snapshot, not a new exhaustive scan of subsequent changes.

## Similarities found

| Area | Observation | Assessment |
| --- | --- | --- |
| Complete files | No exact product-file match | Excludes the main license, lockfile and external dependencies. |
| Accessibility CSS | Longest sequence: 57 tokens in `prefers-reduced-motion` | Common reduced-animation pattern; not proof of origin. |
| Test servers | 27–29 tokens around `server.listen(0, '127.0.0.1', resolve)` | Standard Node test pattern; some matches appeared in tests added during the review. |
| React field | 29 tokens around Enter and `event.currentTarget.blur()` | Short conventional event handler. |
| Port validation | 26 tokens validating 1024–65535 through Zod | Conventional range and library usage. |
| Other candidates | Short HTML scaffolding, JSON errors and HTTP callbacks | No distinctive application block identified. |

Fourteen file pairs exceeded the 25-token threshold. This does not mean fourteen copied snippets: one short conventional pattern can occur in several reference files.

## Architectural inspiration and protocol information

Local design documents explicitly record reviewing Antigravity Manager's separate core, gateway and account-pool architecture. Architectural inspiration is distinct from source-code copying. An earlier categorical originality claim was replaced with the narrower finding supported by this review.

The local blueprint also records observing some OAuth/plan endpoints in a third-party Codex Manager binary. That binary was not compared in this review. Observing protocol endpoints alone does not establish source copying, and this review reaches no conclusion about that binary's license or terms.

## Third-party content

The initial lockfile snapshot contained 267 external package records:

| Declared license | Records |
| --- | ---: |
| MIT | 237 |
| ISC | 14 |
| BSD-3-Clause | 9 |
| Apache-2.0 | 3 |
| BSD-2-Clause | 2 |
| CC-BY-4.0 | 1 |
| MIT OR CC0-1.0 | 1 |

These are package records, including development and optional platform packages, not a count of shipped modules. The CC-BY-4.0 record is `caniuse-lite` data. See the current [dependency inventory](dependency-licenses.json) for the later packaging snapshot.

Lucide/Feather notices, IBM Plex's OFL and direct dependency license texts have been retained. Electron distributions must retain Chromium notices as well. The project license does not change third-party copyrights or licenses. See [third-party notices](../THIRD_PARTY_NOTICES.md).

## Limitations and outstanding work

This comparison does not cover the whole internet, every historical version or substantially transformed/renamed code. It did not perform visual similarity analysis of binary assets; differing hashes do not establish original design. Font binaries have not been traced to a specific upstream release. Package-declared licenses are not an independent legal review.

Complete font/icon provenance records and review the notices included in each distribution before a stable release. Any later borrowed source should record its file, source, author, license and modifications. Secret scanning, Git history review and OAuth distribution terms require separate checks from source similarity.

## References

- [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- [Creative Commons guidance on software](https://creativecommons.org/faq/#can-i-apply-a-creative-commons-license-to-software)
- [Open Source Definition](https://opensource.org/osd)
- [IBM Plex license](https://github.com/IBM/plex/blob/master/LICENSE.txt)
