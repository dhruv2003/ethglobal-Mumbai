// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts@5.0.2/token/ERC20/extensions/ERC20Permit.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts@5.0.2/utils/ReentrancyGuard.sol";

/// @title FilterCoin
/// @notice Testnet betting token. It has no real-world value and trades only for test ETH.
/// @dev Fixed price: 0.00001 test ETH buys 1,000 FILTER. All ETH stays in this contract
///      until a holder sells back, and no admin can withdraw it. Supports permit, so
///      gasless betting can be tested on chains without the official USDT.
contract FilterCoin is ERC20Permit, ReentrancyGuard {
    /// @notice FILTER base units per wei.
    uint256 public constant RATE = 100_000_000;

    event Bought(address indexed buyer, uint256 ethPaid, uint256 filterMinted);
    event Sold(address indexed seller, uint256 filterBurned, uint256 ethPaid);

    error ZeroValue();
    error PayoutTooSmall();
    error EthTransferFailed();

    constructor() ERC20("FilterCoin", "FILTER") ERC20Permit("FilterCoin") {}

    /// @notice Buys FILTER at the fixed price with the ETH sent.
    function buy() external payable {
        if (msg.value == 0) revert ZeroValue();
        uint256 minted = msg.value * RATE;
        _mint(msg.sender, minted);
        emit Bought(msg.sender, msg.value, minted);
    }

    /// @notice Sells FILTER back at the fixed price.
    /// @dev Only the part of `amount` that converts to whole wei is burned.
    ///      The caller keeps any remainder.
    function sell(uint256 amount) external nonReentrant {
        uint256 payout = amount / RATE;
        if (payout == 0) revert PayoutTooSmall();

        uint256 burned = payout * RATE;
        _burn(msg.sender, burned);
        emit Sold(msg.sender, burned, payout);

        (bool ok, ) = msg.sender.call{value: payout}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice True when the ETH held covers every FILTER in existence.
    function isFullyBacked() external view returns (bool) {
        return address(this).balance * RATE >= totalSupply();
    }
}
