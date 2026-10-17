# Ordis

Civic tool for Toronto residents (Hack the Valley 11, School of Cities challenge): address -> nearby
development applications -> AI-read spec -> Blender 3D massing -> web viewer with sun/shadow study.

**Read `HANDOFF.md` first**: architecture, how to run, what's working, data/code gotchas, conventions and the
idea backlog.

Key conventions:
- Commit at the end of each milestone, then start a new branch for the next one.
- The user may be running servers on ports 8000/3000; for automated checks use 8010/3010 (see HANDOFF.md) and
  never stop the user's servers.
- Backend: Python 3.14 venv in `backend/.venv`; tests `backend\.venv\Scripts\python -m pytest backend\tests -q`.
- Frontend: Next.js 16 (read `frontend/node_modules/next/dist/docs` before using unfamiliar APIs);
  check with `npx tsc --noEmit` and `npx eslint src`.
- Keep "stated in the application" vs "estimated by Ordis" separate everywhere; never fabricate buildings or data.
