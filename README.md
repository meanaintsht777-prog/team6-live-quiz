# Team 7 — How Well Do You Know the Team?

A **live, multiplayer, five-question** classroom quiz. Players join from their phones through a shared link or five-character room code. The host projects the game; each question runs for ten seconds. Correct answers are worth 100 points and the class leaderboard appears at the end.

## Run locally

1. Install Node.js 20 or newer.
2. In this folder, run `npm start` (there are **no npm dependencies**).
3. Visit `http://localhost:3000` and choose **Create Room**.
4. For testing on the same laptop, open a private/incognito tab and join using the room code.

**Important:** `localhost` only works on your computer. To let classmates join from their own phones, **publish the site online** as described below.

## Publish so classmates can join

1. Create a new GitHub repository, e.g. `team7-quiz`.
2. Upload the contents of this folder (`server.js`, `package.json`, `render.yaml`, and the `public` folder) to the repository.
3. In [Render](https://render.com), sign in, click **New** → **Web Service**, and connect the GitHub repository.
4. Use **Node** as the runtime, **Build Command** `npm install`, and **Start Command** `npm start`. Render will usually read these automatically.
5. Deploy and open the `https://...onrender.com` address Render gives you. **This will be your public classroom website.**
6. On presentation day, open the website on the projector, choose **Host the quiz**, and share the room link (the host can copy it). Students open that link or type the five-character code on the website. Once students have joined, press **Start**.

Render's free plan and UI may change over time. The site can also be deployed to another Node.js-compatible host. Free hosting may take a short time to wake up after being idle, so **open it before class to test**.

## What happens in the game?

- **Host** creates a room and shares the code or join link.
- **Players** enter a nickname, then wait in the lobby.
- **Five questions** are displayed to everyone, automatically advancing after ten seconds; a four-second reveal shows the right answer and scores.
- **Scoring:** +100 points per correct answer; maximum 500.
- **Leaderboard:** visible on question reveals and at game completion.
- **Replay:** host can restart the same room.

## About the questions

These five questions were adapted from the uploaded *How Well Do You Know the Team?* PDF:

1. Best suited team facilitator — **Ademide (Demo) Otuyalo**.
2. Michael's top VIA strengths — **Humor, Honesty, Hope**.
3. Sharonm's top VIA strengths — **Humor, Curiosity, Creativity**.
4. Kindness, Fairness, Spirituality — **Laurens Bell**.
5. Sharonm's suggested leadership style — **Adaptive**.

The facilitator question refers to the *best-suited profile role*, not necessarily the facilitator in a particular rotating HIT meeting. This avoids confusing the rotating meeting roles with the profiles presented in your slide deck.

Edit `QUESTIONS` in `server.js` to change questions, answers, and explanations. Do not place answer keys in `public/app.js`: keeping them on the server prevents answer keys from appearing before the reveal.

## Technical and privacy notes

- Designed for one active class session per room, up to 120 players.
- Classmates do not need accounts; only chosen nicknames and scores are displayed. No external analytics are included.
- Rooms and scores are stored **in memory** and expire after two hours, or sooner if the hosting platform restarts. Players should not rely on the leaderboard as a permanent record.
- If the host closes a tab, re-open the same site in the same browser to recover the host session (unless the app was redeployed or the server restarted).
- The room code is unique during an active session, and only the host has permission to start/restart.
- Public shared link requires deploying to a hosting service: the ZIP itself is not a live public URL.
