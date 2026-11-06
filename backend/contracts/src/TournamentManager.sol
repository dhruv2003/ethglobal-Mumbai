// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts@5.0.2/access/AccessControl.sol";

/// @title TournamentManager
/// @notice Holds tournament rules, the bracket, results and deadlines. It never holds tokens.
/// @dev The publisher submits scores and this contract derives the winner. Nobody can submit
///      a winner directly, except the reviewer after a double tie.
contract TournamentManager is AccessControl {
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    bytes32 public constant PUBLISHER_ROLE = keccak256("PUBLISHER_ROLE");

    /// @notice Highest allowed score, in hundredths (100.00).
    uint16 public constant MAX_SCORE = 10000;

    enum TournamentStatus {
        None,
        Configured,
        Frozen,
        Completed,
        Canceled
    }

    enum MatchStatus {
        None,
        Open,
        HumanReview,
        Finalized,
        Void
    }

    enum WinSource {
        None,
        Score,
        Tiebreak,
        Organizer
    }

    struct TournamentConfig {
        bytes32 configHash;
        uint8 capacity;
        uint64 scheduledStart;
        uint64 bettingCutoff;
        uint64 resolutionDeadline;
        address reviewer;
        address publisher;
        address platformRecipient;
        uint256 minBet;
        uint256 maxBet;
    }

    struct Project {
        address owner;
        address rewardWallet;
        bytes32 snapshotHash;
    }

    struct Tournament {
        bytes32 configHash;
        bytes32 seed;
        bytes32 bracketHash;
        address organizer;
        address reviewer;
        address publisher;
        address platformRecipient;
        uint256 minBet;
        uint256 maxBet;
        uint64 scheduledStart;
        uint64 bettingCutoff;
        uint64 resolutionDeadline;
        TournamentStatus status;
        uint8 capacity;
        uint8 projectCount;
        uint8 finalizedCount;
        uint8 champion;
    }

    struct Match {
        MatchStatus status;
        WinSource source;
        uint8 projectA;
        uint8 projectB;
        uint8 winner;
        uint16 scoreA;
        uint16 scoreB;
        uint16 tieA;
        uint16 tieB;
        uint64 cutoff;
        uint64 scheduledStart;
        uint64 deadline;
        bytes32 resultHash;
        bytes32 rationaleHash;
    }

    /// @notice What BettingPools needs to know about a market.
    struct MarketView {
        bool exists;
        bool hasWinner;
        bool isVoid;
        uint8 winner;
        uint64 cutoff;
        uint64 deadline;
        uint256 tournamentId;
    }

    event TournamentCreated(uint256 indexed id, address indexed organizer, bytes32 configHash);
    event TournamentFrozen(uint256 indexed id, uint8 projectCount, bytes32 seed, bytes32 bracketHash);
    event TournamentCompleted(uint256 indexed id, uint8 champion);
    event TournamentCanceled(uint256 indexed id, bytes32 reasonHash);
    event MatchOpened(uint256 indexed id, uint256 indexed matchIndex, uint8 projectA, uint8 projectB, uint64 cutoff, uint64 deadline);
    event MatchFinalized(uint256 indexed id, uint256 indexed matchIndex, uint8 winner, WinSource source, bytes32 resultHash);
    event HumanReviewRequired(uint256 indexed id, uint256 indexed matchIndex, bytes32 resultHash);
    event HumanReviewResolved(uint256 indexed id, uint256 indexed matchIndex, uint8 winner, bytes32 rationaleHash);
    event MatchVoided(uint256 indexed id, uint256 indexed matchIndex, bytes32 reasonHash);

    error InvalidCapacity();
    error InvalidSchedule();
    error DeadlineTooSoon();
    error InvalidAddress();
    error InvalidBetLimits();
    error PublisherNotApproved();
    error NotOrganizer();
    error NotPublisher();
    error NotReviewer();
    error WrongTournamentStatus();
    error InvalidProjectCount();
    error BettingClosed();
    error InvalidMatch();
    error WrongMatchStatus();
    error PreviousRoundUnfinished();
    error BettingStillOpen();
    error DeadlinePassed();
    error DeadlineNotReached();
    error InvalidScore();
    error UnexpectedTiebreak();
    error InvalidWinner();

    uint256 public tournamentCount;

    mapping(uint256 => Tournament) private _tournaments;
    mapping(uint256 => mapping(uint256 => Project)) private _projects;
    mapping(uint256 => mapping(uint256 => Match)) private _matches;
    mapping(uint256 => mapping(address => bool)) private _blocked;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------

    /// @notice Creates a tournament. The caller becomes its organizer.
    function createTournament(TournamentConfig calldata config) external onlyRole(ORGANIZER_ROLE) returns (uint256 id) {
        uint256 rounds = _roundsFor(config.capacity);
        if (config.bettingCutoff <= _now() || config.scheduledStart < config.bettingCutoff) revert InvalidSchedule();
        if (config.resolutionDeadline < config.scheduledStart + (rounds + 1) * 1 days) revert DeadlineTooSoon();
        if (config.reviewer == address(0) || config.platformRecipient == address(0)) revert InvalidAddress();
        if (!hasRole(PUBLISHER_ROLE, config.publisher)) revert PublisherNotApproved();
        if (config.minBet == 0 || config.minBet > config.maxBet) revert InvalidBetLimits();

        id = ++tournamentCount;
        Tournament storage t = _tournaments[id];
        t.configHash = config.configHash;
        t.organizer = msg.sender;
        t.reviewer = config.reviewer;
        t.publisher = config.publisher;
        t.platformRecipient = config.platformRecipient;
        t.minBet = config.minBet;
        t.maxBet = config.maxBet;
        t.scheduledStart = config.scheduledStart;
        t.bettingCutoff = config.bettingCutoff;
        t.resolutionDeadline = config.resolutionDeadline;
        t.capacity = config.capacity;
        t.status = TournamentStatus.Configured;

        _blocked[id][msg.sender] = true;
        _blocked[id][config.reviewer] = true;
        _blocked[id][config.publisher] = true;

        emit TournamentCreated(id, msg.sender, config.configHash);
    }

    /// @notice Stores the seeded projects, fixes reward wallets and opens the tournament pool.
    function freeze(uint256 id, Project[] calldata projects, bytes32 seed, bytes32 bracketHash) external {
        Tournament storage t = _tournaments[id];
        if (msg.sender != t.organizer) revert NotOrganizer();
        if (t.status != TournamentStatus.Configured) revert WrongTournamentStatus();
        if (_now() >= t.bettingCutoff) revert BettingClosed();

        uint256 count = projects.length;
        _roundsFor(count);
        if (count > t.capacity) revert InvalidProjectCount();

        for (uint256 i = 0; i < count; i++) {
            if (projects[i].owner == address(0) || projects[i].rewardWallet == address(0)) revert InvalidAddress();
            _projects[id][i] = projects[i];
            _blocked[id][projects[i].owner] = true;
            _blocked[id][projects[i].rewardWallet] = true;
        }

        t.seed = seed;
        t.bracketHash = bracketHash;
        t.projectCount = uint8(count);
        t.status = TournamentStatus.Frozen;

        emit TournamentFrozen(id, uint8(count), seed, bracketHash);
    }

    // ---------------------------------------------------------------------
    // Matches
    // ---------------------------------------------------------------------

    /// @notice Opens a match and its pool. Participants are derived from the bracket.
    function openMatch(uint256 id, uint256 matchIndex, uint64 cutoff, uint64 scheduledStart) external {
        Tournament storage t = _tournaments[id];
        if (msg.sender != t.publisher) revert NotPublisher();
        if (t.status != TournamentStatus.Frozen) revert WrongTournamentStatus();
        if (matchIndex + 1 >= t.projectCount) revert InvalidMatch();

        Match storage m = _matches[id][matchIndex];
        if (m.status != MatchStatus.None) revert WrongMatchStatus();
        if (
            cutoff <= _now() ||
            scheduledStart < cutoff ||
            scheduledStart < t.bettingCutoff ||
            scheduledStart >= t.resolutionDeadline
        ) revert InvalidSchedule();

        (uint8 projectA, uint8 projectB) = _participants(id, matchIndex, t.projectCount);

        uint64 deadline = scheduledStart + 1 days;
        if (deadline > t.resolutionDeadline) deadline = t.resolutionDeadline;

        m.status = MatchStatus.Open;
        m.projectA = projectA;
        m.projectB = projectB;
        m.cutoff = cutoff;
        m.scheduledStart = scheduledStart;
        m.deadline = deadline;

        emit MatchOpened(id, matchIndex, projectA, projectB, cutoff, deadline);
    }

    /// @notice Publishes scores in hundredths. The contract applies the tie rule.
    /// @dev Tie-break scores must be zero unless the main scores are equal.
    function publishResult(
        uint256 id,
        uint256 matchIndex,
        uint16 scoreA,
        uint16 scoreB,
        uint16 tieA,
        uint16 tieB,
        bytes32 resultHash
    ) external {
        Match storage m = _publishableMatch(id, matchIndex);
        WinSource source = _applyScores(m, scoreA, scoreB, tieA, tieB);
        m.resultHash = resultHash;

        if (source == WinSource.None) {
            m.status = MatchStatus.HumanReview;
            emit HumanReviewRequired(id, matchIndex, resultHash);
        } else {
            _finalize(id, matchIndex, source);
        }
    }

    /// @notice Decides a match that tied twice. Only the tournament reviewer can call this.
    function resolveHumanReview(uint256 id, uint256 matchIndex, uint8 winner, bytes32 rationaleHash) external {
        Tournament storage t = _tournaments[id];
        if (msg.sender != t.reviewer) revert NotReviewer();
        if (t.status != TournamentStatus.Frozen) revert WrongTournamentStatus();

        Match storage m = _matches[id][matchIndex];
        if (m.status != MatchStatus.HumanReview) revert WrongMatchStatus();
        if (_now() >= m.deadline) revert DeadlinePassed();
        if (winner != m.projectA && winner != m.projectB) revert InvalidWinner();

        m.winner = winner;
        m.rationaleHash = rationaleHash;

        emit HumanReviewResolved(id, matchIndex, winner, rationaleHash);
        _finalize(id, matchIndex, WinSource.Organizer);
    }

    /// @notice Voids an unrecoverable match, which also cancels the tournament.
    function voidMatch(uint256 id, uint256 matchIndex, bytes32 reasonHash) external {
        Tournament storage t = _tournaments[id];
        if (msg.sender != t.publisher) revert NotPublisher();
        _voidAndCancel(id, matchIndex, reasonHash);
    }

    /// @notice Cancels unfinished competition. Finalized matches keep their results.
    function cancelTournament(uint256 id, bytes32 reasonHash) external {
        Tournament storage t = _tournaments[id];
        if (msg.sender != t.organizer) revert NotOrganizer();
        if (t.status != TournamentStatus.Configured && t.status != TournamentStatus.Frozen) {
            revert WrongTournamentStatus();
        }
        _cancel(id, reasonHash);
    }

    /// @notice Anyone can void an unresolved match after its deadline.
    function expireMatch(uint256 id, uint256 matchIndex) external {
        if (_now() < _matches[id][matchIndex].deadline) revert DeadlineNotReached();
        _voidAndCancel(id, matchIndex, keccak256("MATCH_DEADLINE"));
    }

    /// @notice Anyone can cancel an unfinished tournament after its deadline.
    function expireTournament(uint256 id) external {
        Tournament storage t = _tournaments[id];
        if (t.status != TournamentStatus.Frozen) revert WrongTournamentStatus();
        if (_now() < t.resolutionDeadline) revert DeadlineNotReached();
        _cancel(id, keccak256("TOURNAMENT_DEADLINE"));
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getTournament(uint256 id) external view returns (Tournament memory) {
        return _tournaments[id];
    }

    function getProject(uint256 id, uint256 project) external view returns (Project memory) {
        return _projects[id][project];
    }

    function getMatch(uint256 id, uint256 matchIndex) external view returns (Match memory) {
        return _matches[id][matchIndex];
    }

    function isBlocked(uint256 id, address wallet) external view returns (bool) {
        return _blocked[id][wallet];
    }

    function betLimits(uint256 id) external view returns (uint256 minBet, uint256 maxBet) {
        Tournament storage t = _tournaments[id];
        return (t.minBet, t.maxBet);
    }

    function platformRecipient(uint256 id) external view returns (address) {
        return _tournaments[id].platformRecipient;
    }

    function rewardWallet(uint256 id, uint256 project) external view returns (address) {
        return _projects[id][project].rewardWallet;
    }

    /// @notice Market ID of a tournament's overall winner pool.
    function tournamentMarket(uint256 id) external pure returns (uint256) {
        return id << 8;
    }

    /// @notice Market ID of a match pool.
    function matchMarket(uint256 id, uint256 matchIndex) external pure returns (uint256) {
        return (id << 8) | (matchIndex + 1);
    }

    /// @notice Whether a project can be backed in a market.
    function isSelection(uint256 market, uint256 project) external view returns (bool) {
        uint256 id = market >> 8;
        uint256 slot = market & 0xff;
        if (slot == 0) return project < _tournaments[id].projectCount;

        Match storage m = _matches[id][slot - 1];
        if (m.status == MatchStatus.None) return false;
        return project == m.projectA || project == m.projectB;
    }

    /// @notice Current state of a market, as read by BettingPools.
    function getMarket(uint256 market) external view returns (MarketView memory v) {
        uint256 id = market >> 8;
        uint256 slot = market & 0xff;
        Tournament storage t = _tournaments[id];
        v.tournamentId = id;

        if (slot == 0) {
            if (t.projectCount == 0) return v;
            v.exists = true;
            v.cutoff = t.bettingCutoff;
            v.deadline = t.resolutionDeadline;
            v.hasWinner = t.status == TournamentStatus.Completed;
            v.winner = t.champion;
            v.isVoid = t.status == TournamentStatus.Canceled;
            return v;
        }

        Match storage m = _matches[id][slot - 1];
        if (m.status == MatchStatus.None) return v;
        v.exists = true;
        v.cutoff = m.cutoff;
        v.deadline = m.deadline;
        v.hasWinner = m.status == MatchStatus.Finalized;
        v.winner = m.winner;
        v.isVoid = m.status == MatchStatus.Void ||
            (t.status == TournamentStatus.Canceled && m.status != MatchStatus.Finalized);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev Tests override this to control time.
    function _now() internal view virtual returns (uint256) {
        return block.timestamp;
    }

    function _roundsFor(uint256 count) private pure returns (uint256) {
        if (count == 4) return 2;
        if (count == 8) return 3;
        if (count == 16) return 4;
        revert InvalidCapacity();
    }

    function _participants(
        uint256 id,
        uint256 matchIndex,
        uint256 count
    ) private view returns (uint8 projectA, uint8 projectB) {
        uint256 half = count / 2;
        if (matchIndex < half) return (uint8(matchIndex * 2), uint8(matchIndex * 2 + 1));

        uint256 roundStart = 0;
        uint256 roundSize = half;
        while (matchIndex >= roundStart + roundSize) {
            roundStart += roundSize;
            roundSize /= 2;
        }
        if (_tournaments[id].finalizedCount < roundStart) revert PreviousRoundUnfinished();

        uint256 feeder = (matchIndex - half) * 2;
        projectA = _matches[id][feeder].winner;
        projectB = _matches[id][feeder + 1].winner;
    }

    function _publishableMatch(uint256 id, uint256 matchIndex) private view returns (Match storage m) {
        Tournament storage t = _tournaments[id];
        if (msg.sender != t.publisher) revert NotPublisher();
        if (t.status != TournamentStatus.Frozen) revert WrongTournamentStatus();

        m = _matches[id][matchIndex];
        if (m.status != MatchStatus.Open) revert WrongMatchStatus();

        uint256 currentTime = _now();
        if (currentTime < m.cutoff || currentTime < t.bettingCutoff) revert BettingStillOpen();
        if (currentTime >= m.deadline) revert DeadlinePassed();
    }

    /// @dev Stores the scores and winner. Returns WinSource.None after a double tie.
    function _applyScores(
        Match storage m,
        uint16 scoreA,
        uint16 scoreB,
        uint16 tieA,
        uint16 tieB
    ) private returns (WinSource) {
        if (scoreA > MAX_SCORE || scoreB > MAX_SCORE || tieA > MAX_SCORE || tieB > MAX_SCORE) revert InvalidScore();

        m.scoreA = scoreA;
        m.scoreB = scoreB;
        m.tieA = tieA;
        m.tieB = tieB;

        if (scoreA != scoreB) {
            if (tieA != 0 || tieB != 0) revert UnexpectedTiebreak();
            m.winner = scoreA > scoreB ? m.projectA : m.projectB;
            return WinSource.Score;
        }
        if (tieA != tieB) {
            m.winner = tieA > tieB ? m.projectA : m.projectB;
            return WinSource.Tiebreak;
        }
        return WinSource.None;
    }

    function _finalize(uint256 id, uint256 matchIndex, WinSource source) private {
        Tournament storage t = _tournaments[id];
        Match storage m = _matches[id][matchIndex];

        m.status = MatchStatus.Finalized;
        m.source = source;
        t.finalizedCount += 1;

        emit MatchFinalized(id, matchIndex, m.winner, source, m.resultHash);

        if (matchIndex + 2 == t.projectCount) {
            t.champion = m.winner;
            t.status = TournamentStatus.Completed;
            emit TournamentCompleted(id, m.winner);
        }
    }

    function _voidAndCancel(uint256 id, uint256 matchIndex, bytes32 reasonHash) private {
        if (_tournaments[id].status != TournamentStatus.Frozen) revert WrongTournamentStatus();

        Match storage m = _matches[id][matchIndex];
        if (m.status != MatchStatus.Open && m.status != MatchStatus.HumanReview) revert WrongMatchStatus();

        m.status = MatchStatus.Void;
        emit MatchVoided(id, matchIndex, reasonHash);
        _cancel(id, reasonHash);
    }

    function _cancel(uint256 id, bytes32 reasonHash) private {
        _tournaments[id].status = TournamentStatus.Canceled;
        emit TournamentCanceled(id, reasonHash);
    }
}
