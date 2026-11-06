/* Words and colours for tournament and match states. */

export const PHASE_LABEL = {
  live: { tone: "live", word: "Live" },
  upcoming: { tone: "neutral", word: "Upcoming" },
  completed: { tone: "success", word: "Completed" },
  canceled: { tone: "danger", word: "Canceled" },
};

export const MATCH_LABEL = {
  scheduled: { tone: "neutral", word: "Scheduled" },
  live: { tone: "live", word: "Live" },
  review: { tone: "reward", word: "Awaiting organizer" },
  finalized: { tone: "success", word: "Finalized" },
  void: { tone: "danger", word: "Void" },
};
