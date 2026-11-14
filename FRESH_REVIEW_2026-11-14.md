# Fresh review — 14 November 2026

## Authorized fix milestones

The user subsequently authorized the three defect fixes and explicitly deferred desktop work. The review below remains the historical pre-fix evidence.

- [x] Batch worker failure: terminal error state prevents posting further photos, stops the batch visibly and retains completed ZIP/folder output. Ten focused unit tests, TypeScript and Chrome failure-injection UI checks pass, including fresh retry, cancellation, custom-model preparation and partial output. The original real-worker reproduction now rejects the second request immediately. No timeout/watchdog policy added.
- [x] Android linked camera-video gallery saving: export requests snapshot media kind; worker completion no longer uses stale selection state. Production Chrome regression passes cold-load video saving, photo/video switching, correct photo hash/thumbnail updates, failed-write retry and original retention. A dev-server negative control using the old closure fails as expected. Real workers/generated media, mocked native bridge; physical Android remains untested.
- [x] Unicode PNG metadata preservation: bounded chunk/TIFF reads preserve raw comment bytes, including metadata after large IDAT chunks; invalid metadata still warns without blocking image saving. Twelve metadata tests cover JPEG/PNG roundtrips, byte order, no-comment photos and malformed CRC/offset/truncation. Original reproduction now preserves the comment without warning. Full suite: 294 tests pass; production build passes.
- [x] Final combined production build and 294 shared tests pass. Production Edge/Chrome checks pass for terminal batch failures/partial output/retry, ordinary folder output/collision/cancellation, nine multilingual mobile/desktop layouts, gallery saves and mocked iPhone export readiness/share/download flows. No new physical-device, native simulator or WebKit-engine check performed. No release or deployment authorized.
- [ ] Next: user tests/authorizes further delivery as needed. Desktop implementation remains deferred; its plan is unchanged.

Review only; no application changes implemented. Reviewed local `5f0d6a1`, whose application tree matches released `7c2db253` / v1.0.15 (only two documentation files differ). Preserved the existing modified October review, IDE files and all three stashes. Root AGENTS.md is absent; user-supplied restrictions apply. Read current handoff, maintenance/implementation checkpoints and vault overview; historical passes were not treated as proof. Three bounded independent reviews used gpt-6.1-sol at the user's request.

## Prioritized findings

### P2 — Batch can hang after its processing worker fails

**Evidence:** `editor/src/batch-photo.ts:31` rejects the current waiter on worker `error`/`messageerror`, but does not mark the processor unusable. `editor/src/BatchDialog.tsx:87` records a photo failure and continues ZIP processing with the same worker. If that worker has stopped, the next request never replies. The batch remains running and does not produce its partial ZIP; Cancel discards the archive.

**Reproduction:** Create a real Chrome module Worker whose entry throws, then process two items through BatchPhotoProcessor. First rejects with “The photo processing worker stopped.”; the second remains pending after 300 ms, with one worker error observed. This is deliberate failure injection, not a physical-device OOM reproduction. The missing terminal state is verified by source and the real worker experiment; a silent process kill may not deliver an error at all.

**Affected:** Shared batch processing on web/Android/iOS, particularly failure recovery. Ordinary corrupt-file errors that the worker handles are distinct.

**Proposed fix:** Distinguish terminal worker failure from recoverable per-file errors. Stop the batch with actionable feedback and retain completed results, or recreate the worker with bounded retry and restore custom-model state. Never repeatedly post to a worker already known to have failed.

**Validation:** Two-item worker-initialization failure, failure after one completed photo, cancellation, retry with a fresh worker, custom model restoration, partial folder/ZIP behavior. Define a separate bounded timeout/watchdog policy for a silent worker; do not label a slow large export failed using a short fixed timeout.

### P2 — Android linked camera-video gallery save uses stale media type

**Evidence:** `editor/src/App.tsx:387` uses render-captured `video` in `finishExport` to decide whether to hash/create a photo thumbnail. The worker callback captures that function in the effect at lines 511–633; dependencies are processor epoch and worker suspension, not selected media. On startup the collection is initially empty and `video` is false. Later selecting a linked video does not refresh that callback. `core/camera-photo.ts:5` then attempts `createImageBitmap` on MP4 before the gallery replacement call.

**Reproduction steps:** Reload Android with an existing linked camera video → select it → change an edit → Save to gallery. Expected: updated video. Source-predicted result: thumbnail decode throws, the gallery is unchanged and the generic gallery-update error appears. Android camera mode itself does not suspend these workers (the native-camera capability is iOS-only).

**Evidence level:** Confirmed stale closure/call chain in source; no new physical-device reproduction. Existing linked-camera automation checks video capture/import but does not save an edited linked video back to the gallery.

**Proposed fix:** Snapshot media kind with the export request or derive it from the target source, instead of using the worker effect's captured render. Preserve original media, current edits and save error handling.

**Validation:** Cold-load video save; photo→video→photo switching; worker recreation via batch; gallery-write failure/retry; verify actual updated bytes and photo thumbnail/hash behavior. Follow with a physical Android test.

### P3 — Unicode EXIF comments are lost when reimporting PNG output

**Evidence:** `editor/src/photo-metadata.ts:58` rescues raw UserComment bytes only from JPEG. `readPhotoExif` at lines 95–107 otherwise uses exifr's decoded string; the Undefined-tag conversion rejects non-byte Unicode strings. A synthetic JPEG with a Unicode UserComment exports to PNG successfully, but reading that eXIf PNG emits `CW/meta/tag/Exif/37510/nonnumeric` and drops the comment. Other metadata such as camera Make remains.

**Affected:** Shared metadata-preserving PNG reimport/export, including batch, across platforms. This is a narrow metadata loss, not loss of image pixels or proof that all metadata warnings have this cause. Current tests separately cover JPEG Unicode and ASCII PNG, leaving this combination uncovered.

**Proposed fix:** Preserve raw Undefined-tag bytes from PNG eXIf (and investigate other supported containers), using bounded container parsing rather than guessing a Unicode encoding. Continue warning for genuinely malformed tags.

**Validation:** JPEG→PNG→JPEG and PNG→PNG Unicode UserComment byte parity, ASCII comments, no-comment photos, malformed/truncated metadata, GPS and orientation/dimension updates. HEIF behavior needs its own fixture before claiming coverage.

## Other issues and suggestions

- **Maintenance clarity:** MAINTENANCE.md and IMPLEMENTATION_PLAN.md still lead with historical 1.0.14 checkpoints, including obsolete pending authorization statements. HANDOFF.md correctly leads with 1.0.15. Proposed: a short current-status pointer, preserving history; not a runtime defect.
- **UX suggestion:** Batch metadata warnings and actual processing failures share “Some photos need attention.” Distinguish successfully exported photos with metadata omissions from photos that failed. Review wording against `reference/i18n-glossary.md` before implementation.
- **UX suggestion:** Keep selected filenames rather than eagerly decoding thumbnail grids until a bounded thumbnail cache is measured. No new thumbnail benchmark was performed.
- **Known risk, not newly confirmed defect:** Existing browser RAM heuristics do not prove free memory; large photos retain source/output surfaces, and video retains complete encoded output. See the separate desktop plan. Source mode remains a transcoded 8-bit SDR result, not lossless original quality.
- No newly verified crop pixel-parity or ordinary photo-switching regression was found. This is not a claim that every workflow is bug-free.

## Fresh validation

- `npm test`: **283 tests / 43 files passed**.
- `npm run build`: passed TypeScript, production build, service-worker generation and worker graph check. Existing large-chunk/LibRaw externalization warnings remain; no new runtime failure was established from them.
- Chrome production preview: batch layout **9 cases** (320/390/1280 px × English/zh-HK/Japanese); two-column filenames, corner X/44 px target, heading separation and no horizontal overflow passed.
- Chrome batch workflow: folder collision safety, duplicate picker prevention, pending-picker close/cancel, empty initial batch and preservation of editor recipe/history passed. Folder API mocked.
- Chrome crop: **3 cases**, mobile/desktop and portrait; PNG pixel parity, undo/redo, cancellation passed.
- Edge: repeated real JPG selection/editing without worker hooks passed.
- Edge with iPhone Safari UA and mocked sharing (`canShare` missing): save readiness, cancellation/retry, recipe sharing, user activation and superseded enhancement passed.
- Edge with iPhone Safari/CriOS UA and mocked sharing: batch ZIP share/download fallback passed.
- Real Chrome fatal-worker experiment and synthetic Unicode metadata roundtrip reproduced the two findings above. Local synthetic reproduction harnesses are saved under ignored `analysis/photo-check/fresh-review-2026-11-14/`: run `node analysis/photo-check/fresh-review-2026-11-14/worker-fatal.cjs` and `node analysis/photo-check/fresh-review-2026-11-14/unicode-png.cjs` from the repository root.

The sandbox initially lacked its Playwright browser cache and blocked localhost; successful checks used installed Chrome/Edge with server and tests in the same approved execution context. Failed launches are environment failures, not application failures. No WebKit/macOS simulator, physical iPhone/Android, screen reader or real share destination was tested this turn. Prior release WebKit/simulator passes are historical evidence only. No large-file peak-memory benchmark was rerun.

## Progress and next action

- [x] Fresh source review and bounded independent reviews.
- [x] Rerun shared tests/build and applicable local browser checks.
- [x] Separate confirmed code paths, synthetic reproductions and unverified device behavior.
- [x] Prepare desktop reuse/large-file plan.
- [ ] User reviews findings and proposed desktop scope.
- [ ] Only after authorization: fix and validate these defects in separate milestones; prototype desktop I/O with explicit stop conditions.

No implementation, version bump, app installation, signing, merge, publication or website deployment is part of this review. The vault was consulted but is outside writable roots; durable findings are recorded here rather than modifying that vault.
