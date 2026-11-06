// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/IERC20.sol";
import {BettingPools} from "../src/BettingPools.sol";
import {TournamentManager} from "../src/TournamentManager.sol";

/// @notice Free-mint token for tests. Can be told to fail transfers.
contract MockERC20 is ERC20 {
    bool public failTransfers;

    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFailTransfers(bool value) external {
        failTransfers = value;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        require(!failTransfers, "transfer disabled");
        return super.transfer(to, value);
    }
}

/// @notice TournamentManager with a clock the tests can set.
contract TestableManager is TournamentManager {
    uint256 public time;

    function setTime(uint256 value) external {
        time = value;
    }

    function _now() internal view override returns (uint256) {
        return time;
    }
}

/// @notice BettingPools that reads its clock from TestableManager.
contract TestablePools is BettingPools {
    constructor(TournamentManager manager_, IERC20 token_) BettingPools(manager_, token_) {}

    function _now() internal view override returns (uint256) {
        return TestableManager(address(manager)).time();
    }
}

/// @notice A separate wallet for tests. Reports failure instead of reverting.
contract Actor {
    function exec(address target, bytes calldata data) external returns (bool ok) {
        (ok, ) = target.call(data);
    }
}

/// @notice A smart-account wallet for tests. Solidity tests cannot make normal wallet
///         signatures, so this wallet approves digests through ERC-1271 instead.
contract SigningActor is Actor {
    mapping(bytes32 => bool) private _approved;

    function approveDigest(bytes32 digest) external {
        _approved[digest] = true;
    }

    function isValidSignature(bytes32 digest, bytes memory) external view returns (bytes4) {
        return _approved[digest] ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
