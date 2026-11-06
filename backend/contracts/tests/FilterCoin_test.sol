// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "remix_tests.sol";
import {ERC20Permit} from "@openzeppelin/contracts@5.0.2/token/ERC20/extensions/ERC20Permit.sol";
import {FilterCoin} from "../src/FilterCoin.sol";

/// @notice Tries to sell again while receiving ETH from a sale.
contract ReentrantSeller {
    FilterCoin private immutable _coin;
    bool public reentered;

    constructor(FilterCoin coin_) {
        _coin = coin_;
    }

    function attack() external payable {
        _coin.buy{value: msg.value}();
        _coin.sell(_coin.balanceOf(address(this)) / 2);
    }

    receive() external payable {
        try _coin.sell(_coin.RATE()) {
            reentered = true;
        } catch {}
    }
}

/// @notice Accepts FILTER but refuses ETH, so its sales must fail.
contract EthRefuser {
    FilterCoin private immutable _coin;

    constructor(FilterCoin coin_) {
        _coin = coin_;
    }

    function buy() external payable {
        _coin.buy{value: msg.value}();
    }

    function trySell(uint256 amount) external returns (bool ok) {
        (ok, ) = address(_coin).call(abi.encodeCall(FilterCoin.sell, (amount)));
    }
}

contract FilterCoinTest {
    FilterCoin private coin;

    receive() external payable {}

    function setup() public {
        coin = new FilterCoin();
    }

    function nameAndSymbol() public {
        Assert.equal(coin.name(), "FilterCoin", "wrong name");
        Assert.equal(coin.symbol(), "FILTER", "wrong symbol");
    }

    function supportsPermit() public {
        Assert.notEqual(coin.DOMAIN_SEPARATOR(), bytes32(0), "permit domain must exist");
        Assert.equal(coin.nonces(address(this)), uint256(0), "permit nonce must start at zero");
        (bool ok, ) = address(coin).call(
            abi.encodeCall(ERC20Permit.permit, (address(this), address(1), 1, 0, 27, bytes32(0), bytes32(0)))
        );
        Assert.ok(!ok, "expired permit must revert");
    }

    /// #value: 10000000000000
    function buyUsesFixedPrice() public payable {
        coin.buy{value: msg.value}();
        Assert.equal(coin.balanceOf(address(this)), uint256(1000e18), "0.00001 ETH must buy 1,000 FILTER");
        Assert.equal(address(coin).balance, uint256(1e13), "contract must hold the ETH");
        Assert.ok(coin.isFullyBacked(), "must be fully backed after a buy");
    }

    function sellReturnsEth() public {
        uint256 before = address(this).balance;
        coin.sell(400e18);
        Assert.equal(address(this).balance - before, uint256(4e12), "400 FILTER must return 0.000004 ETH");
        Assert.equal(coin.balanceOf(address(this)), uint256(600e18), "FILTER must be burned");
        Assert.equal(coin.totalSupply(), uint256(600e18), "supply must fall");
        Assert.ok(coin.isFullyBacked(), "must be fully backed after a sale");
    }

    function sellKeepsRemainder() public {
        uint256 rate = coin.RATE();
        uint256 before = coin.balanceOf(address(this));
        coin.sell(rate + 5);
        Assert.equal(before - coin.balanceOf(address(this)), rate, "only whole wei worth must burn");
        Assert.ok(coin.isFullyBacked(), "must stay fully backed");
    }

    function rejectsZeroBuy() public {
        (bool ok, ) = address(coin).call(abi.encodeCall(FilterCoin.buy, ()));
        Assert.ok(!ok, "zero-value buy must revert");
    }

    function rejectsTooSmallSale() public {
        (bool ok, ) = address(coin).call(abi.encodeCall(FilterCoin.sell, (coin.RATE() - 1)));
        Assert.ok(!ok, "sale worth less than 1 wei must revert");
    }

    function rejectsOversizedSale() public {
        uint256 tooMuch = coin.balanceOf(address(this)) + coin.RATE();
        (bool ok, ) = address(coin).call(abi.encodeCall(FilterCoin.sell, (tooMuch)));
        Assert.ok(!ok, "selling more than the balance must revert");
    }

    function rejectsPlainEth() public {
        (bool ok, ) = address(coin).call{value: 1}("");
        Assert.ok(!ok, "plain ETH transfer must revert");
    }

    /// #value: 10000000000000
    function blocksReentrantSell() public payable {
        ReentrantSeller attacker = new ReentrantSeller(coin);
        attacker.attack{value: msg.value}();
        Assert.ok(!attacker.reentered(), "reentrant sell must fail");
        Assert.ok(coin.isFullyBacked(), "must stay fully backed");
    }

    /// #value: 10000000000000
    function failedEthTransferKeepsFilter() public payable {
        EthRefuser refuser = new EthRefuser(coin);
        refuser.buy{value: msg.value}();
        uint256 balance = coin.balanceOf(address(refuser));
        Assert.ok(!refuser.trySell(balance), "sale must revert when ETH cannot be delivered");
        Assert.equal(coin.balanceOf(address(refuser)), balance, "seller must keep FILTER");
    }
}
