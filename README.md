# HourHive Caseload

A sibling product to HourHive, built for special education / related-services scheduling: instead of filling employee shift intervals, it fills each **Para Instructor's** work hours with **student sessions** until every student's **weekly service-minute requirement** is met. No employee-facing PWA — this is an admin/case-manager tool only.

## What it does

1. **IEP Specialties** — the app tracks six fixed specialties: **OT, PT, Speech, EL, Sped, Reading**. Every Para Instructor is assigned one or more specialties (Para Instructors \u2192 **Specialties** button), and every caseload assignment is tied to exactly one specialty. The Para dropdown when building a caseload only shows Paras qualified for the chosen specialty \u2014 you can't accidentally put a Speech requirement on a Para who isn't set up for Speech.
2. **Para Instructors** — add each Para, set their weekly work hours plus break and lunch windows (per day, Mon\u2013Fri by default), and assign their specialties.
3. **Students** — add students one at a time, or click **Import CSV** to upload a roster in bulk, now including specialty assignments and availability. The first row must be a header with at least a `Name` column; `Grade` and `Notes` are optional. To also create caseload assignments in the same upload, add `Specialty`, `Weekly Minutes`, and `Para` columns (the Para must already exist and already be assigned that specialty \u2014 the import enforces the same qualification check as the UI). To also set a student's available times, add `Available Day`, `Available Start`, and `Available End` columns (day as a name like "Monday"/"Mon" or a number 0\u20136; times as 24-hour `HH:MM`). A student needing more than one specialty, more than one availability window, or the same specialty from two different Paras just gets additional rows with the same name \u2014 the "long format" (see the template for an example combining all three). Students already on the roster (matched by name, case-insensitive) are reused rather than duplicated, and invalid/duplicate rows are reported individually with the row number and reason rather than failing the whole import.

   **Every student's Edit modal ("contact card") also shows a Specialty Assignments section directly** \u2014 the current specialty + Para + weekly minutes for that student, with buttons to add, edit, or remove right there, no need to go to the Caseloads tab. A student with none shows a clear warning that they won't appear in generated schedules until one's added, and the same warning surfaces as a red "Not assigned" badge right in the Students table so it's visible without opening anything.
4. **Caseloads** — assign a student to a specialty with a qualified Para:
   - Pick the **IEP Specialty** first, then the Para dropdown filters to only Paras assigned to it
   - Required **weekly service minutes** for that specific specialty (a student needing both OT and Speech gets two separate assignments, each with its own target \u2014 possibly with two different Paras)
   - Preferred and minimum **session length**
   - **1:1** or **group** service type (group students sharing a `group_tag` under the same Para **and same specialty** get co-scheduled in the same time block \u2014 but only during windows where *every* member of the group is actually available, see Student availability below)
   - **Priority** (1 highest\u20135 lowest) as a scheduler tie-breaker
   - A **live Start/Stop clock** right on the caseload row, scoped to that specific specialty. Click Start when a session actually begins, Stop when it ends \u2014 it logs the real elapsed time and rolls it into that specialty's actual minutes for the current week, shown next to the target (e.g. `40 / 120 min this week`). Starting a clock for a student who already has a *different* clock running (with any Para, any specialty) is blocked, since a student can't physically be in two sessions at once. This is real delivered time, separate from the projected schedule below, so it's the number you'd actually want for a compliance audit. A manual-entry endpoint (`POST /api/time-logs/manual`) also exists for logging a session after the fact if the clock wasn't running.
5. **Student case notes** — each student row has a **Case Notes** button opening a running, timestamped log (author + date + note), separate from the short descriptive `Notes` field on the student's basic info. Good for session progress notes, incidents, parent contact, etc. without overwriting the student's summary field.
6. **Student availability** — each student can have one or more **available windows** per weekday (e.g. two separate free periods), set via the **Availability** button on the Students tab. The auto-scheduler only places a session where the Para is free **and** the student is free **and** the student isn't already booked with a *different* Para at that time \u2014 for a group session, everyone in the group has to be free at the same time, or that slot is skipped. A student with zero windows configured is treated as unrestricted (available whenever their Para is), so this is fully opt-in and won't change existing caseloads until you set it.
7. **Student weekly minute target** — each student's Edit form has a **Required weekly minutes (IEP minimum)** field. It's a convenience default: when you assign that student to a Para's caseload for a given specialty, the assignment's "Required minutes per week" pre-fills from it (still editable, since a student's total is typically split across multiple specialties/Paras).
8. **Schedule** — click "Generate schedule" for a given week. The engine:
   - Computes each Para's open time (work hours minus break/lunch)
   - Greedily fills that open time with student sessions, respecting session length preferences, each student's own availability windows, spreading sessions across days rather than stacking one student back-to-back, and honoring group vs. 1:1
   - **Never double-books a student across two Paras.** Paras are processed one at a time; the moment a session is placed, that time block becomes "busy" for every student in it, and every subsequently-processed Para's scheduling run respects that busy time on top of the student's own availability \u2014 so a student getting Speech from one Para and OT from another can never end up with overlapping sessions.
   - Flags any student/specialty combination that couldn't be fully scheduled (not enough Para hours, not enough overlap with the student's own available windows, or the only open slots were already claimed by another specialty) as **partial** or **unmet**, so you can see compliance risk immediately instead of finding out at review time
   - **Manual override**: click **+ Add manual session** to place one or more students into a specific Para/day/time slot yourself \u2014 e.g. combining two students into an ad-hoc joint session after the auto-run, or covering something the algorithm couldn't fit. The picker is scoped to that Para's actual caseload entries (student + specialty pairs) so minutes count toward the right target, and it's rejected with a clear error if it would double-book a student who already has an overlapping session with any Para. Every session chip (auto-generated or manual) has a small **\u00d7** to remove it; removing one half of a co-scheduled group removes the whole group's placement together. Compliance numbers recalculate live from whatever's actually in the schedule, not just from the last auto-run.
9. **Admin Report** — a read-only rollup table for whole-team compliance review: Name, Specialty, Grade, % of Weekly Goal, Total Weekly Minutes, Target Weekly Minutes, then the actual clocked session times for Monday\u2013Friday, shown for **this week and last week** side by side. A student with multiple specialties gets one row per specialty. Pulled entirely from the `time_logs` actual-clock data, not the projected schedule \u2014 this is what you'd hand to a compliance reviewer.

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
- `para_specialties` — which of the 6 fixed specialties (OT, PT, Speech, EL, Sped, Reading) each Para is qualified/assigned to deliver
- `students` (includes `target_weekly_minutes`, a default used when creating caseload assignments)
- `student_availability` — zero or more available windows per weekday per student. Zero rows total = unrestricted (backward compatible default)
- `student_notes` — timestamped case-note log per student, independent of the student's short `iep_notes` field
- `assignments` — the caseload: para × student × **specialty** × weekly_minutes × session length × service type × group_tag × priority. Unique on (para_id, student_id, specialty) — a student can have multiple assignments across different specialties, even with the same Para
- `time_logs` — actual delivered minutes from the live start/stop clock (or manual entry), tagged with specialty, aggregated per `week_start_date` for the weekly-minutes comparison against the matching assignment
- `schedule_sessions` — generated **projected** output, one row per student per placed session block, tagged with specialty (group sessions, whether auto-generated or manually added, produce one row per student, linked by `session_group_id`). Manual sessions live in this same table, distinguished only by not having been produced by `generateSchedule()` — there's no separate "manual" table, which is what lets compliance recompute live regardless of how a session got there.
- `schedule_runs` — one row per generate click, kept for audit history (when a run happened); compliance shown in the UI is now always recomputed live from `schedule_sessions`, not read back from this table, so manual add/remove is reflected immediately

Note the two different "minutes" concepts: `schedule_sessions` is what the auto-scheduler *projects* a Para's week to look like (plus anything added manually); `time_logs` is what was *actually* clocked. They're independent — the Caseloads tab shows actual vs. target from `time_logs`, the Schedule tab shows the projected/planned week. Both are matched by (para_id, student_id, specialty), not just (para_id, student_id), so a student with two specialties from the same Para never has their minutes conflated.

## Scheduling logic (src/scheduler/generate.js)

For each Para: build the week's free time blocks (work hours minus break/lunch), then repeatedly pick the highest-priority student/group that still needs minutes, hasn't already been scheduled that day, and is actually available at the current point in time — checking the Para's open time, every student in that placement's own availability windows (a group session only lands where *all* members are free simultaneously), **and** whether that student is already busy with a *different* Para at that moment — and drop them into the next available moment, shrinking session length near the end of a block, near an availability boundary, or near a student's remaining minutes as needed. If nobody is available exactly "now," the algorithm jumps forward to the next moment someone becomes available rather than giving up on the rest of the block.

**Cross-Para double-booking prevention:** Paras are processed one at a time (not in parallel). The instant a Para's placements are finalized, every student involved has that time block marked "busy" in a shared map before the next Para is processed — so a student who needs both Speech (Para A) and OT (Para B) can never end up with two overlapping sessions, regardless of which Para's assignments were entered first. This is a real hard constraint, not a warning: the busy time is subtracted from the student's available windows the same way their own personal availability is, before any placement decision is made.

This is a greedy heuristic, not a global optimizer — for realistic caseload sizes it reliably finds a full solution when one exists, and its compliance report tells you immediately when it doesn't (not enough Para hours, not enough overlap between the Para's hours and the student's own available windows, or the only free time was already claimed by a different specialty for that same student). Because Paras are processed sequentially, processing order can occasionally matter — a Para scheduled earlier can claim a slot that would have made a later Para's assignment easier to fully place. If you see an unexpected partial/unmet result, try regenerating after adjusting priority, or use the manual-session override to hand-place the remainder.

## What's intentionally different from HourHive core

- No employee self-serve PWA, no shift-swap/time-clock flows — this is a single admin-facing scheduling tool.
- The unit being scheduled is **service minutes per student**, not **coverage intervals per role** — the whole data model and algorithm are new, built around IEP-style compliance rather than staffing coverage.
- Same visual identity (hive mark, navy/amber palette) so it reads as part of the same product family.
