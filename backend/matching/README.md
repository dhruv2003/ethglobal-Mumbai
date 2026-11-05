# Matching

Decides who fights whom. In round one, the most similar projects fight each other. After that, similar projects are kept apart so they meet as late as possible.

Implements `PRD.md` ORG-05 (Seeding), version 1.3.

## Run the tests

Needs Node 18 or later. No dependencies to install.

```sh
npm test
```

## How it works

1. **Similarity.** Every pair of projects gets a whole-number score from -10000 to 10000:

   ```
   60% × cosine of dossier embeddings   (what the project does and for whom)
   20% × shared tracks                  (Jaccard)
   20% × shared tech                    (Jaccard: chains, languages, main frameworks)
   ```

   The average embedding is subtracted from every embedding before comparing. Embedding models put most texts close together, and this makes the real differences show.

2. **Round one.** The pairing with the highest total similarity across all fights. It is found exactly, not greedily, so no project is left with a bad leftover match. If two pairings have the same total, the one whose worst fight is better wins.

3. **Later rounds.** The round-one pairs are grouped so that the *least* similar groups sit next to each other, at every level of the bracket. A category with four projects gets one pair in each half, so it can still reach the final.

4. **Never paired in round one:** projects from the same team, a fork and its original, two forks of the same original, and any pair the organizer blocks.

5. **Audit.** Ties follow an order derived from the published seed. The result includes `inputHash` (covering the seed, embedding model, weights, embeddings, tags, and blocked pairs with their reasons) and `resultHash`. Anyone with the same inputs gets the same bracket.

## Using it

```js
import { buildBracket } from '@arena/matching';

const bracket = buildBracket({
  seed: 'published-seed',
  embeddingModel: 'provider/model@version', // required, published and hashed
  projects: [
    { id: 'p1', teamId: 't1', embedding: [/* numbers */], tracks: ['defi'], tech: ['solidity', 'evm'] },
    // 4, 8 or 16 projects
  ],
  // weights: { embedding: 60, tracks: 20, tech: 20 },
  // blockedPairs: [{ a: 'p3', b: 'p7', reason: 'Same founders entered twice' }], // reason is required and published
});

// Publish all of these with the bracket:
bracket.seed; bracket.embeddingModel; bracket.weights; bracket.blockedPairs; bracket.algorithmVersion;

bracket.slots;      // project IDs in bracket order: slots 0–1 meet in round one, winners of 0–3 in round two, ...
bracket.firstRound; // [{ match, a, b, similarity, parts: { cosine, tracks, tech } }] for a "why this matchup" panel
bracket.inputHash;  // publish with the bracket
bracket.resultHash;
```

## Rules for the caller

- **Embed the platform-generated dossier, never team-written text.** Use the intended user, problem, core journey, features and architecture (EVD-05). Otherwise teams can word their pitch to pick their opponent.
- **Embed once, after freeze, and store the vectors.** Embedding APIs can return slightly different numbers each call. Use the stored vectors, and record the model and version.
- **Build the bracket before betting opens and never rebuild it** (ORG-05).
- Tech tags should come from the frozen repository analysis, not from the submission form.

## Not covered here

- Calling the embedding model (provider not chosen yet, `PRD.md` 18.2).
- Keeping a project's fights in different tournaments from overlapping (18.2).
- Only round one is chosen directly. Later matchups depend on who wins.
