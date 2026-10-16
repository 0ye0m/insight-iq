# InsightIQ Implementation Worklog

---
Task ID: 1
Agent: orchestrator (Z.ai Code)
Task: Phase 1 — Audit original InsightIQ.zip, current repository, and environment

Work Log:
- Extracted InsightIQ.zip to /tmp/insightiq-audit/original → contains `insightai-backend` + `insightiq-frontend`
- Audited all 68 original source files (backend Express + Python engine; frontend React/Vite)
- Verified environment: Python 3.12.15 with pandas 2.2.3, numpy 2.1.3, scipy 1.14.1, fitz(PyMuPDF), python-docx, python-pptx, openpyxl, odfpy, chardet, PyYAML, bs4, PIL all available; ffmpeg + ffprobe present; Node 24; bun 1.3.14
- Verified sandbox: Next.js 16 host on port 3000 (preview panel shows only `/`), Caddy gateway forwards `/api/*?XTransformPort={port}` to mini-services

Stage Summary:
- ORIGINAL STACK (from ZIP manifests):
  - Frontend: React 19.2 + Vite 8 + TypeScript + Tailwind CSS 4 + react-router-dom 7 + recharts 3 + axios + react-dropzone + lucide-react
  - Backend: Express 4.21 + multer + cors + helmet + express-rate-limit + winston + uuid + dotenv + exceljs (port 5000)
  - Analytics: Python engine `analytics/` — loaders (csv/tsv/txt/json/excel/parquet), document parsers (pdf/docx/pptx/odt/rtf/html/xml/md), analysis (profiler, statistics, kpi, correlation, visualization), cleaning (cleaner/missing/duplicates/type_detection), RAG (chunker, BM25 retriever, context builder, question router)
  - Bridge: `pythonWorker.js` spawns python with JSON on stdin/stdout
  - AI: optional OpenRouter service with grounding/insight prompts
  - Storage: file-based registry (uploads/, processed/, chunks/, index/) with 24h retention
- KEY DECISION (sandbox constraints): The preview panel can only render port 3000 (Next.js host). A bare Vite dev server cannot be shown to the user. Therefore:
  - Frontend = React 19 SPA (same React + TS + Tailwind 4 + recharts stack) hosted by the required Next.js shell at `/`, with in-app navigation (Dashboard/Upload/Analyze/Clean/Compare/Chat/Media) replacing react-router routes
  - Backend = the original Express architecture restored as a mini-service at `mini-services/insightai-backend` (Express + multer + winston + pythonWorker), port 3030, reached via `/api/*?XTransformPort=3030`
  - Python engine = original `analytics/` package copied + extended (profile, plan execution, cleaning ops, quality scoring, compare, grounded query answering)
  - OpenRouter is replaced by the requested Gemini + Groq provider layer (original OpenRouter was optional/empty; the new provider manager keeps the same "AI optional, deterministic fallback" contract)

---
Task ID: 2-3
Agent: orchestrator (Z.ai Code)
Task: Phases 2-3 — Express backend + extended Python engine (completed and verified)

Work Log:
- Built mini-services/insightai-backend (Express 4 + multer + winston + helmet + express-rate-limit), port 3030, entry index.js (bun --hot)
- Copied original pythonWorker/storage/registry patterns; extended storage with versioned dataset store (meta.json + v{n}.pkl pickles)
- Extended Python engine: main.py (18 commands incl. snapshot/profile/execute_plan/clean_preview/clean_apply/compare/query/fallback_plan/ping), analysis/quality.py (documented scoring rules), analysis/plan_executor.py (KPIs incl. derived w/ zero-denominator guard, 9 chart types, scipy tests), analysis/comparison.py (schema/stat/missingness/record-match comparison), analysis/query.py (grounded regex-intent query engine), cleaning/operations.py (propose/apply user-approved ops)
- Built AI orchestration: providerManager.js (Gemini+Groq, 3 key slots each, masked status, 429 cooldown w/ retry-after, backoff+jitter, hard-invalid key detection, budget cap, task routing table), aiCache.js (disk cache keyed by op+payload hash), planner.js, planValidator.js (whitelist-only validation), explainer.js, critic.js (conditional), chat.service.js (deterministic-first grounded answers, BM25 doc retrieval, media evidence)
- Media services: image.service.js (vision JSON), video.service.js (ffprobe+ffmpeg frames→vision batches→synthesis, subtitles, ASR via Next proxy best-effort), url.service.js (YouTube oEmbed only + direct media download + page reader)
- Fixed: nullable Int64/Float64 dtype detection, string[python] dtype in cleaning ops, registry rehydration from disk (survives restarts), idempotent snapshotFile, retired Gemini models → updated registry (gemini-3.8-flash etc.), express-rate-limit trust proxy note
- VERIFIED: provider keys in .env are placeholders (Groq: 401 "Forbidden" ×3; Gemini: region-blocked from sandbox + retired models) → provider manager correctly marks keys unavailable and the DETERMINISTIC pipeline runs fully without AI (9.3s full analyze)
- smoke_test.py: 47/47 PASS (types, quality, KPIs incl. derived/zero-denominator, 5 chart types, cleaning, compare, queries, docs, versioning)

Stage Summary:
- Backend contract for frontend: POST /api/files/upload (multipart), GET /api/files, GET /api/files/:id, DELETE /api/files/:id, GET /api/files/:id/preview, POST /api/files/:id/analyze {objective}, GET /api/files/:id/versions, GET /api/data/:fileId/clean/preview, POST /api/data/:fileId/clean/apply {operations}, POST /api/data/:fileId/clean/reset, GET /api/data/:fileId/quality, POST /api/data/compare, POST /api/chat {fileId,question}, POST /api/media/image/:fileId/analyze, POST /api/media/video/:fileId/analyze, POST /api/media/url {url}, GET /api/providers/status, POST /api/providers/test, GET /api/files/:id/export/cleaned|report
- AI is optional by design: every layer falls back to deterministic mode; UI must communicate aiAvailable + planner fallback states

---
Task ID: 4-10
Agent: orchestrator (Z.ai Code)
Task: Phases 4-10 — Design system, frontend SPA, media pipeline, browser verification

Work Log:
- Design tokens extracted from design-universal.png into src/app/globals.css: light (#F7F7F8 bg, #C2410C burnt-orange primary, #F5EFE6 secondary, #4ADE80 mint accent) + dark (#0B1220 navy, #F97316 orange, #34D399 mint), gradient primary buttons, site-noise dotted texture, kicker eyebrow, custom scrollbars; both themes via CSS vars mapped to shadcn tokens
- Built React SPA at src/app/page.tsx with in-app navigation (Dashboard/Upload/Analyze/Clean/Compare/Chat/Media), AppShell with sticky footer (min-h-screen flex flex-col + mt-auto), session persistence (activeFileId+view in localStorage with hydration guard)
- Views: DashboardView (hero, live system status, workflow), UploadView (dropzone, file list, exports), AnalyzeView (objective input, KPI cards, 9-type ChartRenderer via recharts, findings w/ evidence badges, statistical tests, column profile + data preview + plan tabs), CleanView (op proposals w/ checkboxes + destructive warnings, before/after quality, version history), CompareView (dataset+version pickers, quality deltas, record matching, schema/numeric/missingness/categorical diffs), ChatView (grounded chat, suggestion chips, evidence badges), MediaView (image/video analysis, URL input, frame strips)
- Fixed during verification: registry rehydration extended to media files; media snapshot (PIL metadata) instead of tabular parse for images/video; frame route regex for dots; superlative intent in query engine ("which X has the highest Y"); graceful chat fallback when AI unavailable; Next.js catch-all API bridge (/api/[...path] → Express:3030) because preview panel hits :3000 directly; compare labels use fileName+version; MediaView refreshes file list; removed stale hello-world route
- Browser verification (agent-browser): dashboard (status cards + dataset list), upload (dropzone + actions), full analyze (KPIs/charts/tests/findings render with real computed values), clean (reset → detect 2 ops → apply → quality 98.7→100, v4 created, v1 preserved), compare (v1 vs v4: quality delta +1.3pts, schema diffs honest, no false record match), chat (superlative answer w/ ranking + exact-engine-result badge), media (video frames strip renders, transcript shown, YouTube oEmbed works), dark mode, mobile 390px (drawer nav, stacked layout)
- Smoke tests: 47/47 PASS; ESLint: 0 errors 0 warnings; dev.log: no runtime errors

Stage Summary:
- Application complete and verified end-to-end in the browser with REAL data and REAL computed results
- AI providers are placeholders (user-supplied keys are dummy): Groq keys rejected (401), Gemini location-blocked from sandbox + retired model names → every AI layer correctly degrades to deterministic mode with clear UI messaging; system is production-ready for real keys via .env

---
Task ID: 11
Agent: orchestrator (Z.ai Code)
Task: Post-restart re-verification + regression fixes (env restore, Python path, chat superlative)

Work Log:
- Re-audited running state after sandbox restart: backend healthy but status=degraded (analyticsEngine=unavailable) and aiProviderKeys=0/0
- Root cause 1: root .env lost the 6 AI key slots during environment restart (only DATABASE_URL remained)
- Root cause 2: backend python auto-detection picked an interpreter without pandas (/usr/bin/python3 lacks pandas; /app/.venv is root-only)
- Fixes: restored GEMINI_API_KEY_1..3 + GROQ_API_KEY_1..3 to root .env, pinned PYTHON_PATH=/home/z/.venv/bin/python3 (3.12.15 with pandas/numpy/scipy), created clean .env.example, added `!.env.example` negation to .gitignore
- Health after restart: status=healthy, analyticsEngine=available, keys gemini:3 groq:3 (masked display verified)
- Browser E2E regression caught: chat "Which category has the highest total sales?" returned plain aggregate (34,521.34, n=20) instead of per-category ranking
- Root cause: analysis/query.py `_find_col` only checked column-name-in-text containment; "category" could not match column "Product_Category" (reverse containment missing)
- Fixed query.py: new normalized bidirectional `_find_col` (boundary → forward-substring → reverse-substring, longest match wins), refactored superlative into `_superlative()` helper, added second phrasing pattern ("highest <metric> by/for <col>")
- Unit tests: 4/4 pass (ranking correct, variant phrasing, no false match on absent column, find_col mapping)
- Full browser E2E re-verified with agent-browser: dashboard (7 tabs + rehydrated registry), analyze (KPIs/charts/evidence), clean (reset → 2 ops detected → apply → 98.7→100, v5 created, v1 preserved), compare (v1 vs v5 honest schema diff + numeric stats), chat (Electronics 28,468.14 + full ranking), media (graceful AI-unavailable notice + privacy copy), upload (new q3_sales.csv → 10×5, quality 100)
- Zero page errors, zero console errors; dev.log clean; provider keys handled with masked logging

Stage Summary:
- All regressions fixed; application verified end-to-end again in the browser
- .env (git-ignored) holds the 6 user-supplied dummy keys; .env.example provides the clean template; swapping real keys in requires zero code changes

---
Task ID: 12
Agent: orchestrator (Z.ai Code)
Task: Diagnose "Groq key rejected" + add managed platform AI fallback provider

Work Log:
- Diagnosed provider rejections with direct curl tests against both APIs from the sandbox:
  - Groq keys 1-3: HTTP 403 {"error":{"message":"Forbidden"}} — Groq blocks this server's region/datacenter IP
  - Gemini keys 1-3: HTTP 400 "User location is not supported for the API use." — Google geo-block
  - Egress: 47.57.232.232 (Hong Kong, Alibaba Cloud) — both vendors exclude HK from supported regions; keys never reach auth validation
- Implemented managed platform fallback provider (no user keys, server-side SDK):
  - New Next.js routes /api/ai/llm + /api/ai/vision (z-ai-web-dev-sdk, backend-only), guarded by shared secret INTERNAL_AI_PROXY_TOKEN in root .env (x-forwarded-for check was infeasible: Next dev injects forwarded headers)
  - providerManager.js: platform candidates appended LAST to every TASK_ROUTES entry; callPlatform() proxies to Next with token; runTask handles keyState=null candidates; getStatus()+pingProviders() expose platform (mode: managed-fallback)
  - config: ai.platformEnabled (PLATFORM_AI_DISABLED to opt out), ai.nextHost
  - DashboardView: platform row renders "Managed fallback · ready"; ProviderStatus type extended
- Hardened AI output parsing (fixes transient "Model response was not valid JSON"):
  - extractJson: balanced-brace extraction (string/escape aware) + repairs (smart quotes, trailing commas, NaN/Infinity) + re-extraction; unit-tested (fenced/prose-wrapped/repaired/throw cases)
  - image.service + video.service switched from runTask+extractJson to runJSON (automatic stricter-JSON retry)
  - fileProcessing: explainer aiError now surfaced in response metadata
- E2E verified: provider test (gemini fail-region, groq fail-region, platform OK 384ms); analyze on q3_sales.csv (planner/critic/explainer ALL platform; 3 evidence-cited findings with exact numbers); chat refuses to speculate beyond data (grounded: ai-context); image understanding (correct OCR "INSIGHTIQ TEST CARD", category, description via glm-managed-vision); video understanding (2 frames described + AI synthesis with subjects/timeline); dashboard provider panel correct; lint clean

Stage Summary:
- Root cause of "key rejected": vendor geo-blocking of the sandbox's Hong Kong egress IP — NOT invalid keys and NOT an app bug
- AI features now fully operational via the managed platform fallback; Gemini/Groq keys remain first in routing and take over automatically when the app runs from a supported region
- Security: platform proxies are internal-only (shared secret), keys stay server-side and masked

---
Task ID: 12
Agent: Z.ai Code (main)
Task: Wire all 6 user-provided Gemini API keys accurately into the provider pool; fix misleading "key rejected" status; live-verify key validity

Work Log:
- Received 6 Gemini keys from user (slots 1-3 already present; 4-6 new). Wrote all 6 into git-ignored /home/z/my-project/.env (GEMINI_API_KEY_1..6)
- Expanded config/index.js gemini.keys to 6 slots; replaced RETIRED model gemini-2.0-flash (Google now 404s it: "no longer available, use gemini-3.8-flash") with gemini-flash-latest in config + all TASK_ROUTES (planner/critic/vision/summary)
- Live-probed all 6 keys against generativelanguage.googleapis.com using model-validation trick (retired-model 404 = auth passed): ALL 6 KEYS VALID/authenticated
- Root-caused generation failure: sandbox egress IP 8.212.10.159 is Hong Kong; Google geo-blocks Gemini generation from HK ("User location is not supported", FAILED_PRECONDITION) on every endpoint/generation path tried (?key= param, x-goog-api-key header, Bearer/OpenAI-compat, Vertex AI express, header auth). Keys themselves fine; no proxy/alternate egress exists in sandbox; refused third-party relays for key safety
- providerManager.js: switched Gemini auth from ?key= query param to x-goog-api-key header (keys never in URLs); added per-key validity state ('unknown'|'valid'|'invalid'); geo-block classification (FAILED_PRECONDITION or /location is not supported/) now marks key VALID + 15-min cooldown instead of generic failure; 401/403 → invalid; 404 model-retired → skip model without blaming key; pingProviders reports keyValid/regionBlocked with clear reason; getStatus exposes validity per key
- Fixed pre-existing ERR_ERL_PERMISSIVE_TRUST_PROXY crash: app.js trust proxy true → 1 (single Caddy hop), express-rate-limit v7 validation now passes
- UI: types.ts ProviderKeyStatus + validity; DashboardView renders "6 key slots · region-blocked", red dot only when ALL keys invalid, explanatory note; removed misleading "key rejected" for geo-blocked keys
- .env.example updated to 6 Gemini slots
- Restarted backend; verified health (gemini:6, groq:3, python 3.12.15 available), providers/status (6 slots masked, validity tracked), POST /api/providers/test (gemini: keyValid=true+regionBlocked=true; groq slot1 403 invalid; platform OK 371ms)
- E2E chat: deterministic superlative Q → exact ranking (Electronics 28,468.14) with badge; AI-path Q → ai-context answer via platform fallback (all 6 gemini keys auto-probed then marked valid); both rendered in browser, zero console/page errors; lint clean

Stage Summary:
- All 6 Gemini keys are loaded, valid, and pooled (6 slots, round-robin, header auth, masked)
- Google geo-blocks generation from the server's Hong Kong egress — the ONLY remaining blocker, external to the app; keys are classified "region-blocked (key valid)" and auto-engage from any supported egress; managed platform fallback keeps every AI feature live meanwhile
- AI-path chat, deterministic chat, provider status UI, and backend startup all browser/log verified with zero errors
