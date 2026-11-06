// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "remix_tests.sol";
import {TournamentManager} from "../src/TournamentManager.sol";
import {Actor, TestableManager} from "./TestHelpers.sol";

contract TournamentManagerTest {
    uint256 private constant START_TIME = 1_000_000;
    bytes32 private constant HASH = bytes32("result");

    TestableManager private manager;
    Actor private reviewer;
    Actor private stranger;

    function setup1Manager() public {
        manager = new TestableManager();
        manager.setTime(START_TIME);
        manager.grantRole(manager.ORGANIZER_ROLE(), address(this));
        manager.grantRole(manager.PUBLISHER_ROLE(), address(this));
    }

    function setup2Actors() public {
        reviewer = new Actor();
        stranger = new Actor();
    }

    // ---------------------------------------------------------------------
    // Setup rules
    // ---------------------------------------------------------------------

    function rejectsUnsupportedCapacity() public {
        TournamentManager.TournamentConfig memory config = _config(4);
        config.capacity = 6;
        Assert.ok(!_tryCreate(config), "capacity 6 must revert");
    }

    function rejectsShortDeadline() public {
        TournamentManager.TournamentConfig memory config = _config(4);
        config.resolutionDeadline = config.scheduledStart + 3 days - 1;
        Assert.ok(!_tryCreate(config), "deadline under (rounds + 1) x 24h must revert");
    }

    function rejectsUnapprovedPublisher() public {
        TournamentManager.TournamentConfig memory config = _config(4);
        config.publisher = address(stranger);
        Assert.ok(!_tryCreate(config), "publisher without the role must revert");
    }

    function rejectsWrongProjectCount() public {
        uint256 id = manager.createTournament(_config(8));
        TournamentManager.Project[] memory projects = _projects(6);
        (bool ok, ) = address(manager).call(
            abi.encodeCall(TournamentManager.freeze, (id, projects, bytes32("seed"), bytes32("bracket")))
        );
        Assert.ok(!ok, "6 projects must revert");
    }

    function blocksParticipantsFromBetting() public {
        uint256 id = _newTournament(4);
        Assert.ok(manager.isBlocked(id, address(this)), "organizer must be blocked");
        Assert.ok(manager.isBlocked(id, address(reviewer)), "reviewer must be blocked");
        Assert.ok(manager.isBlocked(id, _owner(2)), "team owner must be blocked");
        Assert.ok(manager.isBlocked(id, _reward(2)), "reward wallet must be blocked");
        Assert.ok(!manager.isBlocked(id, address(stranger)), "spectator must not be blocked");
    }

    // ---------------------------------------------------------------------
    // Bracket
    // ---------------------------------------------------------------------

    function firstRoundUsesSeededPairs() public {
        uint256 id = _newTournament(8);
        _open(id, 3);
        TournamentManager.Match memory m = manager.getMatch(id, 3);
        Assert.equal(uint256(m.projectA), uint256(6), "match 3 side A must be project 6");
        Assert.equal(uint256(m.projectB), uint256(7), "match 3 side B must be project 7");
    }

    function laterRoundCannotOpenEarly() public {
        uint256 id = _newTournament(4);
        _open(id, 0);
        _lock(id, 0);
        _publish(id, 0, true);
        Assert.ok(!_tryOpen(id, 2), "final must not open before all of round one finalizes");
    }

    function laterRoundUsesWinners() public {
        uint256 id = _newTournament(4);
        _runMatch(id, 0, false);
        _runMatch(id, 1, true);
        _open(id, 2);
        TournamentManager.Match memory m = manager.getMatch(id, 2);
        Assert.equal(uint256(m.projectA), uint256(1), "final side A must be the first winner");
        Assert.equal(uint256(m.projectB), uint256(2), "final side B must be the second winner");
    }

    function fullSixteenProjectBracket() public {
        uint256 id = _newTournament(16);
        for (uint256 i = 0; i < 15; i++) {
            _runMatch(id, i, true);
        }
        TournamentManager.Tournament memory t = manager.getTournament(id);
        Assert.equal(uint256(t.status), uint256(TournamentManager.TournamentStatus.Completed), "must complete");
        Assert.equal(uint256(t.champion), uint256(0), "project 0 must be champion");
    }

    function rejectsMatchPastFinal() public {
        uint256 id = _newTournament(4);
        Assert.ok(!_tryOpen(id, 3), "4 projects have only matches 0 to 2");
    }

    // ---------------------------------------------------------------------
    // Results and ties
    // ---------------------------------------------------------------------

    function higherScoreWins() public {
        uint256 id = _newTournament(4);
        _open(id, 0);
        _lock(id, 0);
        manager.publishResult(id, 0, 7800, 8200, 0, 0, HASH);
        TournamentManager.Match memory m = manager.getMatch(id, 0);
        Assert.equal(uint256(m.winner), uint256(1), "higher score must win");
        Assert.equal(uint256(m.source), uint256(TournamentManager.WinSource.Score), "source must be Score");
    }

    function tiebreakDecidesFirstTie() public {
        uint256 id = _newTournament(4);
        _open(id, 0);
        _lock(id, 0);
        manager.publishResult(id, 0, 8000, 8000, 7000, 6000, HASH);
        TournamentManager.Match memory m = manager.getMatch(id, 0);
        Assert.equal(uint256(m.winner), uint256(0), "higher tie-break must win");
        Assert.equal(uint256(m.source), uint256(TournamentManager.WinSource.Tiebreak), "source must be Tiebreak");
        Assert.equal(uint256(m.scoreA), uint256(m.scoreB), "original tied scores must be kept");
    }

    function doubleTieNeedsHumanReview() public {
        uint256 id = _doubleTie();
        TournamentManager.Match memory m = manager.getMatch(id, 0);
        Assert.equal(uint256(m.status), uint256(TournamentManager.MatchStatus.HumanReview), "must enter review");
    }

    function onlyReviewerDecidesReview() public {
        uint256 id = _doubleTie();
        bytes memory call_ = abi.encodeCall(TournamentManager.resolveHumanReview, (id, 0, 1, bytes32("why")));
        Assert.ok(!stranger.exec(address(manager), call_), "stranger must not decide");
        Assert.ok(reviewer.exec(address(manager), call_), "reviewer must decide");
        TournamentManager.Match memory m = manager.getMatch(id, 0);
        Assert.equal(uint256(m.winner), uint256(1), "selected project must win");
        Assert.equal(uint256(m.source), uint256(TournamentManager.WinSource.Organizer), "source must be Organizer");
    }

    function reviewerMustPickParticipant() public {
        uint256 id = _doubleTie();
        bytes memory call_ = abi.encodeCall(TournamentManager.resolveHumanReview, (id, 0, 2, bytes32("why")));
        Assert.ok(!reviewer.exec(address(manager), call_), "non-participant must be rejected");
    }

    function reviewerCannotDecideNormalMatch() public {
        uint256 id = _newTournament(4);
        _open(id, 0);
        _lock(id, 0);
        bytes memory call_ = abi.encodeCall(TournamentManager.resolveHumanReview, (id, 0, 0, bytes32("why")));
        Assert.ok(!reviewer.exec(address(manager), call_), "reviewer must wait for a double tie");
    }

    function resultCanOnlyBeSetOnce() public {
        uint256 id = _newTournament(4);
        _open(id, 0);
        _lock(id, 0);
        _publish(id, 0, true);
        Assert.ok(!_tryPublish(id, 0, 1000, 9000, 0, 0), "second result must revert");
        Assert.equal(uint256(manager.getMatch(id, 0).winner), uint256(0), "winner must not change");
    }

    function rejectsResultBeforeCutoff() public {
        uint256 id = _newTournament(4);
        _open(id, 0);
        Assert.ok(!_tryPublish(id, 0, 9000, 1000, 0, 0), "result during betting must revert");
    }

    function rejectsResultAtDeadline() public {
        uint256 id = _newTournament(4);
        _open(id, 0);
        manager.setTime(manager.getMatch(id, 0).deadline);
        Assert.ok(!_tryPublish(id, 0, 9000, 1000, 0, 0), "result at the deadline must revert");
    }

    function rejectsScoreAboveMaximum() public {
        uint256 id = _newTournament(4);
        _open(id, 0);
        _lock(id, 0);
        Assert.ok(!_tryPublish(id, 0, 10001, 1000, 0, 0), "score above 100.00 must revert");
    }

    function rejectsTiebreakWithoutTie() public {
        uint256 id = _newTournament(4);
        _open(id, 0);
        _lock(id, 0);
        Assert.ok(!_tryPublish(id, 0, 9000, 1000, 500, 0), "tie-break without a tie must revert");
    }

    function onlyPublisherPublishes() public {
        uint256 id = _newTournament(4);
        _open(id, 0);
        _lock(id, 0);
        bytes memory call_ = abi.encodeCall(TournamentManager.publishResult, (id, 0, 9000, 1000, 0, 0, HASH));
        Assert.ok(!stranger.exec(address(manager), call_), "stranger must not publish");
    }

    // ---------------------------------------------------------------------
    // Cancellation and deadlines
    // ---------------------------------------------------------------------

    function cancelKeepsFinalizedMatches() public {
        uint256 id = _newTournament(4);
        _runMatch(id, 0, true);
        _open(id, 1);
        manager.cancelTournament(id, bytes32("reason"));

        TournamentManager.MarketView memory finished = manager.getMarket(manager.matchMarket(id, 0));
        Assert.ok(finished.hasWinner, "finalized match must keep its winner");
        Assert.ok(!finished.isVoid, "finalized match must not be void");

        TournamentManager.MarketView memory open = manager.getMarket(manager.matchMarket(id, 1));
        Assert.ok(open.isVoid, "unfinished match must be void");

        TournamentManager.MarketView memory overall = manager.getMarket(manager.tournamentMarket(id));
        Assert.ok(overall.isVoid, "tournament pool must be void");
    }

    function completedTournamentCannotCancel() public {
        uint256 id = _newTournament(4);
        _runMatch(id, 0, true);
        _runMatch(id, 1, true);
        _runMatch(id, 2, true);
        (bool ok, ) = address(manager).call(
            abi.encodeCall(TournamentManager.cancelTournament, (id, bytes32("reason")))
        );
        Assert.ok(!ok, "completed tournament must not cancel");
    }

    function anyoneExpiresOverdueMatch() public {
        uint256 id = _doubleTie();
        bytes memory call_ = abi.encodeCall(TournamentManager.expireMatch, (id, 0));
        Assert.ok(!stranger.exec(address(manager), call_), "must not expire before the deadline");

        manager.setTime(manager.getMatch(id, 0).deadline);
        Assert.ok(stranger.exec(address(manager), call_), "anyone must expire after the deadline");

        Assert.equal(uint256(manager.getMatch(id, 0).status), uint256(TournamentManager.MatchStatus.Void), "match must be void");
        Assert.equal(uint256(manager.getTournament(id).status), uint256(TournamentManager.TournamentStatus.Canceled), "tournament must cancel");
    }

    function reviewerCannotDecideAfterDeadline() public {
        uint256 id = _doubleTie();
        manager.setTime(manager.getMatch(id, 0).deadline);
        bytes memory call_ = abi.encodeCall(TournamentManager.resolveHumanReview, (id, 0, 0, bytes32("why")));
        Assert.ok(!reviewer.exec(address(manager), call_), "late decision must be rejected");
    }

    function anyoneExpiresOverdueTournament() public {
        uint256 id = _newTournament(4);
        bytes memory call_ = abi.encodeCall(TournamentManager.expireTournament, (id));
        Assert.ok(!stranger.exec(address(manager), call_), "must not expire before the deadline");

        manager.setTime(manager.getTournament(id).resolutionDeadline);
        Assert.ok(stranger.exec(address(manager), call_), "anyone must expire after the deadline");
        Assert.equal(uint256(manager.getTournament(id).status), uint256(TournamentManager.TournamentStatus.Canceled), "tournament must cancel");
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _owner(uint256 project) private pure returns (address) {
        return address(uint160(0x1000 + project));
    }

    function _reward(uint256 project) private pure returns (address) {
        return address(uint160(0x2000 + project));
    }

    function _config(uint8 capacity) private view returns (TournamentManager.TournamentConfig memory config) {
        uint64 current = uint64(manager.time());
        uint64 rounds = capacity == 16 ? 4 : capacity == 8 ? 3 : 2;
        config.configHash = bytes32("config");
        config.capacity = capacity;
        config.bettingCutoff = current + 100;
        config.scheduledStart = current + 200;
        config.resolutionDeadline = current + 200 + (rounds + 1) * 1 days;
        config.reviewer = address(reviewer);
        config.publisher = address(this);
        config.platformRecipient = address(0xFEE);
        config.minBet = 1e18;
        config.maxBet = 1000e18;
    }

    function _projects(uint256 count) private pure returns (TournamentManager.Project[] memory projects) {
        projects = new TournamentManager.Project[](count);
        for (uint256 i = 0; i < count; i++) {
            projects[i] = TournamentManager.Project(_owner(i), _reward(i), bytes32(i + 1));
        }
    }

    function _newTournament(uint8 count) private returns (uint256 id) {
        id = manager.createTournament(_config(count));
        manager.freeze(id, _projects(count), bytes32("seed"), bytes32("bracket"));
    }

    function _tryCreate(TournamentManager.TournamentConfig memory config) private returns (bool ok) {
        (ok, ) = address(manager).call(abi.encodeCall(TournamentManager.createTournament, (config)));
    }

    function _matchTimes(uint256 id) private view returns (uint64 cutoff, uint64 start) {
        uint64 current = uint64(manager.time());
        uint64 scheduled = manager.getTournament(id).scheduledStart;
        cutoff = current + 10;
        start = current + 20 > scheduled ? current + 20 : scheduled;
    }

    function _open(uint256 id, uint256 matchIndex) private {
        (uint64 cutoff, uint64 start) = _matchTimes(id);
        manager.openMatch(id, matchIndex, cutoff, start);
    }

    function _tryOpen(uint256 id, uint256 matchIndex) private returns (bool ok) {
        (uint64 cutoff, uint64 start) = _matchTimes(id);
        (ok, ) = address(manager).call(abi.encodeCall(TournamentManager.openMatch, (id, matchIndex, cutoff, start)));
    }

    function _lock(uint256 id, uint256 matchIndex) private {
        uint256 matchCutoff = manager.getMatch(id, matchIndex).cutoff;
        uint256 poolCutoff = manager.getTournament(id).bettingCutoff;
        uint256 target = matchCutoff > poolCutoff ? matchCutoff : poolCutoff;
        if (target > manager.time()) manager.setTime(target);
    }

    function _publish(uint256 id, uint256 matchIndex, bool sideAWins) private {
        uint16 scoreA = sideAWins ? 9000 : 1000;
        uint16 scoreB = sideAWins ? 1000 : 9000;
        manager.publishResult(id, matchIndex, scoreA, scoreB, 0, 0, HASH);
    }

    function _tryPublish(
        uint256 id,
        uint256 matchIndex,
        uint16 scoreA,
        uint16 scoreB,
        uint16 tieA,
        uint16 tieB
    ) private returns (bool ok) {
        (ok, ) = address(manager).call(
            abi.encodeCall(TournamentManager.publishResult, (id, matchIndex, scoreA, scoreB, tieA, tieB, HASH))
        );
    }

    function _runMatch(uint256 id, uint256 matchIndex, bool sideAWins) private {
        _open(id, matchIndex);
        _lock(id, matchIndex);
        _publish(id, matchIndex, sideAWins);
    }

    function _doubleTie() private returns (uint256 id) {
        id = _newTournament(4);
        _open(id, 0);
        _lock(id, 0);
        manager.publishResult(id, 0, 8000, 8000, 7000, 7000, HASH);
    }
}
