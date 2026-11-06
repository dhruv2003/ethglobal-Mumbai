# Reach

## Who is it for?

- **Hackathon organizers and sponsors.** They get a published, read-only scorecard for every project, which they can link to or query instead of a spreadsheet.
- **Builders.** Every team gets three written judge reviews and a live test of their app on laptop and phone, with a record of the result anyone can check.
- **Spectators and bettors** (PRD §10). They can confirm the score behind a result on Arkiv before trusting it.

## Would they use it?

Judging at hackathons is hard to follow: teams rarely see why they placed where they did. Battle Arena gives every project:
- a dossier with every claim checked against the code
- a recorded live test
- three judges' scores with comments

Publishing the scores on Arkiv is what lets people outside our server trust them.

## Can they try it today?

- **Run it locally:** follow [backend/README.md](../backend/README.md), set the Arkiv variables in `backend/.env` (see [schema.md](schema.md)), then `npm run arkiv -- publish --project go-health-me`. The sample project's page shows the "Published on Arkiv" block.
- **Read without running anything:** paste the query from the root [README](../README.md#arkiv) into the Rabdi explorer at https://rabdi.explorer.arkiv.network/entity-explorer.
- **TODO (team):** the public URL of the deployed app, if there is one.

## Will we keep building after Mumbai?

**TODO (team): answer this yourselves.** Name the next milestone you'll really ship (for example, the match engine from PRD §8, whose round scores would also be published to Arkiv) and how you'll measure use.
