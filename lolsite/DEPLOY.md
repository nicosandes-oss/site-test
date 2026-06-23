# Putting this site online — step by step

You have 3 things in this folder:
- `server.js` — the backend (talks to Riot, holds your secret key)
- `package.json` — tells the host what to install before running
- `public/index.html` — the website itself

You do NOT need to understand all the code. Follow these steps in order.

---

## Step 1: Put this folder on GitHub

1. Go to https://github.com and log in.
2. Click the **+** icon (top right) → **New repository**.
3. Name it something like `lol-h2h-site`. Leave it **Public** (Render's free
   tier wants this — don't worry, your API key will NOT be in this code,
   we add it separately in step 3).
4. Click **Create repository**.
5. On the next page, look for a link that says **"uploading an existing file"**.
   Click it.
6. Drag in all 3 items from this folder: `server.js`, `package.json`, and the
   whole `public` folder (with `index.html` inside it).
7. Scroll down, click **Commit changes**.

You now have your code on GitHub. Nobody can run it yet — it's just stored there.

---

## Step 2: Create a free Render account

1. Go to https://render.com
2. Click **Get Started** → sign up using **"Sign up with GitHub"** (this lets
   Render see your repositories without you typing passwords back and forth).
3. Approve the GitHub permission popup.

---

## Step 3: Deploy the site

1. On Render's dashboard, click **New +** → **Web Service**.
2. Find and select the `lol-h2h-site` repository you just uploaded.
3. Render will show a settings form. Fill in:
   - **Name**: anything, e.g. `lol-h2h-site`
   - **Region**: closest to you
   - **Branch**: `main` (default is fine)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. Scroll down to **Environment Variables**. Click **Add Environment Variable**.
   - Key: `RIOT_API_KEY`
   - Value: paste your key from developer.riotgames.com (the `RGAPI-...` string)
5. Click **Create Web Service**.

Render will now build and start your site. This takes 1-3 minutes. You'll see
logs scrolling — when it says something like `Server running on port 10000`,
it's live.

6. At the top of the page, Render shows you a URL like
   `https://lol-h2h-site.onrender.com` — that's your real, public website.
   Click it.

---

## Important things to know

**Your API key expires every 24 hours.** This is a Riot limitation on free
developer keys, not a bug in the site. When it expires, requests will start
failing with an error. To fix it:
1. Go back to developer.riotgames.com, log in, generate a new key.
2. Go to your Render dashboard → your service → **Environment**.
3. Edit the `RIOT_API_KEY` value, paste the new key, save.
4. Render automatically restarts the service with the new key — no re-upload needed.

This is annoying for a real public site. Once the site works and you want it
to stay reliable for other people, apply for a **Production API key** on the
Riot developer portal (there's an application form asking what you built —
link them your live Render URL). Production keys don't expire daily and have
much higher rate limits.

**Free Render services "sleep" after 15 minutes of no visitors.** The first
visitor after a quiet period waits ~30-50 seconds for it to wake up. This is
normal on the free tier. Upgrading to a paid Render plan removes this.

**If something goes wrong:** Render's dashboard has a **Logs** tab for your
service — any error messages from the server will show up there. That's the
first place to look.

---

## Making changes later

Whenever you want to edit the site (change colors, text, add features):
1. Edit the file on GitHub directly (click the file → pencil icon → edit → commit),
   or edit locally and re-upload.
2. Render automatically redeploys within a minute or two of any change to
   the `main` branch. You don't need to tell it to redeploy.
