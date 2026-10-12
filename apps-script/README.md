# Community API setup

This folder contains the production API source. It is deliberately separate from the dashboard's public JavaScript.

## Important: this does not deploy itself

Adding `apps-script/Code.gs` to GitHub does not change the Apps Script project bound to your private `Competition Community Data` spreadsheet. The existing deployed endpoint remains the test version until you copy this code into Apps Script, configure it, and deploy a new version.

## 1. Configure the private Apps Script project

1. Open the Apps Script project attached to **Competition Community Data**.
2. Replace the contents of its `Code.gs` with `apps-script/Code.gs` from this repository.
3. Open **Project Settings**.
4. Under **Script Properties**, add these properties:
   - `SPREADSHEET_ID`: the ID of your private **Competition Community Data** spreadsheet.
   - `ADMIN_TOKEN`: a long, random secret (at least 32 random characters). Generate it privately and do not put it in GitHub, a screenshot, a public sheet, or dashboard source code.
5. Save the project.
6. Run a function only if prompted for permissions, then review and approve the requested spreadsheet access.

The script creates a dedicated **Team Settings** tab when the public read endpoint is first used. It never accepts a sheet name, range, formula, fixture, or score from a request.

## 2. Deploy a new version

1. In Apps Script, choose **Deploy → Manage deployments**.
2. Edit the existing web-app deployment.
3. Select **New version**, then deploy.
4. Keep it configured to execute as you (the spreadsheet owner) and allow public access so the public dashboard can read settings.
5. Use the existing `/exec` URL. If Apps Script gives you a different URL, use that one.

The public endpoint must be readable without signing in. Therefore, only public team display settings are returned by GET. Never put private information in the Team Settings tab.

The Team Page Studio supports team-authenticated shared drafts, publishing, and feature requests. A successful PIN check issues a short-lived (6-hour) session token in the browser session. The token permits writes only for that team. Drafts are stored in the private **Team Page Designs** tab; published layouts are stored separately in **Published Team Pages**; feature suggestions are appended to **Feature Requests**. Shared design JSON is capped at 45,000 characters, so use hosted image URLs rather than embedded uploads. A team page continues to use its original built-in layout until a team manager clicks **Update team page** in Studio. Publishing replaces only that team's public page; draft saves alone never change the live page.

## 3. API contract

### Public read

- `GET /exec?action=health`
- `GET /exec?action=getTeamSettings`
- `GET /exec?action=getTeamPageDesign&teamId=A&sessionToken=...&callback=...` (valid team session required)
- `GET /exec?action=getPublishedTeamPage&teamId=A&callback=...` (public published layout; no session token required)
- `GET /exec?action=getTeamEditorPinStatus` returns which teams have a PIN set, never the PIN itself.
- `GET /exec?action=verifyTeamEditorPin&pin=123456` verifies one PIN and returns its team ID only on success.
- Add `&callback=someFunction` to a read URL for JSONP from GitHub Pages.

A successful settings response includes five records with `teamId`, `displayName`, `primaryColor`, `secondaryColor`, `logoUrl`, and `updatedAt`.

### Admin write

POST JSON using the `text/plain;charset=UTF-8` content type from a browser's `no-cors` request. Include:

- `action: "updateTeamSettings"`
- `adminToken`: the secret entered by the administrator for this session
- `teams`: exactly one validated settings record for each team ID A–E

Team Studio can POST `action: "saveTeamPageDesign"` with `teamId`, `sessionToken`, and a `design` object after a valid team PIN login. This only saves a draft. The **Update team page** button POSTs `action: "publishTeamPage"` with the same team-scoped session and current design; the published copy is stored in **Published Team Pages** and is then read by the public dashboard. The **Revert to default** button POSTs `action: "revertTeamPage"` with the same session and removes only that team’s published record, returning its public page to the original built-in layout. The Studio requires three confirmation dialogs plus typing `REVERT` before sending that request. It can also POST `action: "submitFeatureRequest"` with a short `request` and optional `teamId`; requests are stored in the private Feature Requests tab. These actions do not use the admin token; save and publish require a team-specific session token.

The Admin page can also POST `action: "updateTeamEditorPin"` with `adminToken`, `teamId` (A–E), and a six-digit `pin`. This creates/updates the private **Team Editor PINs** tab with columns `Team ID`, `PIN`, and `Updated At`. The public status endpoint never returns PIN values. The PINs are plain text in the private spreadsheet, so keep that spreadsheet private. Repeated failed verification attempts are rate-limited.

The server validates names (1–30 characters), optional hex colours, optional HTTPS logo URLs, and unique team IDs. Team settings writes affect only the **Team Settings** tab; PIN writes affect only **Team Editor PINs**. For a cross-origin browser request using `no-cors`, JavaScript cannot read the POST response, so the client must follow it with a public GET and verify the saved values.

**Never hardcode the admin token in `script.js` or another public website file.** The token should be entered into a protected admin interface at runtime and kept only in memory for that page session. Anyone who can see the request while it is being made can see the bearer token, so use a private admin device and do not share it.

## 4. Before connecting the dashboard

The existing `api-test.html` page tests the old `testWrite` action. After deploying this new API, that old test-write action is intentionally no longer accepted, so the old diagnostic write test will fail. That is expected. The production API should be verified with read-only health/settings requests first, then with the new validated update operation using the private token.

Do not connect the dashboard's team-name editor until the production deployment is configured and the settings response has been checked. Team Editor PINs are verified by the Apps Script API and stored in the private spreadsheet. A six-digit PIN is convenient but should not be treated as a high-security password.
