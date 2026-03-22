# TS Bot Migration Fixes (from JS → TS)
Status: 🔄 In Progress

**Issues:**
1. Bot replies to all group messages (no mention filter)
2. Group commands fail (stubs in BotCore, socket errors)
3. Missing profile/group methods (partially implemented)

**Plan Steps:**
1. ✅ Create TODO
2. 🔄 BotCore.ts: Add `shouldRespondToAI()` + replace stubs (muted, anti-link → delete+remove+notify)
3. 🔄 GroupManagement.ts: Fix _checkSocket blocks, add missing methods (setGroupName etc)
4. 🧪 Test local: `npm ci && npm run build && npm start`
5. 🚀 Railway: git push
6. ✅ Update TODO

**Commands:**
```bash
cd AKIRA-SOFTEDGE/index-js2.1
npm ci && npm run build
npm start
```

