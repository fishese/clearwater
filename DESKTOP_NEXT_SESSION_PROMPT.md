# New-session prompt: shared-code desktop feasibility

Work in `D:\Projects\ClearWater`. Proceed with the bounded PC/Mac feasibility stages in `DESKTOP_LARGE_FILES_PLAN.md`. ClearWater 1.0.16 has been released; start by verifying current main, branch, working tree and stashes. Read applicable AGENTS.md instructions, HANDOFF.md, FRESH_REVIEW_2026-11-14.md, current maintenance documentation and the desktop plan. Consult the shared vault's AGENTS.md and relevant project overview if available. Treat historical conclusions as context to verify.

Use smaller capable models for involved coding and independent review. Create a `codex/` feature branch from current main, using an isolated worktree if needed to preserve unrelated edits and stashes.

The desktop edition is worthwhile only if it mostly reuses existing code. Begin with an Electron compatibility prototype using the existing UI, recipes, correction/enhancement math, workers and models. Then prototype file-backed video import/export with positioned disk writes and backpressure. Avoid loading whole inputs/outputs into memory or copying originals into IndexedDB. Adapt metadata finalization and completion results as necessary; changing only the muxer while recreating a giant Blob afterward does not satisfy the goal.

Measure process-tree peak memory, preview/export latency, A/V sync, output quality and cancellation/retry. Start with controlled fixtures, then test larger/longer video as resources allow. Validate on Windows and macOS where available; state hardware/codec gaps clearly. Do not raise limits based solely on reported RAM.

Keep larger-photo support behind a separate bounded decoder/encoder feasibility gate. Preserve crop, strip halos, global analysis, metadata, inference reuse and preview/export consistency. If meaningful gains require a separate native correction engine or extensive rewriting, stop and explain; do not expand this into a new product. Present substantial quality, workflow or scope tradeoffs before implementation.

Commit small tested milestones and update the checklist/handoff with evidence and the next action. Preserve web/Android/iOS behavior, production defaults, optional finish, originals, edits and existing Save/Share fixes. Never clear app data. Keep private samples local and gitignored; use synthetic media for shared automation.

Never access `D:\PrivateData`, `D:\Private` or `Z:`. Do not enumerate `D:\keystores` or access signing material for this prototype. Follow all repository privacy/signing restrictions and the i18n glossary for new wording. Do not merge, publish, release, deploy the website, bump release versions or change signing without new authorization. Save a clear checkpoint if interrupted.
