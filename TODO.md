# TODO.md - Akira Bot V21 Number Update Plan

## Progress
task_progress Items:
- [x] Step 1: Create TODO.md with approved plan breakdown
- [x] Step 2: Edit modules/ConfigManager.ts to prioritize 37839265886398
- [x] Step 3: Build project with `npm run build`
- [x] Step 4: Test bot with `npm start` - verify logs, mentions (@37839265886398), owner commands (#dono, #menu cyber), replies
- [x] Step 5: Validate multi-device session preserved, no regressions for 244952786417
- [x] Step 6: attempt_completion with results + demo command

## Notes
- Plan approved (minimal changes, zero downtime).
- Primary change: Reorder DONO_USERS to prioritize 37839265886398, ensure BOT_NUMERO_REAL default.
- Test focus: Reply recognition, isDono checks, mentions by number.
- Expected logs: "🤖 Logado como: 37839265886398@s.whatsapp.net" (LID primary).

