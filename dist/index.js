var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var core = __toESM(require("@actions/core"));
var import_github = require("@actions/github");
var import_fs = __toESM(require("fs"));
var import_axios = __toESM(require("axios"));
async function validateSubscription() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let repoPrivate;
  if (eventPath && import_fs.default.existsSync(eventPath)) {
    const eventData = JSON.parse(import_fs.default.readFileSync(eventPath, "utf8"));
    repoPrivate = eventData?.repository?.private;
  }
  const upstream = "getsentry/release-comment-issues-gh-action";
  const action = process.env.GITHUB_ACTION_REPOSITORY;
  const docsUrl = "https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions";
  core.info("");
  core.info("\x1B[1;36mStepSecurity Maintained Action\x1B[0m");
  core.info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false)
    core.info("\x1B[32m\u2713 Free for public repositories\x1B[0m");
  core.info(`\x1B[36mLearn more:\x1B[0m ${docsUrl}`);
  core.info("");
  if (repoPrivate === false) return;
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const body = { action: action || "" };
  if (serverUrl !== "https://github.com") body.ghes_server = serverUrl;
  try {
    await import_axios.default.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      { timeout: 3e3 }
    );
  } catch (error2) {
    if ((0, import_axios.isAxiosError)(error2) && error2.response?.status === 403) {
      core.error(
        `\x1B[1;31mThis action requires a StepSecurity subscription for private repositories.\x1B[0m`
      );
      core.error(
        `\x1B[31mLearn how to enable a subscription: ${docsUrl}\x1B[0m`
      );
      process.exit(1);
    }
    core.info("Timeout or API not reachable. Continuing to next step.");
  }
}
var RELEASE_COMMENT_HEADING = "## A PR closing this issue has just been released \u{1F680}";
async function run() {
  await validateSubscription();
  const { getInput } = core;
  const githubToken = getInput("github_token");
  const version = getInput("version");
  const mode = getInput("changelog_pr_mode") || "";
  if (!githubToken || !version) {
    core.debug("Skipping because github_token or version are empty.");
    return;
  }
  const { owner, repo } = import_github.context.repo;
  const octokit = (0, import_github.getOctokit)(githubToken);
  const release = await octokit.request(
    "GET /repos/{owner}/{repo}/releases/tags/{tag}",
    {
      owner,
      repo,
      tag: version,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }
  );
  const prNumbers = extractPrsFromReleaseBody(release.data.body, {
    repo,
    owner,
    mode
  });
  if (!prNumbers.length) {
    core.debug("No PRs found in release body.");
    return;
  }
  core.debug(`Found PRs in release body: ${prNumbers.join(", ")}`);
  const linkedIssues = await Promise.all(
    prNumbers.map(
      (prNumber) => getLinkedIssuesForPr(octokit, { repo, owner, prNumber })
    )
  );
  for (const pr of linkedIssues) {
    if (!pr.issues.length) {
      core.debug(`No linked issues found for PR #${pr.prNumber}`);
      continue;
    }
    core.debug(
      `Linked issues for PR #${pr.prNumber}: ${pr.issues.map((issue) => `${owner}/${issue.repository.name}#${issue.number}`).join(", ")}`
    );
    for (const issue of pr.issues) {
      const issueRepo = issue.repository.name;
      if (await hasExistingComment(octokit, {
        repo: issueRepo,
        // We enforce that owner of all linked issues is the same as the owner of the repo
        owner,
        issueNumber: issue.number
      })) {
        core.debug(`Comment already exists for issue #${issue.number}`);
        continue;
      }
      const prLink = repo === issueRepo ? `#${pr.prNumber}` : `[#${pr.prNumber}](https://github.com/${owner}/${repo}/pull/${pr.prNumber})`;
      const body = `${RELEASE_COMMENT_HEADING}

This issue was referenced by PR ${prLink}, which was included in the [${version} release](https://github.com/${owner}/${repo}/releases/tag/${version}).`;
      core.debug(`Creating comment for issue #${issue.number}`);
      try {
        await octokit.rest.issues.createComment({
          repo: issueRepo,
          owner,
          issue_number: issue.number,
          body
        });
      } catch (error2) {
        core.error(
          `Error creating comment for issue ${owner}/${issueRepo}#${issue.number}: ${error2.message}`
        );
      }
    }
  }
}
function extractPrsFromReleaseBody(body, { repo, owner, mode }) {
  const regex = mode === "SIMPLE_ROUND_BRACKETS" ? /\(#(\d+)\)/gm : new RegExp(
    `\\[#(\\d+)\\]\\(https:\\/\\/github\\.com\\/${owner}\\/${repo}\\/pull\\/(?:\\d+)\\)`,
    "gm"
  );
  const prNumbers = Array.from(
    new Set([...body.matchAll(regex)].map((match) => parseInt(match[1])))
  );
  return prNumbers.filter((number) => !!number && !Number.isNaN(number));
}
async function getLinkedIssuesForPr(octokit, { repo, owner, prNumber }) {
  try {
    const res = await octokit.graphql(
      /* GraphQL */
      `
        query issuesForPr($owner: String!, $repo: String!, $prNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $prNumber) {
              id
              closingIssuesReferences(first: 50) {
                nodes {
                  id
                  number
                  repository {
                    name
                    owner {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        prNumber,
        owner,
        repo
      }
    );
    const issues = res.repository?.pullRequest?.closingIssuesReferences.nodes.filter(
      ({ repository }) => repository?.owner?.login === owner
    );
    return {
      prNumber,
      issues
    };
  } catch (error2) {
    core.error(
      `Error fetching linked issues for PR ${owner}/${repo}#${prNumber}: ${error2.message}`
    );
    return {
      prNumber,
      issues: []
    };
  }
}
async function hasExistingComment(octokit, {
  repo,
  owner,
  issueNumber
}) {
  try {
    const { data: commentList } = await octokit.rest.issues.listComments({
      repo,
      owner,
      issue_number: issueNumber
    });
    return commentList.some(
      (comment) => comment.body.startsWith(RELEASE_COMMENT_HEADING)
    );
  } catch (error2) {
    console.error(
      `Error checking for existing comment for issue ${owner}/${repo}#${issueNumber}: ${error2.message}, assuming a comment exists...`
    );
    return true;
  }
}
run();
