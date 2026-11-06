// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "remix_tests.sol";
import {IERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/IERC20.sol";
import {BettingPools} from "../src/BettingPools.sol";
import {TournamentManager} from "../src/TournamentManager.sol";
import {Actor, MockERC20, SigningActor, TestableManager, TestablePools} from "./TestHelpers.sol";

contract BettingPoolsTest {
    uint256 private constant T = 1e18;
    address private constant PLATFORM = address(0xFEE);
    bytes32 private constant HASH = bytes32("result");

    MockERC20 private token;
    TestableManager private manager;
    TestablePools private pools;
    Actor private alice;
    Actor private bob;
    Actor private carol;
    Actor private reviewer;
    SigningActor private dana;

    function setup1Token() public {
        token = new MockERC20();
    }

    function setup2Manager() public {
        manager = new TestableManager();
        manager.setTime(1_000_000);
        manager.grantRole(manager.ORGANIZER_ROLE(), address(this));
        manager.grantRole(manager.PUBLISHER_ROLE(), address(this));
    }

    function setup3Pools() public {
        pools = new TestablePools(manager, token);
    }

    function setup4Actors() public {
        alice = _newBettor();
        bob = _newBettor();
        carol = _newBettor();
        reviewer = new Actor();
    }

    function setup5Signer() public {
        dana = new SigningActor();
        _approve(dana);
    }

    // ---------------------------------------------------------------------
    // Payout math
    // ---------------------------------------------------------------------

    /// AC-18 and AC-19: 1,000 pool, 400 on the winner, a 100 stake claims 175.
    function paysSeventyTwentyTen() public {
        (uint256 id, uint256 market) = _newMatchPool();
        uint256 startPlatform = token.balanceOf(PLATFORM);
        uint256 startReward = token.balanceOf(_reward(0));

        _bet(alice, market, 0, 100 * T);
        _bet(bob, market, 0, 300 * T);
        _bet(carol, market, 1, 600 * T);
        _finish(id, 0, true);
        pools.settle(market);

        BettingPools.Pool memory p = pools.getPool(market);
        Assert.equal(p.bettorBucket, 700 * T, "bettors share 700");
        Assert.equal(p.projectBucket, 200 * T, "project gets 200");
        Assert.equal(p.platformBucket, 100 * T, "platform gets 100");

        uint256 aliceStart = token.balanceOf(address(alice));
        Assert.ok(_exec(alice, abi.encodeCall(BettingPools.claim, (market))), "alice must claim");
        Assert.equal(token.balanceOf(address(alice)) - aliceStart, 175 * T, "alice claims 175, not 275");

        Assert.ok(_exec(bob, abi.encodeCall(BettingPools.claim, (market))), "bob must claim");
        pools.claimProject(market);
        pools.claimPlatform(market);

        Assert.equal(token.balanceOf(_reward(0)) - startReward, 200 * T, "reward wallet must receive 200");
        Assert.equal(token.balanceOf(PLATFORM) - startPlatform, 100 * T, "platform must receive 100");
        Assert.equal(_poolBalanceFor(market), uint256(0), "everything must be paid out");
    }

    /// BET-11: picking the winner can still return less than the stake.
    function correctPickCanLoseValue() public {
        (uint256 id, uint256 market) = _newMatchPool();
        _bet(alice, market, 0, 100 * T);
        _bet(bob, market, 0, 800 * T);
        _bet(carol, market, 1, 100 * T);
        _finish(id, 0, true);
        pools.settle(market);

        uint256 expected = (700 * T * 100 * T) / (900 * T);
        Assert.equal(pools.claimable(market, address(alice)), expected, "claim must follow the formula");
        Assert.lesserThan(expected, 100 * T, "claim must be below the stake");
    }

    function loserCannotClaim() public {
        (, uint256 market) = _settledTwoSided();
        Assert.ok(!_exec(carol, abi.encodeCall(BettingPools.claim, (market))), "losing bet must not claim");
    }

    // ---------------------------------------------------------------------
    // Betting rules
    // ---------------------------------------------------------------------

    /// AC-17: chain time decides the cutoff.
    function rejectsBetAtCutoff() public {
        (, uint256 market) = _newMatchPool();
        manager.setTime(manager.getMarket(market).cutoff);
        Assert.ok(!_tryBet(alice, market, 0, T), "bet at cutoff must revert");
    }

    function rejectsBelowMinimum() public {
        (, uint256 market) = _newMatchPool();
        Assert.ok(!_tryBet(alice, market, 0, T - 1), "bet below minimum must revert");
    }

    function capAppliesAcrossSelections() public {
        (, uint256 market) = _newMatchPool();
        _bet(alice, market, 0, 600 * T);
        Assert.ok(!_tryBet(alice, market, 1, 401 * T), "total above 1,000 must revert");
        Assert.ok(_tryBet(alice, market, 1, 400 * T), "total of exactly 1,000 must pass");
    }

    function rejectsProjectOutsideMatch() public {
        (, uint256 market) = _newMatchPool();
        Assert.ok(!_tryBet(alice, market, 2, T), "project 2 is not in match 0");
    }

    function rejectsMarketThatIsNotOpen() public {
        uint256 id = _newTournament();
        Assert.ok(!_tryBet(alice, manager.matchMarket(id, 0), 0, T), "unopened match must revert");
    }

    function rejectsBlockedWallet() public {
        (, uint256 market) = _newMatchPool();
        Assert.ok(!_tryBet(_bettorFrom(reviewer), market, 0, T), "reviewer must not bet");
    }

    function pauseBlocksBetsButNotClaims() public {
        (, uint256 market) = _settledTwoSided();
        (, uint256 openMarket) = _newMatchPool();

        pools.pause();
        Assert.ok(!_tryBet(alice, openMarket, 0, T), "paused bet must revert");
        Assert.ok(_exec(alice, abi.encodeCall(BettingPools.claim, (market))), "claim must work while paused");
        pools.unpause();
        Assert.ok(_tryBet(alice, openMarket, 0, T), "bet must work after unpause");
    }

    // ---------------------------------------------------------------------
    // Void paths
    // ---------------------------------------------------------------------

    /// AC-25: all stakes on one side void at lock, before any result.
    function oneSidedPoolVoidsAtLock() public {
        (, uint256 market) = _newMatchPool();
        _bet(alice, market, 0, 100 * T);
        _bet(bob, market, 0, 50 * T);
        manager.setTime(manager.getMarket(market).cutoff);

        pools.settle(market);
        Assert.equal(uint256(pools.poolState(market)), uint256(BettingPools.PoolState.VOID), "pool must be void");
        _assertRefund(alice, market, 100 * T);
        _assertRefund(bob, market, 50 * T);
    }

    /// AC-25: the same refund applies if the only backed side has already won.
    function oneSidedPoolVoidsEvenIfSideWins() public {
        (uint256 id, uint256 market) = _newMatchPool();
        _bet(alice, market, 0, 100 * T);
        _finish(id, 0, true);
        pools.settle(market);
        _assertRefund(alice, market, 100 * T);
    }

    /// AC-20: nobody backed the champion.
    function noStakeOnWinnerRefundsAll() public {
        uint256 id = _newTournament();
        uint256 market = manager.tournamentMarket(id);
        uint256 startPlatform = token.balanceOf(PLATFORM);
        uint256 startReward = token.balanceOf(_reward(2));

        _bet(alice, market, 0, 100 * T);
        _bet(bob, market, 1, 200 * T);
        _playToChampionTwo(id);

        pools.settle(market);
        _assertRefund(alice, market, 100 * T);
        _assertRefund(bob, market, 200 * T);
        Assert.equal(token.balanceOf(PLATFORM), startPlatform, "platform must get nothing");
        Assert.equal(token.balanceOf(_reward(2)), startReward, "project must get nothing");
    }

    /// AC-23: cancellation refunds unresolved pools and keeps settled claims valid.
    function cancelRefundsOnlyUnresolvedPools() public {
        uint256 id = _newTournament();
        uint256 overall = manager.tournamentMarket(id);
        _bet(alice, overall, 0, 10 * T);
        _bet(bob, overall, 1, 10 * T);

        _open(id, 0);
        uint256 first = manager.matchMarket(id, 0);
        _bet(alice, first, 0, 100 * T);
        _bet(carol, first, 1, 100 * T);
        _finish(id, 0, true);
        pools.settle(first);

        _open(id, 1);
        uint256 second = manager.matchMarket(id, 1);
        _bet(alice, second, 2, 30 * T);
        _bet(bob, second, 3, 40 * T);

        manager.cancelTournament(id, bytes32("reason"));

        Assert.equal(pools.claimable(first, address(alice)), 140 * T, "settled claim must remain");
        Assert.ok(_exec(alice, abi.encodeCall(BettingPools.claim, (first))), "settled claim must pay");

        pools.settle(overall);
        pools.settle(second);
        _assertRefund(alice, overall, 10 * T);
        _assertRefund(bob, overall, 10 * T);
        _assertRefund(alice, second, 30 * T);
        _assertRefund(bob, second, 40 * T);
    }

    /// AC-16 and AC-26: an abandoned tournament still refunds with no backend.
    function deadlineRefundsWithoutBackend() public {
        uint256 id = _newTournament();
        uint256 overall = manager.tournamentMarket(id);
        _bet(alice, overall, 0, 10 * T);
        _bet(bob, overall, 1, 20 * T);

        _open(id, 0);
        uint256 matchPool = manager.matchMarket(id, 0);
        _bet(alice, matchPool, 0, 5 * T);
        _bet(bob, matchPool, 1, 6 * T);

        Assert.ok(!_exec(carol, abi.encodeCall(BettingPools.settle, (overall))), "must not settle before the deadline");

        manager.setTime(manager.getMarket(matchPool).deadline);
        Assert.ok(_exec(carol, abi.encodeCall(BettingPools.settle, (matchPool))), "anyone must settle after the match deadline");
        _assertRefund(alice, matchPool, 5 * T);

        manager.setTime(manager.getMarket(overall).deadline);
        Assert.ok(_exec(carol, abi.encodeCall(BettingPools.settle, (overall))), "anyone must settle after the tournament deadline");
        _assertRefund(bob, overall, 20 * T);
    }

    function humanReviewHoldsSettlement() public {
        (uint256 id, uint256 market) = _newMatchPool();
        _bet(alice, market, 0, 100 * T);
        _bet(bob, market, 1, 100 * T);
        _lock(id, 0);
        manager.publishResult(id, 0, 8000, 8000, 7000, 7000, HASH);

        Assert.ok(!_exec(carol, abi.encodeCall(BettingPools.settle, (market))), "pool must wait for the reviewer");

        bytes memory decision = abi.encodeCall(TournamentManager.resolveHumanReview, (id, 0, 1, bytes32("why")));
        Assert.ok(reviewer.exec(address(manager), decision), "reviewer must decide");

        pools.settle(market);
        Assert.equal(pools.claimable(market, address(bob)), 140 * T, "selected winner's bettor must get paid");
    }

    function emptyPoolMovesNothing() public {
        (uint256 id, uint256 market) = _newMatchPool();
        _finish(id, 0, true);
        pools.settle(market);
        BettingPools.Pool memory p = pools.getPool(market);
        Assert.equal(uint256(p.outcome), uint256(BettingPools.Outcome.Empty), "pool must be empty");
        Assert.ok(!_exec(alice, abi.encodeCall(BettingPools.refund, (market))), "nothing to refund");
    }

    // ---------------------------------------------------------------------
    // Exactly once
    // ---------------------------------------------------------------------

    /// AC-21: repeated calls create no extra payment.
    function paysOnlyOnce() public {
        (, uint256 market) = _settledTwoSided();

        (bool ok, ) = address(pools).call(abi.encodeCall(BettingPools.settle, (market)));
        Assert.ok(!ok, "second settle must revert");

        Assert.ok(_exec(alice, abi.encodeCall(BettingPools.claim, (market))), "first claim must pay");
        Assert.ok(!_exec(alice, abi.encodeCall(BettingPools.claim, (market))), "second claim must revert");

        pools.claimProject(market);
        (ok, ) = address(pools).call(abi.encodeCall(BettingPools.claimProject, (market)));
        Assert.ok(!ok, "second project payment must revert");

        pools.claimPlatform(market);
        (ok, ) = address(pools).call(abi.encodeCall(BettingPools.claimPlatform, (market)));
        Assert.ok(!ok, "second platform payment must revert");
    }

    function refundsOnlyOnce() public {
        (, uint256 market) = _newMatchPool();
        _bet(alice, market, 0, 100 * T);
        manager.setTime(manager.getMarket(market).cutoff);
        pools.settle(market);
        _assertRefund(alice, market, 100 * T);
        Assert.ok(!_exec(alice, abi.encodeCall(BettingPools.refund, (market))), "second refund must revert");
    }

    /// AC-22: a failed transfer leaves the entitlement claimable.
    function failedTransferKeepsEntitlement() public {
        (, uint256 market) = _settledTwoSided();
        uint256 owed = pools.claimable(market, address(alice));

        token.setFailTransfers(true);
        bool failed = !_exec(alice, abi.encodeCall(BettingPools.claim, (market)));
        token.setFailTransfers(false);

        Assert.ok(failed, "claim must revert while transfers fail");
        Assert.equal(pools.claimable(market, address(alice)), owed, "entitlement must remain");
        Assert.ok(_exec(alice, abi.encodeCall(BettingPools.claim, (market))), "claim must work afterwards");
    }

    /// AC-24: dust is sweepable only after every winner claimed.
    function dustOnlyAfterAllClaims() public {
        (uint256 id, uint256 market) = _newMatchPool();
        _bet(alice, market, 0, 1 * T);
        _bet(bob, market, 0, 2 * T);
        _bet(carol, market, 1, 1 * T);
        _finish(id, 0, true);
        pools.settle(market);

        (bool ok, ) = address(pools).call(abi.encodeCall(BettingPools.sweepDust, (market)));
        Assert.ok(!ok, "sweep before claims must revert");

        Assert.ok(_exec(alice, abi.encodeCall(BettingPools.claim, (market))), "alice must claim");
        (ok, ) = address(pools).call(abi.encodeCall(BettingPools.sweepDust, (market)));
        Assert.ok(!ok, "sweep with claims outstanding must revert");

        Assert.ok(_exec(bob, abi.encodeCall(BettingPools.claim, (market))), "bob must claim");
        pools.claimProject(market);
        pools.claimPlatform(market);

        (ok, ) = address(pools).call(abi.encodeCall(BettingPools.sweepDust, (market)));
        Assert.ok(ok, "sweep after all claims must succeed");
        Assert.equal(_poolBalanceFor(market), uint256(0), "pool must end at zero");
    }

    // ---------------------------------------------------------------------
    // Accounting
    // ---------------------------------------------------------------------

    /// SEC-07: awkward amounts across a tournament pool never overpay.
    function awkwardAmountsAddUpExactly() public {
        uint256 id = _newTournament();
        uint256 market = manager.tournamentMarket(id);

        uint256 aliceStake = 1 * T + 1;
        uint256 bobStake = 7 * T + 3;
        uint256 carolStake = 11 * T + 13;
        _bet(alice, market, 2, aliceStake);
        _bet(bob, market, 2, bobStake);
        _bet(carol, market, 0, carolStake);
        _playToChampionTwo(id);
        pools.settle(market);

        BettingPools.Pool memory p = pools.getPool(market);
        Assert.equal(p.bettorBucket + p.projectBucket + p.platformBucket, p.total, "buckets must equal the stake total");

        uint256 owedAlice = pools.claimable(market, address(alice));
        uint256 owedBob = pools.claimable(market, address(bob));
        Assert.ok(owedAlice + owedBob <= p.bettorBucket, "claims must not exceed the bettor bucket");

        Assert.ok(_exec(alice, abi.encodeCall(BettingPools.claim, (market))), "alice must claim");
        Assert.ok(_exec(bob, abi.encodeCall(BettingPools.claim, (market))), "bob must claim");
        pools.claimProject(market);
        pools.claimPlatform(market);

        uint256 dust = p.bettorBucket - owedAlice - owedBob;
        if (dust > 0) pools.sweepDust(market);
        Assert.equal(_poolBalanceFor(market), uint256(0), "pool must end at zero");
    }

    function reportsPoolStates() public {
        (uint256 id, uint256 market) = _newMatchPool();
        Assert.equal(uint256(pools.poolState(market)), uint256(BettingPools.PoolState.OPEN), "must be open");

        _bet(alice, market, 0, T);
        _bet(bob, market, 1, T);
        _lock(id, 0);
        Assert.equal(uint256(pools.poolState(market)), uint256(BettingPools.PoolState.LOCKED), "must be locked");

        _publish(id, 0, true);
        pools.settle(market);
        Assert.equal(uint256(pools.poolState(market)), uint256(BettingPools.PoolState.RESOLVED), "must be resolved");

        Assert.equal(uint256(pools.poolState(manager.matchMarket(id, 1))), uint256(BettingPools.PoolState.NOT_OPEN), "unopened must report not open");
    }

    // ---------------------------------------------------------------------
    // Gasless flow
    // ---------------------------------------------------------------------

    function relayerPlacesSignedBet() public {
        (, uint256 market) = _newMatchPool();
        BettingPools.BetIntent memory intent = _intent(market, 0, 50 * T);
        dana.approveDigest(pools.hashBetIntent(intent));
        token.mint(address(dana), 50 * T);

        uint256 relayerStart = token.balanceOf(address(alice));
        uint256 nonceStart = pools.betNonces(address(dana));
        Assert.ok(_relayBet(intent), "relayer must place the signed bet");

        Assert.equal(pools.stakes(market, 0, address(dana)), 50 * T, "stake must belong to the signer");
        Assert.equal(token.balanceOf(address(alice)), relayerStart, "relayer must not pay tokens");
        Assert.equal(pools.betNonces(address(dana)), nonceStart + 1, "nonce must advance");
    }

    function rejectsUnsignedBet() public {
        (, uint256 market) = _newMatchPool();
        token.mint(address(dana), T);
        Assert.ok(!_relayBet(_intent(market, 0, T)), "bet without a signature must revert");
    }

    function relayerCannotChangeSignedBet() public {
        (, uint256 market) = _newMatchPool();
        dana.approveDigest(pools.hashBetIntent(_intent(market, 0, T)));
        token.mint(address(dana), 10 * T);

        Assert.ok(!_relayBet(_intent(market, 1, T)), "changed project must revert");
        Assert.ok(!_relayBet(_intent(market, 0, 2 * T)), "changed amount must revert");
    }

    function signedBetWorksOnlyOnce() public {
        (, uint256 market) = _newMatchPool();
        BettingPools.BetIntent memory intent = _intent(market, 0, T);
        dana.approveDigest(pools.hashBetIntent(intent));
        token.mint(address(dana), 2 * T);

        Assert.ok(_relayBet(intent), "first use must pass");
        Assert.ok(!_relayBet(intent), "second use must revert");
    }

    function rejectsExpiredIntent() public {
        (, uint256 market) = _newMatchPool();
        BettingPools.BetIntent memory intent = _intent(market, 0, T);
        intent.deadline = manager.time();
        dana.approveDigest(pools.hashBetIntent(intent));
        token.mint(address(dana), T);
        Assert.ok(!_relayBet(intent), "expired intent must revert");
    }

    function signedBetFollowsBetRules() public {
        (, uint256 market) = _newMatchPool();
        BettingPools.BetIntent memory intent = _intent(market, 0, 1001 * T);
        dana.approveDigest(pools.hashBetIntent(intent));
        token.mint(address(dana), 1001 * T);
        Assert.ok(!_relayBet(intent), "signed bet above the maximum must revert");
    }

    function pauseBlocksSignedBets() public {
        (, uint256 market) = _newMatchPool();
        BettingPools.BetIntent memory intent = _intent(market, 0, T);
        dana.approveDigest(pools.hashBetIntent(intent));
        token.mint(address(dana), T);

        pools.pause();
        bool passedWhilePaused = _relayBet(intent);
        pools.unpause();
        Assert.ok(!passedWhilePaused, "signed bet while paused must revert");
    }

    function failedPermitDoesNotBlockBet() public {
        (, uint256 market) = _newMatchPool();
        BettingPools.BetIntent memory intent = _intent(market, 0, T);
        dana.approveDigest(pools.hashBetIntent(intent));
        token.mint(address(dana), T);

        BettingPools.PermitData memory badPermit;
        badPermit.deadline = 1;
        bytes memory signature = "";
        bool ok = alice.exec(address(pools), abi.encodeCall(BettingPools.betFor, (intent, signature, badPermit)));
        Assert.ok(ok, "bet must pass when allowance already exists");
    }

    function signedBetNeedsAllowance() public {
        (, uint256 market) = _newMatchPool();
        SigningActor noAllowance = new SigningActor();
        BettingPools.BetIntent memory intent = _intent(market, 0, T);
        intent.bettor = address(noAllowance);
        noAllowance.approveDigest(pools.hashBetIntent(intent));
        token.mint(address(noAllowance), T);

        Assert.ok(!_relayBet(intent), "bet without allowance or permit must revert");
        Assert.equal(pools.betNonces(address(noAllowance)), uint256(0), "failed bet must not use the nonce");
    }

    function relayerTriggersClaimForBettor() public {
        (, uint256 market) = _settledTwoSided();
        uint256 owed = pools.claimable(market, address(alice));
        uint256 aliceStart = token.balanceOf(address(alice));
        uint256 relayerStart = token.balanceOf(address(carol));

        bytes memory call_ = abi.encodeCall(BettingPools.claimFor, (market, address(alice)));
        Assert.ok(_exec(carol, call_), "anyone must trigger a claim");
        Assert.equal(token.balanceOf(address(alice)) - aliceStart, owed, "bettor must receive the claim");
        Assert.equal(token.balanceOf(address(carol)), relayerStart, "caller must receive nothing");
        Assert.ok(!_exec(carol, call_), "second claim must revert");
    }

    function relayerTriggersRefundForBettor() public {
        (, uint256 market) = _newMatchPool();
        _bet(alice, market, 0, 100 * T);
        manager.setTime(manager.getMarket(market).cutoff);
        pools.settle(market);

        uint256 aliceStart = token.balanceOf(address(alice));
        uint256 relayerStart = token.balanceOf(address(carol));

        bytes memory call_ = abi.encodeCall(BettingPools.refundFor, (market, address(alice)));
        Assert.ok(_exec(carol, call_), "anyone must trigger a refund");
        Assert.equal(token.balanceOf(address(alice)) - aliceStart, 100 * T, "bettor must receive the refund");
        Assert.equal(token.balanceOf(address(carol)), relayerStart, "caller must receive nothing");
        Assert.ok(!_exec(carol, call_), "second refund must revert");
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _intent(
        uint256 market,
        uint256 project,
        uint256 amount
    ) private view returns (BettingPools.BetIntent memory) {
        return BettingPools.BetIntent(address(dana), market, project, amount, manager.time() + 1000);
    }

    /// @dev Submits a signed bet from another wallet, with no permit.
    function _relayBet(BettingPools.BetIntent memory intent) private returns (bool) {
        BettingPools.PermitData memory noPermit;
        bytes memory signature = "";
        return alice.exec(address(pools), abi.encodeCall(BettingPools.betFor, (intent, signature, noPermit)));
    }

    /// @dev Balance owed to a market is tracked per market, so this reports what that market
    ///      still has reserved. All other markets' funds are excluded.
    function _poolBalanceFor(uint256 market) private view returns (uint256 reserved) {
        BettingPools.Pool memory p = pools.getPool(market);
        reserved = p.total - p.paidToBettors;
        if (p.projectPaid) reserved -= p.projectBucket;
        if (p.platformPaid) reserved -= p.platformBucket;
        if (p.dustSwept) reserved -= p.bettorBucket - p.paidToBettors;
    }

    function _reward(uint256 project) private pure returns (address) {
        return address(uint160(0x2000 + project));
    }

    function _newBettor() private returns (Actor actor) {
        actor = new Actor();
        _approve(actor);
    }

    function _bettorFrom(Actor actor) private returns (Actor) {
        _approve(actor);
        return actor;
    }

    function _approve(Actor actor) private {
        bytes memory call_ = abi.encodeCall(IERC20.approve, (address(pools), type(uint256).max));
        require(actor.exec(address(token), call_), "approve failed");
    }

    function _exec(Actor actor, bytes memory data) private returns (bool) {
        return actor.exec(address(pools), data);
    }

    function _tryBet(Actor actor, uint256 market, uint256 project, uint256 amount) private returns (bool) {
        token.mint(address(actor), amount);
        return _exec(actor, abi.encodeCall(BettingPools.bet, (market, project, amount)));
    }

    function _bet(Actor actor, uint256 market, uint256 project, uint256 amount) private {
        require(_tryBet(actor, market, project, amount), "bet failed");
    }

    function _assertRefund(Actor actor, uint256 market, uint256 amount) private {
        uint256 before = token.balanceOf(address(actor));
        Assert.ok(_exec(actor, abi.encodeCall(BettingPools.refund, (market))), "refund must succeed");
        Assert.equal(token.balanceOf(address(actor)) - before, amount, "refund must return the full stake");
    }

    function _newTournament() private returns (uint256 id) {
        uint64 current = uint64(manager.time());
        TournamentManager.TournamentConfig memory config;
        config.configHash = bytes32("config");
        config.capacity = 4;
        config.bettingCutoff = current + 100;
        config.scheduledStart = current + 200;
        config.resolutionDeadline = current + 200 + 3 days;
        config.reviewer = address(reviewer);
        config.publisher = address(this);
        config.platformRecipient = PLATFORM;
        config.minBet = T;
        config.maxBet = 1000 * T;
        id = manager.createTournament(config);

        TournamentManager.Project[] memory projects = new TournamentManager.Project[](4);
        for (uint256 i = 0; i < 4; i++) {
            projects[i] = TournamentManager.Project(address(uint160(0x1000 + i)), _reward(i), bytes32(i + 1));
        }
        manager.freeze(id, projects, bytes32("seed"), bytes32("bracket"));
    }

    function _open(uint256 id, uint256 matchIndex) private {
        uint64 current = uint64(manager.time());
        uint64 scheduled = manager.getTournament(id).scheduledStart;
        uint64 start = current + 20 > scheduled ? current + 20 : scheduled;
        manager.openMatch(id, matchIndex, current + 10, start);
    }

    function _newMatchPool() private returns (uint256 id, uint256 market) {
        id = _newTournament();
        _open(id, 0);
        market = manager.matchMarket(id, 0);
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

    function _finish(uint256 id, uint256 matchIndex, bool sideAWins) private {
        _lock(id, matchIndex);
        _publish(id, matchIndex, sideAWins);
    }

    /// @dev Round one: projects 0 and 2 win. Final: project 2 beats project 0.
    function _playToChampionTwo(uint256 id) private {
        _open(id, 0);
        _finish(id, 0, true);
        _open(id, 1);
        _finish(id, 1, true);
        _open(id, 2);
        _finish(id, 2, false);
    }

    /// @dev Alice 100 and Bob 100 on the winner, Carol 200 against. Returns a settled pool.
    function _settledTwoSided() private returns (uint256 id, uint256 market) {
        (id, market) = _newMatchPool();
        _bet(alice, market, 0, 100 * T);
        _bet(bob, market, 0, 100 * T);
        _bet(carol, market, 1, 200 * T);
        _finish(id, 0, true);
        pools.settle(market);
    }
}
