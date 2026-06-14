# Deployment Guide: GitHub Pages (Frontend) + Vercel (Backend API)

Since GitHub Pages only hosts static files, it cannot run the serverless Node.js code located in the `/api` directory. 

To run this application online, we will deploy the **Backend API** to **Vercel** (which runs serverless functions for free) and the **Frontend** to **GitHub Pages**.

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
   *This command compiles the files and pushes them to a new `gh-pages` branch in your GitHub repository.*
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
4. **All set!** The cockpit and public screen running on GitHub Pages will now fetch live, real-time match data directly from your serverless API hosted on Vercel. They will sync automatically using `localStorage`.

> [!NOTE]
> If you want to load the Cockpit with a pre-configured API URL directly, you can append it as a query parameter in your URL:
> `https://<YOUR-GITHUB-USERNAME>.github.io/<YOUR-REPO-NAME>/index.html?api=https://<YOUR-VERCEL-DOMAIN>.vercel.app/api/live-scores`
