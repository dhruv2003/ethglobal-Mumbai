# Why Arkiv

## If this data sat in Postgres or any other database, what could people no longer do?

AI judging and betting only work if people can trust the scores. In Postgres, the scores would sit in a database we control. We could quietly change a score after people had bet on it, and nobody could tell.

| With Arkiv, people can | With Postgres |
|---|---|
| **Catch a changed score.** Every record is written read-only, and a correction is a new version, so the old one stays readable until it expires. | We could overwrite the old value and leave no trace. |
| **Read results without our server.** Anyone can query by project, score or judge, in the explorer or with the SDK. | They'd need an API from us, and it would stop when we do. |
| **Check who wrote a record.** Every record carries its owner, and our wallet is `0x429C0C8C8cDBf6b24D02075D808088983988B515`. | They'd have to take our word for it. |
| **Keep reading if our app goes down.** The app's data doesn't live on our server. | The data goes offline with the server. |

Arkiv doesn't stop us publishing a newer score. It makes the change visible, because the earlier version remains. We also don't rely on the app's copy for trust: anyone can compare what a page shows with the record on Arkiv.

Records also expire on their own. Ours last 120 days, which covers an event and its follow-up without a cleanup job. The catch is in [data-quality.md](data-quality.md).

## What can people do with your copy on Arkiv that they can't do with the original source?

Most of this data doesn't exist anywhere else, because FightClub creates it. The original source is what each team provides: its submission, GitHub repo, demo video and live app.

| The original source | Our copy on Arkiv |
|---|---|
| A repo and a pitch make claims | An evidence report that checks those claims against the code, with a count of contradicted claims you can filter on |
| A demo video shows the best path | A record of a live test on laptop and phone, with results you can filter on |
| A repo can change after judging | The reviewed commit is recorded, so you can see exactly what was judged |
| A project page can't be searched by quality | "Every project scoring 50 or more" is one query across all projects |
| Judges' opinions usually stay private | Each judge's score is public, with a readable reason |
| Nothing connects a project to its results | Each project's submission, review and fights can be read through its project ID |

## How we use it

- **Database:** every record is a gzip JSON document on Arkiv, stored as a new version on each change. Nothing is kept on our server's disk.
- **Public view:** typed records add columns people can filter on, such as `panelScore`, `judgeId` and `contradicted`.
- **Files:** large files go to 0G Storage. Arkiv keeps their index.
- **Betting:** money and match results are on Base Sepolia contracts, while Arkiv holds the reasoning behind each score.

## What's public, and what isn't

Everything on Arkiv is public, so this matters.

| Item | Where | Why |
|---|---|---|
| API keys and private keys | Server settings only, never on Arkiv | A spot check of our stored records found none |
| Repository clones | Temporary server folder | Large, untrusted code |
| Large files | 0G Storage | Arkiv holds 128 KiB per entity |
| **Wallet signatures on submissions** | **Public, inside the stored submission records** | The app hides them, but anyone reading Arkiv directly can see them. A signature proves a wallet approved that submission. It can't move funds, and the app rejects a reused signature. |

Our spot check read up to 4 records from each collection, except files and pipelines. We plan to stop storing signatures in public records.
