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

    // 1. Extract JIRA ID (optional)
    const jiraIdMatch = pr.title.match(/[A-Z]+-[0-9]+/) || pr.head.ref.match(/[A-Z]+-[0-9]+/);
    const jiraId = jiraIdMatch ? jiraIdMatch[0] : null;
    if (jiraId) {
        console.log(`Found JIRA ID: ${jiraId}`);
    } else {
        console.log("No JIRA ID found in PR title or branch name. Proceeding without Jira enrichment.");
    }

    // 2. Fetch JIRA Data (only when a Jira ID is present and credentials are configured)
    let jiraCreatedAt = null;
    let jiraAuth = null;
    if (jiraId && JIRA_BASE_URL && JIRA_USER_EMAIL && JIRA_API_TOKEN) {
        jiraAuth = Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
        const jiraResponse = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${jiraId}`, {
            headers: {
                'Authorization': `Basic ${jiraAuth}`,
                'Accept': 'application/json'
            },
            signal: AbortSignal.timeout(30000)
        });

        if (jiraResponse.ok) {
            const jiraIssue = await jiraResponse.json();
            const jiraCreatedAtStr = jiraIssue.fields[JIRA_CREATED_FIELD] || jiraIssue.fields.created;
            jiraCreatedAt = new Date(jiraCreatedAtStr);
        } else {
            console.error(`Failed to fetch JIRA issue ${jiraId}: ${jiraResponse.statusText}`);
        }
    }

    // 3. GitHub PR Metadata
    const prCreatedAt = new Date(pr.created_at);
    const prMergedAt = new Date(pr.merged_at);

    // 4. Calculate Metrics (in hours)
    // cycleTimeHours requires Jira creation date; prLeadTimeHours is always available
    const cycleTimeHours = jiraCreatedAt ? parseFloat(((prMergedAt - jiraCreatedAt) / (1000 * 60 * 60)).toFixed(2)) : null;
    const prLeadTimeHours = parseFloat(((prMergedAt - prCreatedAt) / (1000 * 60 * 60)).toFixed(2));

    const metrics = {
        jiraId,
        prNumber: pr.number,
        title: pr.title,
        author: pr.user.login,
        jiraCreatedAt: jiraCreatedAt ? jiraCreatedAt.toISOString() : null,
        prCreatedAt: prCreatedAt.toISOString(),
        prMergedAt: prMergedAt.toISOString(),
        cycleTimeHours,
        prLeadTimeHours,
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
        // Close the Firebase connection so Node.js can exit cleanly.
        await admin.app().delete();
    }

    // 6. Update JIRA (only when Jira ID and credentials are available)
    if (jiraId && jiraAuth && (JIRA_CYCLE_TIME_FIELD || JIRA_PR_LEAD_TIME_FIELD)) {
        const updateFields = {};
        if (JIRA_CYCLE_TIME_FIELD && metrics.cycleTimeHours !== null) updateFields[JIRA_CYCLE_TIME_FIELD] = metrics.cycleTimeHours;
        if (JIRA_PR_LEAD_TIME_FIELD) updateFields[JIRA_PR_LEAD_TIME_FIELD] = metrics.prLeadTimeHours;

        await fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${jiraId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Basic ${jiraAuth}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: updateFields }),
            signal: AbortSignal.timeout(30000)
        });
        console.log("Updated JIRA fields.");
    }

    // 7. Add PR Comment
    const jiraLine = jiraId ? `\n- **Jira Issue:** [${jiraId}](${JIRA_BASE_URL}/browse/${jiraId})` : '';
    const cycleTimeLine = metrics.cycleTimeHours !== null ? `\n- **Cycle Time (Jira Creation to Merge):** ${metrics.cycleTimeHours} hours` : '';
    const commentBody = `### 📊 Development Metrics${cycleTimeLine}
- **PR Lead Time (PR Creation to Merge):** ${metrics.prLeadTimeHours} hours${jiraLine}`;

    await octokit.rest.issues.createComment({
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
