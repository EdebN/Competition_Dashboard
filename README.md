# Competition Dashboard

Competition Dashboard is a GitHub Pages competition site backed by Google Sheets and Google Apps Script.

## Code Studio API

The Team Page Code Studio preview exposes a read-only JavaScript API named `CompDashboard`. It lets custom HTML/CSS/JavaScript pages read live competition data without copying fixtures or posts into the page source.

The API is available **inside the isolated Code Studio preview iframe**. It is not a global API on the main dashboard page.

### Quick start

Put this in the JavaScript tab:

```js
async function loadFixtures() {
  const fixtures = await CompDashboard.fixtures.list();

  const list = document.querySelector("#fixtures");
  list.innerHTML = "";

  fixtures.forEach(fixture => {
    const item = document.createElement("li");
    const score = fixture.homeScore === null || fixture.awayScore === null
      ? "Not played"
      : `${fixture.homeScore}–${fixture.awayScore}`;

    item.textContent =
      `Game ${fixture.matchId}: ${fixture.home} vs ${fixture.away} · ${score}`;

    list.appendChild(item);
  });
}

loadFixtures().catch(error => {
  console.error("Could not load fixtures:", error);
});
```

Put this in the HTML tab:

```html
<section class="fixtures-panel">
  <h2>Competition fixtures</h2>
  <ul id="fixtures">
    <li>Loading live fixtures…</li>
  </ul>
</section>
```

The data is fetched from the Competition Dashboard Apps Script API when the preview runs. The example does not contain a hardcoded fixture list.

## API reference

Every method returns a Promise. Use `await` or `.then()`. Methods return data, not HTML, so your code remains responsible for rendering and escaping content.

| Method | Returns | Description |
|---|---|---|
| `CompDashboard.fixtures.list()` | `Fixture[]` | All official fixture rows, including unplayed fixtures |
| `CompDashboard.results.list()` | `Fixture[]` | Fixtures with both scores recorded |
| `CompDashboard.teams.list()` | `Team[]` | Shared team names, colours and logo URLs |
| `CompDashboard.settings.get()` | `{ gamesPerTeam }` | Shared competition settings |
| `CompDashboard.posts.list()` | `Post[]` | Published public Socials posts |
| `CompDashboard.schedule.list()` | `ScheduleEntry[]` | Matchday date, time, venue and status |
| `CompDashboard.polls.list()` | `object` | Vote counts indexed by match ID, then team ID |
| `CompDashboard.assets.list()` | `Asset[]` | Public competition asset library |
| `CompDashboard.standings.list()` | `Standing[]` | Current standings calculated by the dashboard rating engine |
| `CompDashboard.players.list()` | `PlayerCard[]` | Saved player cards for the team currently authenticated in Studio |
| `CompDashboard.teamAssets.list()` | `Asset[]` | Asset library for the currently authenticated team |
| `CompDashboard.pages.getPublished(teamId)` | `object \| null` | Published page design for team A–E |

### Fixtures and results

A fixture has this shape:

```js
{
  matchId: 1,
  home: "Team A",
  homeScore: null,
  away: "Team B",
  awayScore: null,
  stage: "REGULAR",
  referee: ""
}
```

- `home` and `away` are the official team labels stored with the result row.
- `homeScore` and `awayScore` are numbers when a score exists, otherwise `null`.
- `stage` is the competition stage, such as `REGULAR` or `FINAL`.
- `results.list()` filters out fixtures that do not have both scores.

### Teams

```js
{
  teamId: "A",
  displayName: "Team A",
  primaryColor: "#...",
  secondaryColor: "#...",
  logoUrl: "",
  updatedAt: null
}
```

Team IDs remain stable A–E even if display names change.

### Social posts

Published posts include fields such as:

```js
{
  postId: "...",
  teamId: "A",
  title: "Matchday update",
  body: "...",
  category: "Team news",
  publicationStatus: "Published",
  publishedAt: "...",
  featured: false
}
```

Only posts already marked as published are returned by the public feed endpoint.

### Schedule

```js
{
  matchId: 1,
  date: "2026-11-11",
  time: "13:35",
  venue: "Main field",
  status: "Scheduled"
}
```

The schedule endpoint deliberately returns only public fixture scheduling fields. It does not return reminder email addresses or other contact details.

### Polls

Poll counts are returned as an object keyed by match ID and team ID:

```js
{
  "1": { "A": 4, "B": 2 },
  "2": { "C": 3, "D": 5 }
}
```

### Assets

Competition assets include `id`, `name`, `category`, `url`, `thumbnailUrl` and `updatedAt`.

### Published team pages

Pass a team ID from A to E:

```js
const page = await CompDashboard.pages.getPublished("A");
if (page) {
  console.log(page.blocks);
}
```

The returned value is the saved page design object, or `null` if no page has been published.

### Standings

`standings.list()` runs the dashboard's own Glicko-based rating and ladder calculation in a same-origin, hidden dashboard data frame. It returns the same ranking and team statistics used by the main dashboard, rather than a separately invented win-percentage table. The first request can take a moment while the dashboard loads its official results.

### Team-only data

`players.list()` and `teamAssets.list()` are available only when Code Studio was opened from an authenticated Team Editor session. They return data for that signed-in team only. They do not accept a team ID argument, so custom code cannot use them to inspect another team's private editor library.

## Example: render live Socials posts

```js
async function renderPosts() {
  const posts = await CompDashboard.posts.list();
  const container = document.querySelector("#posts");
  container.replaceChildren();

  for (const post of posts) {
    const article = document.createElement("article");
    const heading = document.createElement("h3");
    const body = document.createElement("p");

    heading.textContent = post.title;
    body.textContent = post.body;

    article.append(heading, body);
    container.append(article);
  }
}

renderPosts().catch(console.error);
```

Use `textContent` for user-generated titles and post bodies. Do not insert untrusted post content with `innerHTML`.

## Example: combine fixtures and schedule

```js
async function loadMatchday() {
  const [fixtures, schedule] = await Promise.all([
    CompDashboard.fixtures.list(),
    CompDashboard.schedule.list()
  ]);

  const scheduleById = new Map(
    schedule.map(entry => [entry.matchId, entry])
  );

  return fixtures.map(fixture => ({
    ...fixture,
    schedule: scheduleById.get(fixture.matchId) || null
  }));
}

loadMatchday().then(console.table).catch(console.error);
```

## Runtime and security model

- Custom JavaScript runs in the Code Studio preview's sandboxed iframe.
- The preview receives API responses through a narrow message bridge. It does not receive direct access to the Studio page or its session storage.
- The bridge accepts only the documented read methods above.
- The API does not expose admin tokens, score-editor codes, team-editor sessions, moderation sessions, reminder contacts or private moderation queues.
- The API is read-only. Custom code cannot submit scores, publish posts, change team settings, vote, upload assets or modify competition data.
- The API wrapper is exposed as a read-only `window.CompDashboard` object.
- The preview is not the published team page. The current public team-page renderer does not automatically execute arbitrary Code Studio JavaScript.
- Use `try/catch` around API calls. Network errors, unavailable deployments and invalid responses reject the Promise.
- Data is fetched when a method is called. Call it again when you need fresh data; the SDK does not maintain a long-lived cache.

## Deployment note

The new public `getMatchSchedule` Apps Script action is included in `apps-script/Code.gs`. It must be deployed as a new version of the existing Apps Script web app before `CompDashboard.schedule.list()` can return schedule data from the live service.

The other methods use existing public API actions.

## Current scope

This is the first read-only integration layer. It covers fixtures, results, teams, competition settings, published Socials posts, match schedules, poll counts, competition assets and published team-page designs.

It intentionally does not expose private administration data or write operations. Additional capabilities should be added as explicit, permission-checked API methods rather than giving arbitrary page code access to the dashboard's credentials or internal browser state.
