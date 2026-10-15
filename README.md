# Boarding Laundry Queue

A simple website for Scarborough College boarders to queue for the laundry. It uses the school's navy and gold colours and the Montserrat font.

- **Queue page (`/`)**: shows who is washing now, who is next, and today's and tomorrow's lists. A student who has signed up sees their own place in line ("You're 2nd in line, 1 person ahead of you"). The page refreshes every minute.
- **Sign up by QR code only**: students scan the poster in the laundry room. The code opens `/join`, where they enter their name and house/room and tap **Today** or **Tomorrow**. Their name and house are remembered, so next time it's a single tap. Each phone can be on a day's list once. A student can take their own name off while they are still waiting.
- **Your turn**: when staff tap **Call next**, that student gets a phone notification ("It's your turn!"). Their page turns red and shows a countdown, and it buzzes if it's open. Pages update by themselves every few seconds.
- **No-shows**: a called student has 10 minutes to arrive. If they don't (or staff tap **Not here — skip**), they go to the back of the queue and the next person is called automatically. Missing a turn twice takes them off the list. A called student can tap **Can't make it** to hand the turn on.
- **Staff admin (`/admin`)**, password protected:
  - **Call next** is a one-tap button. It finishes the current wash (telling that student to collect their laundry) and calls the next person.
  - When the student turns up, tap **Arrived — start wash**. **Remove** deletes an entry, and **Clear whole list** empties a day.
  - **Print poster** gives a printable QR code. **Generate new code** stops old posters and photos of them from working.
- At midnight UK time, "tomorrow" becomes "today" by itself. Entries older than 14 days are deleted.

## Run it

Requires Node.js 18 or newer.

```bash
npm install
ADMIN_PASSWORD=choose-a-password npm start
# open http://localhost:3000
```

| Variable         | Purpose                                                                 |
|------------------|-------------------------------------------------------------------------|
| `ADMIN_PASSWORD` | **Required.** Password for the staff admin page.                        |
| `PORT`           | Port to listen on (default `3000`).                                     |
| `NO_SHOW_MINUTES`| How long a called student has to arrive before being skipped (default `10`). |
| `VAPID_SUBJECT`  | Contact for the push service, e.g. `mailto:boarding@yourschool.co.uk`. |
| `PUBLIC_URL`     | Public address of the site, e.g. `https://laundry.example.com`. The QR code is built from it. If unset, the address the admin page was opened from is used. |

Data is saved in `data/db.json`. Keep this folder when you redeploy.

## Notifications

- Students tap **Notify me when it's my turn** on the queue page after signing up.
- **Android, Windows, Mac**: works in Chrome, Edge and Firefox. Safari on Mac also works.
- **iPhone/iPad** (iOS 16.4 or later): Apple only allows notifications from sites added to the home screen. The page tells students how: **Share → Add to Home Screen**, then open the queue from there.
- Notifications need the site to be on **HTTPS** (`localhost` is fine for testing).
- The keys for sending notifications are created automatically and saved in `data/db.json`.

## Putting it live

1. Host it anywhere that runs Node and keeps a persistent disk, such as a school server, Render, Railway or Fly.io. Use HTTPS.
2. Set `ADMIN_PASSWORD` and `PUBLIC_URL`.
3. Log in at `/admin`, click **Print poster** and put the poster up in the laundry room.

## Tests

```bash
npm test
```
