# Deployment Guide: GitHub Pages (Frontend) + Vercel (Backend API)

Since GitHub Pages only hosts static files, it cannot run the serverless Node.js code located in the `/api` directory. 

Recommended production path: deploy the whole project to **Vercel** so the frontend and `/api/live-scores` share the same origin.

Alternative path: deploy the **Backend API** to **Vercel** and the **Frontend** to **GitHub Pages**. GitHub Pages only hosts static files, so the cockpit must be configured with the absolute Vercel API URL.

For local development, run:

```bash
npm run dev
```

This starts `local-server.js` at `http://localhost:3000` and does not require Vercel login. If you need the Vercel CLI locally, run:

```bash
npm run vercel:dev
```

---

## Step 1: Create a GitHub Repository and Push Code

1. Log into your GitHub account and create a new repository (e.g., `FIFA-Scoreboard`). Do not add a README, `.gitignore`, or license.
2. Open your terminal in the project directory:
   `/Users/sammiecheston/Desktop/Projects 2026B/FIFA/FiFa_Scoreborad_Tracking/world-cup-multisource-live-ticker-scoreboard-os`
3. Run the following commands to initialize Git and push the code:
   ```bash
   # Initialize Git repository
   git init

   # Stage and commit all files
   git add .
   git commit -m "Initial commit of World Cup Scoreboard OS"

   # Rename branch to main
   git branch -M main

   # Add your remote GitHub repository and push
   git remote add origin https://github.com/<YOUR-GITHUB-USERNAME>/<YOUR-REPO-NAME>.git
   git push -u origin main
   ```

---

## Step 2: Deploy Backend API to Vercel

Vercel automatically detects the `/api` directory and hosts the serverless functions.

1. Go to [Vercel](https://vercel.com) and log in (using your GitHub account).
2. Click **Add New...** -> **Project**.
3. Import your new GitHub repository (`FIFA-Scoreboard`).
4. (Optional) If you have API keys (e.g., `APISPORTS_KEY` for API-Football), expand the **Environment Variables** section and add them.
   - `PROVIDER_TIMEOUT_MS` controls provider timeout duration; default is `7000`.
   - `ENABLE_WORLDCUP26_FREE=true` enables the optional community API.
   - `ENABLE_FIFA_SCRAPE=true` enables the optional official FIFA page scrape.
5. Click **Deploy**.
6. Once deployed, copy your project's domain URL (e.g., `https://fifa-scoreboard.vercel.app`).
   - Your live API endpoint will be: `https://fifa-scoreboard.vercel.app/api/live-scores`

---

## Step 3: Deploy Frontend to GitHub Pages

We have configured `package.json` with a deployment script using the `gh-pages` tool.

1. Run the following command in your local project directory:
   ```bash
   npm run deploy
   ```
   *This command publishes the static frontend files to a new `gh-pages` branch. GitHub Pages will not run the `/api` serverless function.*
2. Go to your repository on GitHub.
3. Navigate to **Settings** -> **Pages**.
4. Under **Build and deployment**, ensure the **Branch** is set to `gh-pages` (root `/`) and click **Save**.
5. After a minute, GitHub will give you your live URL (e.g., `https://<YOUR-GITHUB-USERNAME>.github.io/<YOUR-REPO-NAME>/`).

---

## Step 4: Configure Cockpit on GitHub Pages

1. Open your live GitHub Pages URL in your browser.
2. In the **Public screen settings** panel on the left sidebar:
   - Locate the **Realtime API URL** input.
   - Paste your Vercel API endpoint: `https://<YOUR-VERCEL-DOMAIN>.vercel.app/api/live-scores`
   - Click **Save public settings**.
3. Click **Open public screen**.
4. **All set!** The cockpit and public screen running on GitHub Pages will now fetch live match data from your serverless API hosted on Vercel.

Important: `localStorage` sync only works between tabs/windows in the same browser profile and origin. It does not sync separate laptops, TVs, browsers, or phones. Configure each production screen with the same Vercel API URL.

> [!NOTE]
> If you want to load the Cockpit with a pre-configured API URL directly, you can append it as a query parameter in your URL:
> `https://<YOUR-GITHUB-USERNAME>.github.io/<YOUR-REPO-NAME>/index.html?api=https://<YOUR-VERCEL-DOMAIN>.vercel.app/api/live-scores`
