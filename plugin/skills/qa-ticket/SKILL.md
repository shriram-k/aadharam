---
name: qa-ticket
description: Run manual QA on a Jira ticket end to end - get its acceptance criteria, test each one with a qa-tester subagent against staging, collect evidence, and report to Jira. Use when asked to QA, test or verify a ticket, e.g. "/aadharam:qa-ticket PROJ-123 https://staging.example.com".
---

# QA a ticket (interactive mode)

Arguments: a Jira issue key and the staging base URL. If either is missing, ask once.

## Steps

1. **Get the criteria.** Read the ticket (Atlassian connector if available, otherwise ask
   the user to paste the acceptance criteria). Turn them into a numbered list `AC-1..AC-n`,
   each one independently testable. Show the list and carry on unless the user objects.
   Maximum 10.

2. **Test each criterion with a `qa-tester` subagent, one at a time.**
   In this mode all subagents share ONE browser, so running them in parallel makes them
   fight over the same tabs. Run them sequentially. (For true parallelism use the
   standalone `aadharam` runner, which gives every tester its own isolated browser.)
   Give each subagent: the ticket key, the criterion id and text, the base URL, and
   where test credentials are (environment variables `AADHARAM_TEST_USERNAME` and
   `AADHARAM_TEST_PASSWORD`, never pasted into the prompt). Also tell it the evidence
   folder is `.aadharam/evidence/` and that screenshot filenames must include that path
   (for example `.aadharam/evidence/AC-1-3-dashboard.png`), because named screenshots
   are saved relative to the working directory.

3. **Verify evidence yourself before counting a PASS.** For every file a tester lists under
   `evidence`, check it exists and is non-empty (for example `ls -l`). A PASS with no
   existing evidence file is a FAIL. Never upgrade a result.

4. **Report.** Build the summary in the format from the `aadharam:jira-evidence` skill.
   Show it to the user first. Only after the user confirms, upload evidence and post the
   comment with that skill's scripts. Do not transition the ticket.

## Notes

- If the environment looks down or login fails for the first criterion, stop and tell the
  user rather than producing a string of BLOCKED results.
- Keep your own commentary short. The deliverable is the summary and the evidence.
