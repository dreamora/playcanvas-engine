const { Octokit } = require("octokit");
const admin = require("firebase-admin");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Configuration from environment variables
const {
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
    GITHUB_EVENT_PATH,
    JIRA_BASE_URL,
    JIRA_USER_EMAIL,
    JIRA_API_TOKEN,
    FIREBASE_DATABASE_URL,
    FIREBASE_SERVICE_ACCOUNT,
    JIRA_CREATED_FIELD = 'created',
    JIRA_CYCLE_TIME_FIELD,
    JIRA_PR_LEAD_TIME_FIELD
} = process.env;

async function run() {
    if (!GITHUB_EVENT_PATH) {
        console.error("GITHUB_EVENT_PATH is not defined. This script is intended to run in a GitHub Action.");
        return;
    }
    const fs = require('fs');
    const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, 'utf8'));
    const pr = event.pull_request;

    if (!pr || !pr.merged) {
        console.log("Not a merged PR. Skipping.");
        return;
    }

    if (!GITHUB_TOKEN) {
        throw new Error("GITHUB_TOKEN is not defined. This script requires GitHub authentication to create a PR comment.");
    }
    if (!GITHUB_REPOSITORY || !/^[^/]+\/[^/]+$/.test(GITHUB_REPOSITORY)) {
        throw new Error("GITHUB_REPOSITORY must be defined in 'owner/repo' format.");
    }
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const [owner, repo] = GITHUB_REPOSITORY.split("/");

    // 1. Extract JIRA ID
    const jiraIdMatch = pr.title.match(/[A-Z]+-[0-9]+/) || pr.head.ref.match(/[A-Z]+-[0-9]+/);
    if (!jiraIdMatch) {
        console.log("No JIRA ID found in PR title or branch name.");
        return;
    }
    const jiraId = jiraIdMatch[0];
    console.log(`Found JIRA ID: ${jiraId}`);

    // 2. Fetch JIRA Data
    if (!JIRA_BASE_URL || !JIRA_USER_EMAIL || !JIRA_API_TOKEN) {
        console.error("Missing Jira configuration (JIRA_BASE_URL, JIRA_USER_EMAIL, or JIRA_API_TOKEN).");
        return;
    }
    const jiraAuth = Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
    const jiraResponse = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${jiraId}`, {
        headers: {
            'Authorization': `Basic ${jiraAuth}`,
            'Accept': 'application/json'
        }
    });

    if (!jiraResponse.ok) {
        console.error(`Failed to fetch JIRA issue ${jiraId}: ${jiraResponse.statusText}`);
        return;
    }

    const jiraIssue = await jiraResponse.json();
    const jiraCreatedAtStr = jiraIssue.fields[JIRA_CREATED_FIELD] || jiraIssue.fields.created;
    const jiraCreatedAt = new Date(jiraCreatedAtStr);

    // 3. GitHub PR Metadata
    const prCreatedAt = new Date(pr.created_at);
    const prMergedAt = new Date(pr.merged_at);

    // 4. Calculate Metrics (in hours)
    const cycleTimeHours = (prMergedAt - jiraCreatedAt) / (1000 * 60 * 60);
    const prLeadTimeHours = (prMergedAt - prCreatedAt) / (1000 * 60 * 60);

    const metrics = {
        jiraId,
        prNumber: pr.number,
        title: pr.title,
        author: pr.user.login,
        jiraCreatedAt: jiraCreatedAt.toISOString(),
        prCreatedAt: prCreatedAt.toISOString(),
        prMergedAt: prMergedAt.toISOString(),
        cycleTimeHours: parseFloat(cycleTimeHours.toFixed(2)),
        prLeadTimeHours: parseFloat(prLeadTimeHours.toFixed(2)),
        repository: GITHUB_REPOSITORY
    };

    console.log("Calculated Metrics:", metrics);

    // 5. Store in Firebase
    if (FIREBASE_SERVICE_ACCOUNT && FIREBASE_DATABASE_URL) {
        const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: FIREBASE_DATABASE_URL
            });
        }
        const db = admin.database();
    const safeRepoPath = GITHUB_REPOSITORY.replace(/\//g, ':').replace(/\./g, '_');
    const ref = db.ref(`metrics/${safeRepoPath}/${pr.number}`);
        await ref.set(metrics);
        console.log("Stored in Firebase.");
    }

    // 6. Update JIRA
    if (JIRA_CYCLE_TIME_FIELD || JIRA_PR_LEAD_TIME_FIELD) {
        const updateFields = {};
        if (JIRA_CYCLE_TIME_FIELD) updateFields[JIRA_CYCLE_TIME_FIELD] = metrics.cycleTimeHours;
        if (JIRA_PR_LEAD_TIME_FIELD) updateFields[JIRA_PR_LEAD_TIME_FIELD] = metrics.prLeadTimeHours;

        await fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${jiraId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Basic ${jiraAuth}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: updateFields })
        });
        console.log("Updated JIRA fields.");
    }

    // 7. Add PR Comment
    const commentBody = `### 📊 Development Metrics
- **Cycle Time (Jira Creation to Merge):** ${metrics.cycleTimeHours} hours
- **PR Lead Time (PR Creation to Merge):** ${metrics.prLeadTimeHours} hours
- **Jira Issue:** [${jiraId}](${JIRA_BASE_URL}/browse/${jiraId})`;

    await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pr.number,
        body: commentBody
    });
    console.log("Added PR comment.");
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
