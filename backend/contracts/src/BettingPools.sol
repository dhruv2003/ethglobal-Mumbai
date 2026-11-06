// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts@5.0.2/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts@5.0.2/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts@5.0.2/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts@5.0.2/utils/cryptography/SignatureChecker.sol";
import {Pausable} from "@openzeppelin/contracts@5.0.2/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts@5.0.2/utils/ReentrancyGuard.sol";
import {TournamentManager} from "./TournamentManager.sol";

/// @title BettingPools
/// @notice Holds stakes and pays settled pools 70% to winning bettors, 20% to the winning
///         project and 10% to the platform. Void pools refund every stake.
/// @dev No function lets an admin move funds. Pausing only blocks new bets.
///      Bettors can stay gasless: they sign a bet, and a relayer submits it and pays the gas.
contract BettingPools is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 private constant BET_INTENT_TYPEHASH = keccak256(
        "BetIntent(address bettor,uint256 market,uint256 project,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    /// @notice A bet signed by the bettor. A relayer cannot change any of these fields.
    struct BetIntent {
        address bettor;
        uint256 market;
        uint256 project;
        uint256 amount;
        uint256 deadline;
    }

    /// @notice The bettor's signed token approval. Use deadline 0 if allowance is already set.
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    enum Outcome {
        Unsettled,
        Empty,
        Void,
        Resolved
    }

    enum PoolState {
        NOT_OPEN,
        OPEN,
        LOCKED,
        RESOLVED,
        VOID
    }

    struct Pool {
        uint256 total;
        uint256 selectionsStaked;
        uint256 winningStake;
        uint256 bettorBucket;
        uint256 projectBucket;
        uint256 platformBucket;
        uint256 claimedStake;
        uint256 paidToBettors;
        Outcome outcome;
        uint8 winner;
        bool projectPaid;
        bool platformPaid;
        bool dustSwept;
    }

    event BetPlaced(uint256 indexed market, address indexed bettor, uint256 indexed project, uint256 amount);
    event PoolSettled(uint256 indexed market, Outcome outcome, uint8 winner);
    event Claimed(uint256 indexed market, address indexed bettor, uint256 amount);
    event Refunded(uint256 indexed market, address indexed bettor, uint256 amount);
    event ProjectPaid(uint256 indexed market, address indexed wallet, uint256 amount);
    event PlatformPaid(uint256 indexed market, address indexed wallet, uint256 amount);
    event DustSwept(uint256 indexed market, address indexed wallet, uint256 amount);

    error MarketNotOpen();
    error BettingClosed();
    error InvalidSelection();
    error WalletBlocked();
    error StakeBelowMinimum();
    error StakeAboveMaximum();
    error AlreadySettled();
    error NotReady();
    error WrongOutcome();
    error NothingToPay();
    error AlreadyPaid();
    error ClaimsOutstanding();
    error IntentExpired();
    error InvalidSignature();

    TournamentManager public immutable manager;
    IERC20 public immutable token;

    mapping(uint256 => Pool) private _pools;

    /// @notice market => project => total stake on that project.
    mapping(uint256 => mapping(uint256 => uint256)) public selectionStake;
    /// @notice market => project => wallet => stake.
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public stakes;
    /// @notice market => wallet => stake across all selections.
    mapping(uint256 => mapping(address => uint256)) public walletTotal;
    /// @notice market => wallet => claim or refund already taken.
    mapping(uint256 => mapping(address => bool)) public paidOut;
    /// @notice wallet => next nonce for a signed bet. Stops a signed bet being used twice.
    mapping(address => uint256) public betNonces;

    constructor(TournamentManager manager_, IERC20 token_) EIP712("BettingPools", "1") {
        manager = manager_;
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Betting
    // ---------------------------------------------------------------------

    /// @notice Stakes on a project. Needs a token approval first.
    function bet(uint256 market, uint256 project, uint256 amount) external whenNotPaused nonReentrant {
        _placeBet(msg.sender, market, project, amount);
    }

    /// @notice Places a bet the bettor signed. Anyone can submit it and pays the gas.
    /// @dev Tokens always come from the bettor. A failed permit is ignored because someone may
    ///      have already submitted it; the transfer still fails if there is no allowance.
    function betFor(
        BetIntent calldata intent,
        bytes calldata signature,
        PermitData calldata permit
    ) external whenNotPaused nonReentrant {
        if (_now() >= intent.deadline) revert IntentExpired();
        if (!SignatureChecker.isValidSignatureNow(intent.bettor, hashBetIntent(intent), signature)) {
            revert InvalidSignature();
        }
        betNonces[intent.bettor] += 1;

        if (permit.deadline != 0) _tryPermit(intent.bettor, permit);

        _placeBet(intent.bettor, intent.market, intent.project, intent.amount);
    }

    /// @notice The EIP-712 digest a bettor signs, using their current nonce.
    function hashBetIntent(BetIntent calldata intent) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BET_INTENT_TYPEHASH,
                    intent.bettor,
                    intent.market,
                    intent.project,
                    intent.amount,
                    betNonces[intent.bettor],
                    intent.deadline
                )
            )
        );
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Fixes a pool's outcome once. Anyone can call this.
    function settle(uint256 market) external {
        Pool storage p = _pools[market];
        if (p.outcome != Outcome.Unsettled) revert AlreadySettled();

        TournamentManager.MarketView memory m = manager.getMarket(market);
        if (!m.exists) revert MarketNotOpen();

        Outcome outcome = _decideOutcome(market, p, m);
        p.outcome = outcome;

        if (outcome == Outcome.Resolved) {
            p.winner = m.winner;
            p.winningStake = selectionStake[market][m.winner];
            p.bettorBucket = (p.total * 70) / 100;
            p.projectBucket = (p.total * 20) / 100;
            p.platformBucket = p.total - p.bettorBucket - p.projectBucket;
        }

        emit PoolSettled(market, outcome, p.winner);
    }

    /// @notice Pays a winning bettor's share of the 70% bucket, once.
    function claim(uint256 market) external nonReentrant {
        _claim(market, msg.sender);
    }

    /// @notice Same as claim, but anyone can trigger it. Funds only go to the bettor.
    function claimFor(uint256 market, address bettor) external nonReentrant {
        _claim(market, bettor);
    }

    /// @notice Returns a wallet's full stake from a void pool, once.
    function refund(uint256 market) external nonReentrant {
        _refund(market, msg.sender);
    }

    /// @notice Same as refund, but anyone can trigger it. Funds only go to the bettor.
    function refundFor(uint256 market, address bettor) external nonReentrant {
        _refund(market, bettor);
    }

    /// @notice Pays the 20% bucket to the winner's frozen reward wallet. Anyone can call this.
    function claimProject(uint256 market) external nonReentrant {
        Pool storage p = _pools[market];
        if (p.outcome != Outcome.Resolved) revert WrongOutcome();
        if (p.projectPaid) revert AlreadyPaid();

        p.projectPaid = true;
        address wallet = manager.rewardWallet(market >> 8, p.winner);

        token.safeTransfer(wallet, p.projectBucket);
        emit ProjectPaid(market, wallet, p.projectBucket);
    }

    /// @notice Pays the 10% bucket to the frozen platform recipient. Anyone can call this.
    function claimPlatform(uint256 market) external nonReentrant {
        Pool storage p = _pools[market];
        if (p.outcome != Outcome.Resolved) revert WrongOutcome();
        if (p.platformPaid) revert AlreadyPaid();

        p.platformPaid = true;
        address wallet = manager.platformRecipient(market >> 8);

        token.safeTransfer(wallet, p.platformBucket);
        emit PlatformPaid(market, wallet, p.platformBucket);
    }

    /// @notice Sends leftover rounding dust to the platform once every winner has claimed.
    function sweepDust(uint256 market) external nonReentrant {
        Pool storage p = _pools[market];
        if (p.outcome != Outcome.Resolved) revert WrongOutcome();
        if (p.claimedStake != p.winningStake) revert ClaimsOutstanding();
        if (p.dustSwept) revert AlreadyPaid();

        uint256 dust = p.bettorBucket - p.paidToBettors;
        if (dust == 0) revert NothingToPay();

        p.dustSwept = true;
        address wallet = manager.platformRecipient(market >> 8);

        token.safeTransfer(wallet, dust);
        emit DustSwept(market, wallet, dust);
    }

    // ---------------------------------------------------------------------
    // Emergency
    // ---------------------------------------------------------------------

    /// @notice Stops new bets. Claims, refunds and settlement keep working.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getPool(uint256 market) external view returns (Pool memory) {
        return _pools[market];
    }

    function poolState(uint256 market) external view returns (PoolState) {
        Outcome outcome = _pools[market].outcome;
        if (outcome == Outcome.Resolved || outcome == Outcome.Empty) return PoolState.RESOLVED;
        if (outcome == Outcome.Void) return PoolState.VOID;

        TournamentManager.MarketView memory m = manager.getMarket(market);
        if (!m.exists) return PoolState.NOT_OPEN;
        return _now() < m.cutoff && !m.isVoid ? PoolState.OPEN : PoolState.LOCKED;
    }

    /// @notice Amount a wallet can claim now. Zero if nothing is claimable.
    function claimable(uint256 market, address wallet) external view returns (uint256) {
        Pool storage p = _pools[market];
        if (p.outcome != Outcome.Resolved || paidOut[market][wallet]) return 0;
        return (p.bettorBucket * stakes[market][p.winner][wallet]) / p.winningStake;
    }

    /// @notice Amount a wallet can get refunded now. Zero if nothing is refundable.
    function refundable(uint256 market, address wallet) external view returns (uint256) {
        if (_pools[market].outcome != Outcome.Void || paidOut[market][wallet]) return 0;
        return walletTotal[market][wallet];
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev Tests override this to control time.
    function _now() internal view virtual returns (uint256) {
        return block.timestamp;
    }

    function _tryPermit(address bettor, PermitData calldata permit) private {
        try IERC20Permit(address(token)).permit(
            bettor,
            address(this),
            permit.value,
            permit.deadline,
            permit.v,
            permit.r,
            permit.s
        ) {} catch {}
    }

    function _placeBet(address bettor, uint256 market, uint256 project, uint256 amount) private {
        TournamentManager.MarketView memory m = manager.getMarket(market);
        if (!m.exists || m.isVoid || m.hasWinner) revert MarketNotOpen();
        if (_now() >= m.cutoff) revert BettingClosed();
        if (!manager.isSelection(market, project)) revert InvalidSelection();
        if (manager.isBlocked(m.tournamentId, bettor)) revert WalletBlocked();

        (uint256 minBet, uint256 maxBet) = manager.betLimits(m.tournamentId);
        if (amount < minBet) revert StakeBelowMinimum();
        if (walletTotal[market][bettor] + amount > maxBet) revert StakeAboveMaximum();

        Pool storage p = _pools[market];
        if (selectionStake[market][project] == 0) p.selectionsStaked += 1;
        p.total += amount;
        selectionStake[market][project] += amount;
        stakes[market][project][bettor] += amount;
        walletTotal[market][bettor] += amount;

        token.safeTransferFrom(bettor, address(this), amount);
        emit BetPlaced(market, bettor, project, amount);
    }

    function _claim(uint256 market, address bettor) private {
        Pool storage p = _pools[market];
        if (p.outcome != Outcome.Resolved) revert WrongOutcome();
        if (paidOut[market][bettor]) revert AlreadyPaid();

        uint256 stake = stakes[market][p.winner][bettor];
        if (stake == 0) revert NothingToPay();

        uint256 amount = (p.bettorBucket * stake) / p.winningStake;
        paidOut[market][bettor] = true;
        p.claimedStake += stake;
        p.paidToBettors += amount;

        token.safeTransfer(bettor, amount);
        emit Claimed(market, bettor, amount);
    }

    function _refund(uint256 market, address bettor) private {
        if (_pools[market].outcome != Outcome.Void) revert WrongOutcome();
        if (paidOut[market][bettor]) revert AlreadyPaid();

        uint256 amount = walletTotal[market][bettor];
        if (amount == 0) revert NothingToPay();

        paidOut[market][bettor] = true;

        token.safeTransfer(bettor, amount);
        emit Refunded(market, bettor, amount);
    }

    function _decideOutcome(
        uint256 market,
        Pool storage p,
        TournamentManager.MarketView memory m
    ) private view returns (Outcome) {
        if (m.hasWinner) {
            if (p.total == 0) return Outcome.Empty;
            if (p.selectionsStaked == 1 || selectionStake[market][m.winner] == 0) return Outcome.Void;
            return Outcome.Resolved;
        }

        uint256 currentTime = _now();
        if (m.isVoid || currentTime >= m.deadline) {
            return p.total == 0 ? Outcome.Empty : Outcome.Void;
        }

        if (currentTime >= m.cutoff) {
            if (p.total == 0) return Outcome.Empty;
            if (p.selectionsStaked == 1) return Outcome.Void;
        }

        revert NotReady();
    }
}
