# `/next-steps` — SIG Roundtable Landing Pages

## Purpose

These pages are the outward-facing booking funnel for Eloso's presence at the **Sourcing Industry Group (SIG) roundtable**. Supply chain executives scan a QR code or visit a link and land on `/next-steps`, where they choose between two types of engagement:

- **Discovery Call** — 30 minutes, for prospects new to Eloso
- **Strategy Session** — 45 minutes, for leaders already thinking about AI-assisted sourcing

The funnel is intentionally simple: one choice screen, two booking pages (each wrapping a cal.com embed), and two post-booking confirmation pages.

---

## URL Structure

```
/next-steps                          Landing page — choose your meeting type
/next-steps/discovery                Book a 30-min Discovery Call
/next-steps/strategy                 Book a 45-min Strategy Session
/next-steps/confirmed/discovery      Post-booking confirmation for Discovery Call
/next-steps/confirmed/strategy       Post-booking confirmation for Strategy Session
```

### File layout

```
src/app/next-steps/
├── README.md                        This file
├── page.tsx                         Landing / choice screen
├── discovery/
│   └── page.tsx                     Discovery Call booking page
├── strategy/
│   └── page.tsx                     Strategy Session booking page
└── confirmed/
    ├── discovery/
    │   └── page.tsx                 Discovery Call confirmation
    └── strategy/
        └── page.tsx                 Strategy Session confirmation
```

---

## Design Decisions

### Why `/next-steps` and not `/sig`

`/sig` was the internal funnel label used during planning. It was renamed to `/next-steps` before shipping (`76cabc3`) because:

1. The URL appears in QR codes and printed materials that attendees scan in person. `/next-steps` reads naturally to someone who has just had a conversation with the Eloso team — it is action-oriented and prospect-facing.
2. `/sig` is an internal category label. Leaking internal taxonomy into public URLs is a maintenance hazard if the funnel is later reused for other events.

### Why `discovery` and `strategy` as sub-routes

These match the actual cal.com event slugs (`eloso/discovery`, `eloso/strategy`). Keeping the route names and cal.com slugs aligned makes the integration obvious and reduces confusion when wiring the embed.

---

## Cal.com Integration

### What is stubbed

Both booking pages (`/next-steps/discovery` and `/next-steps/strategy`) contain a **placeholder `<div>`** where the cal.com embed component goes. The placeholder is clearly marked with comments:

```tsx
{/* Replace this div with your cal.com embed snippet */}
{/* e.g. <Cal calLink="eloso/discovery" /> */}
```

The placeholder renders a visible label and the expected cal.com slug so future agents can find it quickly.

### Steps to wire cal.com

1. **Install the cal.com embed package** (if not already present):
   ```bash
   npm install @calcom/embed-react
   ```

2. **Replace the placeholder `<div>` in each booking page** with the actual embed component. For the discovery page:
   ```tsx
   import Cal from '@calcom/embed-react';
   // ...
   <Cal calLink="eloso/discovery" style={{ width: '100%', height: '100%' }} />
   ```
   Repeat for the strategy page using `eloso/strategy`.

3. **Configure cal.com "Redirect on booking"** for each event type:
   - Discovery Call event → redirect to `https://eloso.ai/next-steps/confirmed/discovery`
   - Strategy Session event → redirect to `https://eloso.ai/next-steps/confirmed/strategy`

   This is set in cal.com under Event Type → Advanced → Redirect on booking.

4. **Configure cal.com Workflow emails** for both event types. At minimum:
   - Booking confirmation email to the attendee
   - Reminder email (e.g. 24 hours before)
   - Internal notification to the Eloso team

---

## Confirmed Pages

`/next-steps/confirmed/discovery` and `/next-steps/confirmed/strategy` are static post-booking landing pages. They are reached via cal.com's "Redirect on booking" setting (see above) — cal.com redirects the browser here immediately after a booking is completed.

Each page shows:
- A checkmark icon
- "You're confirmed" headline
- Meeting type and duration reminder
- Instruction to check email for the calendar invite and meeting link
- Contact email (`hello@eloso.ai`) for questions
- Back link to `/next-steps`

The pages are intentionally static — they receive no query parameters from cal.com and do not attempt to display booking details. If you need to display booking-specific information (date, time, Zoom link), wire up cal.com's embed callbacks or use cal.com's post-booking query parameters and read them from `useSearchParams()`.

---

## Styling

All pages use the `bisque-*` Tailwind color tokens (e.g. `bisque-50`, `bisque-200`, `bisque-950`). These are custom colors defined in the project's Tailwind config — not standard Tailwind palette colors.

Key design patterns across all five pages:

| Pattern | Usage |
|---|---|
| `bg-bisque-50` | Page background |
| `bg-white border border-bisque-200 rounded-2xl shadow-sm` | Card container |
| `text-bisque-950` | Primary headings |
| `text-bisque-600` | Body / description text |
| `text-bisque-500` | Metadata / labels |
| `text-bisque-400` | De-emphasized / fine print |
| `rounded-2xl` | All card and button radii |

The landing page (`/next-steps`) uses an inverted card for the Strategy Session option (`bg-bisque-950` background, white and `bisque-300/400` text) to visually distinguish the two call types without introducing a second color family.

---

## To Deploy

1. Wire the cal.com embeds as described above.
2. Confirm cal.com redirect URLs point to the `/confirmed/*` pages on production.
3. Configure cal.com Workflow emails for both event types.
4. The branch is `feat/sig-landing-pages`.
5. Deploy with:
   ```bash
   vercel --prod
   ```

No environment variables are required by these pages. The cal.com embed (`@calcom/embed-react`) is client-side and does not require server-side secrets.
