# Reach

## How many people or projects already use or depend on this data?

FightClub is new, so these numbers are small. They come from live Arkiv data on 7 November 2026, and anyone can check them.

| What | Count |
|---|---|
| Projects on the live site | 4 |
| Project IDs with a published judging result | 11 (includes our own test runs) |
| Judging results (panels) | 19 |
| Judge scorecards | 52 |
| AI judges on the live panel | 3 |
| Tournament records | 3 |
| Fight records | 2 |
| Outside apps we know read this data | 0 |

**Who depends on it today:** the FightClub app does, completely. Arkiv is its database, so submissions, reviews, judges and tournaments all load from Arkiv when the server starts. Without Arkiv, the app has no data.

**What we can't claim:** we have no outside users or partners yet, and we don't track who queries the data. Anyone can read it without telling us, so we can't count those readers.

## Who would use your copy on Arkiv after Mumbai, and for what?

These are the people we built it for. None of them has committed yet.

| Who | What for |
|---|---|
| **Hackathon organizers and sponsors** | A public scorecard for every project, to link to or query instead of a spreadsheet |
| **Hackathon teams** | Showing a checkable score, three written reviews and a live test of their app, on their own site or to investors |
| **Bettors on FightClub** | Checking a fighter's score and evidence before betting on a match |
| **Other apps** | Building leaderboards or project directories from the data without asking us for an API |

**Why they'd want it:** teams rarely find out why they placed where they did. FightClub gives each project a code-checked evidence report, a recorded live test and three judges' scores with comments, in a form anyone can check.

## Try it now

- **Live app:** https://fightclub-seven.vercel.app
- **Without our app:** paste this into the [Rabdi explorer](https://rabdi.explorer.arkiv.network/entity-explorer):

```
arkiv.schema = str('battle-arena.panel') AND $owner = addr(0x429C0C8C8cDBf6b24D02075D808088983988B515) ORDER BY runAt:u64 DESC
```

Our data labels still say `battle-arena` because that was the product's earlier name. Changing them would cut the app off from its existing records.

## After Mumbai

**Team to fill in before submitting:**
- **Next milestone:** one thing we'll really ship, and how we'll measure use.
- **Real interest:** any organizer, sponsor or team who has said they'd use this. Leave it out if there's nobody yet.
