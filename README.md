# Boarding Laundry Queue

A simple website for Scarborough College boarders to queue for the laundry. It uses the school's navy and gold colours and the Montserrat font.

- **Queue page (`/`)**: shows who is washing now, who is next, and today's and tomorrow's lists. A student who has signed up sees their own place in line ("You're 2nd in line, 1 person ahead of you"). The page refreshes every minute.
- **Sign up by QR code only**: students scan the poster in the laundry room. The code opens `/join`, where they enter their name and house/room and tap **Today** or **Tomorrow**. Their name and house are remembered, so next time it's a single tap. Each phone can be on a day's list once. A student can take their own name off while they are still waiting.
- **Staff admin (`/admin`)**, password protected:
  - **Start next** is a one-tap button: it finishes the current wash and starts the next person.
  - **Start** sets an entry to "In the machine", **Done** marks it finished, **Remove** deletes it, and **Clear whole list** empties a day.
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
| `PUBLIC_URL`     | Public address of the site, e.g. `https://laundry.example.com`. The QR code is built from it. If unset, the address the admin page was opened from is used. |

Data is saved in `data/db.json`. Keep this folder when you redeploy.

## Putting it live

1. Host it anywhere that runs Node and keeps a persistent disk, such as a school server, Render, Railway or Fly.io. Use HTTPS.
2. Set `ADMIN_PASSWORD` and `PUBLIC_URL`.
3. Log in at `/admin`, click **Print poster** and put the poster up in the laundry room.

## Tests

```bash
npm test
```
