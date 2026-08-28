# HourHive Caseload

A sibling product to HourHive, built for special education / related-services scheduling: instead of filling employee shift intervals, it fills each **Para Instructor's** work hours with **student sessions** until every student's **weekly service-minute requirement** is met. No employee-facing PWA — this is an admin/case-manager tool only.

## What it does

1. **Para Instructors** — add each Para, then set their weekly work hours plus break and lunch windows (per day, Mon–Fri by default).
2. **Students** — add students with grade and optional notes.
3. **Caseloads** — assign students to a Para with:
   - Required **weekly service minutes**
   - Preferred and minimum **session length**
   - **1:1** or **group** service type (group students sharing a `group_tag` under the same Para get co-scheduled in the same time block — e.g. a 2-student social skills group)
   - **Priority** (1 highest–5 lowest) as a scheduler tie-breaker
4. **Schedule** — click "Generate schedule" for a given week. The engine:
   - Computes each Para's open time (work hours minus break/lunch)
   - Greedily fills that open time with student sessions, respecting session length preferences, spreading sessions across days rather than stacking one student back-to-back, and honoring group vs. 1:1
   - Flags any student who couldn't be fully scheduled (not enough Para hours for the caseload) as **partial** or **unmet**, so you can see compliance risk immediately instead of finding out at review time

## Scheduling logic (src/scheduler/generate.js)

For each Para: build the week's free time blocks, then repeatedly pick the highest-priority student/group that still needs minutes and hasn't already been scheduled that day, and drop them into the next available block (shrinking session length near the end of a block or near a student's remaining minutes as needed). This is a greedy heuristic, not a global optimizer — for the caseload sizes a Para actually carries (a handful to ~15 students), it reliably finds a full solution when one exists, and its compliance report tells you immediately when it doesn't (i.e., the caseload needs more Para hours or minutes need to be redistributed).

## Run it locally

```bash
npm install
npm run seed     # creates a demo district: admin@demo-school.org / demo1234
npm start         # http://localhost:3300
```

## Deploy (same pattern as HourHive on Railway)

1. Push this folder to a new GitHub repo.
2. In Railway: New Project → Deploy from GitHub repo.
3. Set environment variables:
   - `JWT_SECRET` — any long random string
   - `PORT` — Railway sets this automatically
4. Railway will run `npm install` then `npm start`. SQLite file lives in `/data` inside the container — for production durability, attach a Railway volume mounted at `/app/data` (or set `DB_PATH` to a volume path).
5. Visit the deployed URL, click **Create an account**, and set up your district's first admin login (or run `npm run seed` once via the Railway shell for a demo org).

## Data model

- `paras` + `para_availability` — one Para, up to 7 weekday rows (work start/end, break start + minutes, lunch start + minutes)
- `students`
- `assignments` — the caseload: para × student × weekly_minutes × session length × service type × group_tag × priority
- `schedule_sessions` — generated output, one row per student per placed session block (group sessions produce one row per student, linked by `session_group_id`)
- `schedule_runs` — one row per generate click, stores the compliance summary JSON so re-opening the Schedule tab shows the same report without recomputation

## What's intentionally different from HourHive core

- No employee self-serve PWA, no shift-swap/time-clock flows — this is a single admin-facing scheduling tool.
- The unit being scheduled is **service minutes per student**, not **coverage intervals per role** — the whole data model and algorithm are new, built around IEP-style compliance rather than staffing coverage.
- Same visual identity (hive mark, navy/amber palette) so it reads as part of the same product family.
