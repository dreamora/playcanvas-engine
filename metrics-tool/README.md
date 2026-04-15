# 📊 Metrics Tool

A standalone tool to measure, track, and visualize development metrics: **Cycle Time** (Jira ticket creation to merge) and **PR Lead Time** (PR creation to merge).

## Features
- **GitHub Action**: Automatically calculates metrics on PR merge.
- **Jira Integration**: Updates Jira tickets with metrics and links.
- **Firebase Persistence**: Stores metrics in a lightweight JSON database.
- **Vue.js Dashboard**: Visualizes trends and distributions of your team's velocity.

## Setup Instructions

### 1. Firebase Setup
1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com/).
2. Enable **Realtime Database**.
3. Go to Project Settings > Service Accounts and generate a new **Private Key**. This will be your `FIREBASE_SERVICE_ACCOUNT`.
4. Create a **Web App** in the Firebase console and copy the `firebaseConfig` object.

### 2. GitHub Secrets
Add the following secrets to your repository:
- `GITHUB_TOKEN`: A PAT with repo access (or use the default `secrets.GITHUB_TOKEN`).
- `JIRA_BASE_URL`: e.g., `https://your-domain.atlassian.net`.
- `JIRA_USER_EMAIL`: Your Jira account email.
- `JIRA_API_TOKEN`: Your Jira API token.
- `FIREBASE_DATABASE_URL`: The URL of your Realtime Database.
- `FIREBASE_SERVICE_ACCOUNT`: The full JSON string of your service account key.
- `FIREBASE_CONFIG`: The full JSON string of your Firebase web app config.

### 3. GitHub Variables (Optional)
- `JIRA_CREATED_FIELD`: The custom field ID for the "original creation date" if the default `created` field is inaccurate.
- `JIRA_CYCLE_TIME_FIELD`: The Jira custom field ID to update with Cycle Time.
- `JIRA_PR_LEAD_TIME_FIELD`: The Jira custom field ID to update with PR Lead Time.
- `FIREBASE_PROJECT_ID`: Your Firebase project ID for hosting.

### 4. Deployment
The tool is designed to be "Option B" (merged into your repo).
1. Copy the `metrics-tool` folder and `.github/workflows/metrics-tracker.yml` to your repository.
2. Once secrets are set, the next merged PR will trigger the tracker and deploy the dashboard.

## Historical Scrape
To backfill data, run the scraper locally:
```bash
cd metrics-tool
npm install
# Create a .env file with the required secrets
node scripts/historical-scraper.js
```

## Dashboard Development
```bash
cd metrics-tool/dashboard
npm install
npm run dev
```
