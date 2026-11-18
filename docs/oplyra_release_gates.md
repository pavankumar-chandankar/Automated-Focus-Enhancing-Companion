# Oplyra delivery gates

## Gate 0 — product identity and stability (this branch)
- [x] Working brand, positioning and planned product boundaries documented
- [x] Public web research prototype relabeled without changing API/import/environment compatibility
- [ ] Full automated CI and Windows/macOS smoke tests pass for the renamed app
- [ ] IP/brand clearance completed

## Gate 1 — installable desktop alpha (target)
- [ ] Tauri 2 tray app built from versioned source in repository
- [ ] Start, pause, resume, finish, persistence and checkpoint tests
- [ ] Windows install/quit/relaunch cycle proven on clean machine
- [ ] macOS install/quit/relaunch tested
- [ ] Correct handling of sleep/wake and clock changes
- [ ] Data migration, export and delete tests
- [ ] Accessibility keyboard-only review

## Gate 2 — usable AI beta (target)
- [ ] User-controlled real LLM provider; local/offline fallback
- [ ] Prompt injection and unsafe output evaluation
- [ ] Proved no external send without consent
- [ ] Contextual checkpoint usefulness study vs simple timer
- [ ] Performance and crash telemetry only with opt-in

## Gate 3 — B2B research pilot (target; separate workstream)
- [ ] At least ten buyer and ten employee discovery interviews
- [ ] Written metric definitions for a single concrete business process
- [ ] Worker notification, privacy/labor/legal review
- [ ] Tenant isolation, role-based access and audited authorization
- [ ] Human-reviewable team aggregate dashboard
- [ ] Quality-adjusted throughput evaluation and clear opt-out procedures

**Do not market proposed gates as shipped features.**
