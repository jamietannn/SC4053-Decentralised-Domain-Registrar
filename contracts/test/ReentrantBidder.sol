// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface INtu {
    function commitBid(uint256 id, bytes32 commitment) external payable;
    function revealBid(uint256 id, string calldata domain, uint256 bid, bytes32 salt) external;
    function withdrawDeposit(uint256 id) external;
}

/// @dev Test helper: tries to re-enter withdrawDeposit from its receive hook.
contract ReentrantBidder {
    INtu public immutable ntu;
    uint256 public id;
    uint256 public reentries;
    bool public reentryReverted;

    constructor(address ntu_) { ntu = INtu(ntu_); }

    function commit(uint256 id_, bytes32 commitment) external payable {
        id = id_;
        ntu.commitBid{value: msg.value}(id_, commitment);
    }

    function reveal(string calldata domain, uint256 bid, bytes32 salt) external {
        ntu.revealBid(id, domain, bid, salt);
    }

    function withdraw() external { ntu.withdrawDeposit(id); }

    receive() external payable {
        reentries++;
        try ntu.withdrawDeposit(id) {} catch { reentryReverted = true; }
    }
}
