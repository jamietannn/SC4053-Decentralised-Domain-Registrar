// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title NtuNames
/// @notice `.ntu` registrar using a commit-reveal first-price auction. See SPEC.md.
contract NtuNames is ReentrancyGuard {
    enum Phase { None, Commit, Reveal, Settlement, Settled, Closed }
    enum Reason { None, InvalidDomain, WrongDomain, BelowMinimum }

    struct Auction {
        bytes32 nameHash;
        address starter;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint32 commitCount;
        uint32 revealCount;
        uint32 eligibleCount;
        uint32 ineligibleCount;
        bool settled;
        bool finalised;
        address winner;
        uint256 winningBid;
        uint32 winnerCommitIndex;
    }

    struct Bid {
        bytes32 commitment;
        uint32 commitIndex;
        bool revealed;
        bool eligible;
        Reason reason;
        uint256 bid;
        bool withdrawn;
    }

    struct AuctionView {
        bytes32 nameHash;
        address starter;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint32 commitCount;
        uint32 revealCount;
        uint32 eligibleCount;
        bool settled;
        bool finalised;
        address winner;
        uint256 winningBid;
        Phase phase;
    }

    error ZeroHash();
    error NameTaken();
    error AuctionActive();
    error NotInCommitPhase();
    error WrongDeposit();
    error ZeroCommitment();
    error AlreadyCommitted();
    error CommitmentUsed();
    error NotInRevealPhase();
    error NoCommitment();
    error AlreadyRevealed();
    error CommitmentMismatch();
    error NotInSettlement();
    error NotEligible();
    error NotYourTurn();
    error WrongPayment();
    error NotClosed();
    error AlreadyFinalised();
    error NotWithdrawable();
    error NothingToWithdraw();
    error NotOwner();
    error TransferFailed();
    error InvalidConfig();

    event AuctionStarted(uint256 indexed id, bytes32 indexed nameHash, address indexed starter, uint64 commitDeadline, uint64 revealDeadline);
    event BidCommitted(uint256 indexed id, address indexed bidder, bytes32 commitment, uint32 commitIndex);
    event BidRevealed(uint256 indexed id, address indexed bidder, string domain, uint256 bid, bool eligible, Reason reason);
    event NameRegistered(bytes32 indexed nameHash, string domain, address indexed owner, uint256 indexed id, uint256 price);
    event AuctionSettled(uint256 indexed id, address indexed winner, uint256 price, uint32 rank);
    event AuctionClosed(uint256 indexed id, bytes32 indexed nameHash, uint256 forfeitedWei);
    event PrimaryNameSet(address indexed owner, string domain);
    event DepositWithdrawn(uint256 indexed id, address indexed bidder, uint256 amount);
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);

    uint64 public immutable commitDuration;
    uint64 public immutable revealDuration;
    uint64 public immutable settlementDuration;
    uint256 public immutable deposit;
    uint256 public immutable minBid;
    address public immutable treasury;

    uint256 public treasuryBalance;
    uint256 public auctionCount;

    mapping(uint256 => Auction) private _auctions;
    mapping(uint256 => mapping(address => Bid)) private _bids;
    mapping(uint256 => address[]) private _eligible;
    mapping(uint256 => string) private _auctionDomain;
    mapping(bytes32 => uint256) public activeAuctionOf;
    mapping(bytes32 => bool) public isCommitmentUsed;

    mapping(bytes32 => address) private _owner;
    mapping(bytes32 => string) private _domainOf;
    mapping(address => string[]) private _names;
    mapping(address => bytes32) private _primary;

    constructor(
        uint64 commitDuration_,
        uint64 revealDuration_,
        uint64 settlementDuration_,
        uint256 deposit_,
        uint256 minBid_,
        address treasury_
    ) {
        if (
            commitDuration_ == 0 || revealDuration_ == 0 || settlementDuration_ == 0 ||
            deposit_ == 0 || minBid_ < deposit_ || treasury_ == address(0)
        ) revert InvalidConfig();
        commitDuration = commitDuration_;
        revealDuration = revealDuration_;
        settlementDuration = settlementDuration_;
        deposit = deposit_;
        minBid = minBid_;
        treasury = treasury_;
    }

    // ---------------------------------------------------------------- auction

    function startAuction(bytes32 nameHash) external returns (uint256 id) {
        if (nameHash == bytes32(0)) revert ZeroHash();
        if (_owner[nameHash] != address(0)) revert NameTaken();

        uint256 active = activeAuctionOf[nameHash];
        if (active != 0) {
            if (_phase(active) != Phase.Closed) revert AuctionActive();
            _finalise(active);
        }

        id = ++auctionCount;
        Auction storage a = _auctions[id];
        a.nameHash = nameHash;
        a.starter = msg.sender;
        a.commitDeadline = uint64(block.timestamp) + commitDuration;
        a.revealDeadline = a.commitDeadline + revealDuration;
        activeAuctionOf[nameHash] = id;
        emit AuctionStarted(id, nameHash, msg.sender, a.commitDeadline, a.revealDeadline);
    }

    function commitBid(uint256 id, bytes32 commitment) external payable {
        if (_phase(id) != Phase.Commit) revert NotInCommitPhase();
        if (msg.value != deposit) revert WrongDeposit();
        if (commitment == bytes32(0)) revert ZeroCommitment();
        Bid storage b = _bids[id][msg.sender];
        if (b.commitment != bytes32(0)) revert AlreadyCommitted();
        if (isCommitmentUsed[commitment]) revert CommitmentUsed();

        Auction storage a = _auctions[id];
        b.commitment = commitment;
        b.commitIndex = a.commitCount;
        a.commitCount++;
        isCommitmentUsed[commitment] = true;
        emit BidCommitted(id, msg.sender, commitment, b.commitIndex);
    }

    function revealBid(uint256 id, string calldata domain, uint256 bid, bytes32 salt) external {
        if (_phase(id) != Phase.Reveal) revert NotInRevealPhase();
        Bid storage b = _bids[id][msg.sender];
        if (b.commitment == bytes32(0)) revert NoCommitment();
        if (b.revealed) revert AlreadyRevealed();
        if (keccak256(abi.encode(domain, bid, salt)) != b.commitment) revert CommitmentMismatch();

        Auction storage a = _auctions[id];
        b.revealed = true;
        b.bid = bid;
        a.revealCount++;

        Reason reason = Reason.None;
        if (!_validDomain(bytes(domain))) reason = Reason.InvalidDomain;
        else if (keccak256(bytes(domain)) != a.nameHash) reason = Reason.WrongDomain;
        else if (bid < minBid) reason = Reason.BelowMinimum;

        if (reason == Reason.None) {
            b.eligible = true;
            if (a.eligibleCount == 0) _auctionDomain[id] = domain;
            a.eligibleCount++;
            _eligible[id].push(msg.sender);
        } else {
            b.reason = reason;
            a.ineligibleCount++;
        }
        emit BidRevealed(id, msg.sender, domain, bid, reason == Reason.None, reason);
    }

    function payWinningBid(uint256 id) external payable {
        if (_phase(id) != Phase.Settlement) revert NotInSettlement();
        Bid storage b = _bids[id][msg.sender];
        if (!b.eligible) revert NotEligible();
        Auction storage a = _auctions[id];

        uint32 rank = _rank(id, msg.sender);
        if (rank != (block.timestamp - a.revealDeadline) / settlementDuration) revert NotYourTurn();
        if (msg.value != b.bid - deposit) revert WrongPayment();

        a.settled = true;
        a.finalised = true;
        a.winner = msg.sender;
        a.winningBid = b.bid;
        a.winnerCommitIndex = b.commitIndex;
        activeAuctionOf[a.nameHash] = 0;

        // winner's bid (their deposit is credited), defaulted higher-ranked deposits, non-revealers' deposits
        treasuryBalance += b.bid + uint256(rank) * deposit + uint256(a.commitCount - a.revealCount) * deposit;

        string memory domain = _auctionDomain[id];
        _owner[a.nameHash] = msg.sender;
        _domainOf[a.nameHash] = domain;
        _names[msg.sender].push(domain);
        emit NameRegistered(a.nameHash, domain, msg.sender, id, b.bid);
        emit AuctionSettled(id, msg.sender, b.bid, rank);
        if (_primary[msg.sender] == bytes32(0)) {
            _primary[msg.sender] = a.nameHash;
            emit PrimaryNameSet(msg.sender, domain);
        }
    }

    function finalise(uint256 id) external {
        if (_phase(id) != Phase.Closed) revert NotClosed();
        if (_auctions[id].finalised) revert AlreadyFinalised();
        _finalise(id);
    }

    function _finalise(uint256 id) private {
        Auction storage a = _auctions[id];
        if (a.finalised) revert AlreadyFinalised();
        a.finalised = true;
        uint256 forfeited = uint256(a.commitCount - a.ineligibleCount) * deposit;
        treasuryBalance += forfeited;
        activeAuctionOf[a.nameHash] = 0;
        emit AuctionClosed(id, a.nameHash, forfeited);
    }

    function withdrawDeposit(uint256 id) external nonReentrant {
        if (!canWithdraw(id, msg.sender)) revert NotWithdrawable();
        _bids[id][msg.sender].withdrawn = true;
        emit DepositWithdrawn(id, msg.sender, deposit);
        (bool ok, ) = msg.sender.call{value: deposit}("");
        if (!ok) revert TransferFailed();
    }

    function withdrawTreasury() external nonReentrant {
        uint256 amount = treasuryBalance;
        if (amount == 0) revert NothingToWithdraw();
        treasuryBalance = 0;
        emit TreasuryWithdrawn(treasury, amount);
        (bool ok, ) = treasury.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function setPrimaryName(string calldata domain) external {
        bytes32 h = keccak256(bytes(domain));
        if (_owner[h] != msg.sender) revert NotOwner();
        _primary[msg.sender] = h;
        emit PrimaryNameSet(msg.sender, domain);
    }

    // ------------------------------------------------------------------ views

    function resolve(string calldata domain) external view returns (address) {
        return _owner[keccak256(bytes(domain))];
    }

    function ownerOf(string calldata domain) external view returns (address) {
        return _owner[keccak256(bytes(domain))];
    }

    function domainOf(bytes32 nameHash) external view returns (string memory) {
        return _domainOf[nameHash];
    }

    function reverseResolve(address addr) external view returns (string memory) {
        return _domainOf[_primary[addr]];
    }

    function namesOf(address addr) external view returns (string[] memory) {
        return _names[addr];
    }

    function getAuction(uint256 id) external view returns (AuctionView memory v) {
        Auction storage a = _auctions[id];
        v = AuctionView(
            a.nameHash, a.starter, a.commitDeadline, a.revealDeadline, a.commitCount, a.revealCount,
            a.eligibleCount, a.settled, a.finalised, a.winner, a.winningBid, _phase(id)
        );
    }

    function phaseOf(uint256 id) external view returns (Phase) {
        return _phase(id);
    }

    function getBid(uint256 id, address bidder) external view returns (Bid memory) {
        return _bids[id][bidder];
    }

    function rankOf(uint256 id, address bidder) external view returns (uint32 rank, uint64 windowStart, uint64 windowEnd) {
        if (!_bids[id][bidder].eligible) revert NotEligible();
        rank = _rank(id, bidder);
        windowStart = _auctions[id].revealDeadline + uint64(rank) * settlementDuration;
        windowEnd = windowStart + settlementDuration;
    }

    /// @dev O(n^2) over eligible bidders; intended for off-chain calls only.
    function currentOfferee(uint256 id) external view returns (address) {
        if (_phase(id) != Phase.Settlement) return address(0);
        uint32 k = uint32((block.timestamp - _auctions[id].revealDeadline) / settlementDuration);
        address[] storage list = _eligible[id];
        for (uint256 i = 0; i < list.length; i++) {
            if (_rank(id, list[i]) == k) return list[i];
        }
        return address(0);
    }

    function amountDue(uint256 id, address bidder) external view returns (uint256) {
        Bid storage b = _bids[id][bidder];
        if (!b.eligible) revert NotEligible();
        return b.bid - deposit;
    }

    function canWithdraw(uint256 id, address bidder) public view returns (bool) {
        Bid storage b = _bids[id][bidder];
        if (!b.revealed || b.withdrawn) return false;
        if (!b.eligible) return true;
        Auction storage a = _auctions[id];
        if (!a.settled) return false;
        // refundable only if ranked strictly below the winner
        return b.bid < a.winningBid || (b.bid == a.winningBid && b.commitIndex > a.winnerCommitIndex);
    }

    // --------------------------------------------------------------- internal

    function _phase(uint256 id) private view returns (Phase) {
        Auction storage a = _auctions[id];
        if (a.nameHash == bytes32(0)) return Phase.None;
        if (a.settled) return Phase.Settled;
        if (block.timestamp < a.commitDeadline) return Phase.Commit;
        if (a.commitCount == 0) return Phase.Closed;
        if (block.timestamp < a.revealDeadline) return Phase.Reveal;
        if (a.eligibleCount == 0) return Phase.Closed;
        if (block.timestamp < uint256(a.revealDeadline) + uint256(a.eligibleCount) * settlementDuration) return Phase.Settlement;
        return Phase.Closed;
    }

    /// @dev rank = number of eligible bids that beat this one (higher bid, or equal bid committed earlier).
    function _rank(uint256 id, address bidder) private view returns (uint32 rank) {
        Bid storage me = _bids[id][bidder];
        address[] storage list = _eligible[id];
        uint256 n = list.length;
        for (uint256 i = 0; i < n; i++) {
            Bid storage o = _bids[id][list[i]];
            if (o.bid > me.bid || (o.bid == me.bid && o.commitIndex < me.commitIndex)) rank++;
        }
    }

    function _validDomain(bytes memory d) private pure returns (bool) {
        uint256 len = d.length;
        if (len < 3 || len > 32) return false;
        for (uint256 i = 0; i < len; i++) {
            bytes1 c = d[i];
            if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39))) return false;
        }
        return true;
    }
}
