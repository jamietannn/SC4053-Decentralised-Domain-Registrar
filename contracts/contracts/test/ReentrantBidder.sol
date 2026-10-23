// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface INtuNames {
    function commitBid(uint256 auctionId, bytes32 commitment) external payable;
    function revealBid(uint256 auctionId, string calldata domain, uint256 bid, bytes32 salt) external;
    function withdrawDeposit(uint256 auctionId) external;
}

/// @dev Test-only bidder that tries to re-enter withdrawDeposit when it receives its refund.
contract ReentrantBidder {
    INtuNames public immutable registrar;
    uint256 public auctionId;
    bool public reentryAttempted;
    bool public reentryFailed;

    constructor(INtuNames registrar_) {
        registrar = registrar_;
    }

    function commit(uint256 auctionId_, bytes32 commitment) external payable {
        auctionId = auctionId_;
        registrar.commitBid{value: msg.value}(auctionId_, commitment);
    }

    function reveal(string calldata domain, uint256 bid, bytes32 salt) external {
        registrar.revealBid(auctionId, domain, bid, salt);
    }

    function withdraw() external {
        registrar.withdrawDeposit(auctionId);
    }

    receive() external payable {
        if (!reentryAttempted) {
            reentryAttempted = true;
            try registrar.withdrawDeposit(auctionId) {} catch { reentryFailed = true; }
        }
    }
}
