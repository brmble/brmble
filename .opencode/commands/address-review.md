---
description: Address PR review comments, make fixes, reply, and resolve threads
---

# Address PR Review Comments

Automates addressing pull request review feedback: analyze comments, make fixes, reply to explain changes, resolve threads.

## Prerequisites

- Must have `gh` CLI authenticated (`gh auth status` to verify)
- Must be in a git repository with a GitHub remote

## Step 1: Validate Input

**If $ARGUMENTS is empty:**

- Ask the user for the PR number
- Validate it's a number

**If $ARGUMENTS is provided:**

- Extract PR number from $ARGUMENTS
- Validate it's a valid number

## Step 2: Determine Repository Info

Run `gh repo view --json owner,name --jq '.owner.login + " " + .name'` to get the owner and repo name. Store these for use in subsequent API calls.

## Step 3: Fetch PR Review Threads

Run this GraphQL query to get all unresolved review threads (replace `{owner}`, `{repo}`, and `PR_NUMBER` with actual values):

```bash
gh api graphql -f query='
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: PR_NUMBER) {
      id
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          line
          comments(first: 10) {
            nodes {
              id
              databaseId
              body
              author {
                login
              }
            }
          }
        }
      }
    }
  }
}'
```

Filter to only unresolved threads (`isResolved: false`).

If there are no unresolved threads, inform the user and exit.

## Step 4: Analyze and Categorize Comments

For each unresolved thread:

1. Read the comment body to understand the feedback
2. Identify the file path and line number
3. Read the relevant file section to understand the context
4. Categorize the type of feedback:
   - **Code change needed** — requires file modification
   - **Documentation** — needs comment/doc update
   - **Question** — requires explanation only, no code change
   - **Disagree/Won't fix** — ASK THE USER before responding

Present a summary to the user showing:

- Number of comments found
- File paths affected
- Brief description of each comment

**IMPORTANT**: For any comment where you disagree or think "won't fix" is appropriate, ask the user for confirmation before replying. Never auto-resolve disagreements.

## Step 5: Address Each Comment

For each comment requiring action:

### 5a. Read the relevant file

Read the file to understand the context around the specified line.

### 5b. Make the fix

Edit the file to make the necessary changes based on the feedback.

### 5c. Reply to the comment

Use the REST API to reply to the comment explaining what was done:

```bash
gh api --method POST \
  repos/{owner}/{repo}/pulls/PR_NUMBER/comments/COMMENT_DB_ID/replies \
  -f body='Fixed: [explanation of what was changed and why]'
```

Keep replies concise but informative. Explain WHAT was changed and WHY.

### 5d. Resolve the thread

Use GraphQL mutation to resolve the thread:

```bash
gh api graphql -f query='
mutation {
  resolveReviewThread(input: {threadId: "THREAD_NODE_ID"}) {
    thread { isResolved }
  }
}'
```

## Step 6: Commit Changes

After all fixes are made:

1. Stage all changed files with `git add`
2. Create a commit with a descriptive message:

```bash
git commit -m "fix: address PR review feedback

- [list each fix made]
- [reference comment IDs if helpful]"
```

3. Push the changes to the remote branch

## Step 7: Request Re-Review (Optional)

Ask the user if they want to request a re-review. If yes, ask who to notify:

```bash
gh pr comment PR_NUMBER --body '@REVIEWER please re-review'
```

## Step 8: Summary

Present a summary to the user:

- Number of comments addressed
- Files modified
- Commit hash created
- Any comments that were NOT addressed (with reasons)
- Link to the PR

## Error Handling

- If `gh` CLI is not authenticated, instruct user to run `gh auth login`
- If PR number is invalid, show error and ask for correct number
- If a thread fails to resolve, log the error but continue with other threads
- If commit fails, show the error and suggest manual resolution
