const { Octokit } = require("octokit");
const admin = require("firebase-admin");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const {
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
    JIRA_BASE_URL,
    JIRA_USER_EMAIL,
    JIRA_API_TOKEN,
    FIREBASE_DATABASE_URL,
    FIREBASE_SERVICE_ACCOUNT,
    JIRA_CREATED_FIELD = 'created'
} = process.env;

async function scrape() {
    if (!GITHUB_REPOSITORY) throw new Error("GITHUB_REPOSITORY env var is required (e.g. owner/repo or owner/repo1,owner/repo2)");

    const reposToScrape = GITHUB_REPOSITORY.split(",").map(r => r.trim());
    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    console.log(`Starting historical scrape for: ${reposToScrape.join(", ")}`);

    // Initialize Firebase
    if (FIREBASE_SERVICE_ACCOUNT && FIREBASE_DATABASE_URL) {
        const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: FIREBASE_DATABASE_URL
            });
        }
    } else {
        throw new Error("Firebase configuration missing.");
    }

    const db = admin.database();

    for (const repoPath of reposToScrape) {
        const [owner, repo] = repoPath.split("/");
        console.log(`\n--- Scraping ${repoPath} ---`);

        // Fetch last 100 merged PRs
        const { data: pullRequests } = await octokit.rest.pulls.list({
            owner,
            repo,
            state: 'closed',
            per_page: 100,
            sort: 'updated',
            direction: 'desc'
        });

        const mergedPRs = pullRequests.filter(pr => pr.merged_at);
        console.log(`Found ${mergedPRs.length} merged PRs in ${repoPath}.`);

        for (const pr of mergedPRs) {
            const jiraIdMatch = pr.title.match(/[A-Z]+-[0-9]+/) || pr.head.ref.match(/[A-Z]+-[0-9]+/);
            const jiraId = jiraIdMatch ? jiraIdMatch[0] : null;
            if (jiraId) {
                console.log(`Processing PR #${pr.number} with Jira ID ${jiraId}...`);
            } else {
                console.log(`Processing PR #${pr.number} (no Jira ID)...`);
            }

            try {
                let jiraCreatedAt = null;
                if (jiraId && JIRA_BASE_URL && JIRA_USER_EMAIL && JIRA_API_TOKEN) {
                    const jiraAuth = Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
                    const jiraResponse = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${jiraId}`, {
                        headers: {
                            'Authorization': `Basic ${jiraAuth}`,
                            'Accept': 'application/json'
                        }
                    });

                    if (jiraResponse.ok) {
                        const jiraIssue = await jiraResponse.json();
                        const jiraCreatedAtStr = jiraIssue.fields[JIRA_CREATED_FIELD] || jiraIssue.fields.created;
                        jiraCreatedAt = new Date(jiraCreatedAtStr);
                    } else {
                        console.error(`Failed to fetch JIRA issue ${jiraId}: ${jiraResponse.statusText}`);
                    }
                }

                const prCreatedAt = new Date(pr.created_at);
                const prMergedAt = new Date(pr.merged_at);

                // Fetch all commits on the PR to find the earliest author date (Branch Lead Time)
                let branchStartedAt = prCreatedAt;
                let page = 1;
                let allCommits = [];
                while (true) {
                    const { data: commits } = await octokit.rest.pulls.listCommits({
                        owner,
                        repo,
                        pull_number: pr.number,
                        per_page: 100,
                        page
                    });
                    allCommits = allCommits.concat(commits);
                    if (commits.length < 100) break;
                    page++;
                }
                if (allCommits.length > 0) {
                    const earliest = allCommits.reduce((min, c) => {
                        const d = new Date(c.commit.author.date);
                        return d < min ? d : min;
                    }, new Date(allCommits[0].commit.author.date));
                    branchStartedAt = earliest;
                } else {
                    console.warn(`No commits found for PR #${pr.number}. Falling back to prCreatedAt for branchStartedAt.`);
                }
                const branchLeadTimeHours = parseFloat(((prMergedAt - branchStartedAt) / (1000 * 60 * 60)).toFixed(2));

                const metrics = {
                    jiraId,
                    prNumber: pr.number,
                    title: pr.title,
                    author: pr.user.login,
                    jiraCreatedAt: jiraCreatedAt ? jiraCreatedAt.toISOString() : null,
                    prCreatedAt: prCreatedAt.toISOString(),
                    prMergedAt: prMergedAt.toISOString(),
                    branchStartedAt: branchStartedAt.toISOString(),
                    cycleTimeHours: jiraCreatedAt ? parseFloat(((prMergedAt - jiraCreatedAt) / (1000 * 60 * 60)).toFixed(2)) : null,
                    prLeadTimeHours: parseFloat(((prMergedAt - prCreatedAt) / (1000 * 60 * 60)).toFixed(2)),
                    branchLeadTimeHours,
                    repository: repoPath
                };

                const safeRepoPath = repoPath.replace(/\//g, ':').replace(/\./g, '_');
                await db.ref(`metrics/${safeRepoPath}/${pr.number}`).set(metrics);
            } catch (e) {
                console.error(`Error processing PR #${pr.number}:`, e.message);
            }
        }
    }

    console.log("\nAll scrapes complete.");
    process.exit(0);
}

scrape().catch(err => {
    console.error(err);
    process.exit(1);
});
