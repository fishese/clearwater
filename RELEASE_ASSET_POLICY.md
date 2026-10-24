# Public release asset policy

Updated 24 October 2026 at the user's request. Applies to future releases after 1.0.12 and supersedes historical instructions to publish debug APKs.

- Publish only signed Android release APKs. Do not publish unsigned APKs or debug APKs, or their individual checksum sidecars.
- Keep publishing the unsigned iOS IPA and its checksum; user signing remains required.
- Keep the canonical release APK/IPA download names used by existing links, required licences/notices, release provenance and aggregate checksums. Versioned release packages may retain the existing naming convention.
- Generate public checksums/provenance asset lists from the actual public staging set. Remove debug/unsigned Android entries when adapting an older release-packaging script; do not copy the old 14-asset assertion blindly.
- Debug APKs may still be built and checked locally or supplied separately for explicitly requested testing. Preserve signing identities and installed data; a debug-signed installation requires a matching-signed test update. Do not suggest uninstalling or clearing data to switch signing identities.
- Existing published releases remain unchanged. This policy does not authorize a new release or any signing configuration changes.
