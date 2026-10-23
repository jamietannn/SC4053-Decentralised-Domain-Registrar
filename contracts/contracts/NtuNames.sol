// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title NtuNames - decentralised .ntu domain registrar (see SPEC.md)
/// @notice Domains are sold through hash-started, commit-reveal, first-price blind auctions.
///         Commitment = keccak256(abi.encode(domain, bidWei, salt)). Auctions are keyed by
///         nameHash = keccak256(bytes(domain)) so the plaintext domain stays off-chain until reveal.
///         Registrations are permanent and resolve to the owner. There is no admin.
contract NtuNames is ReentrancyGuard {
    // ------------------------------------------------------------------ types

    enum Phase {
        None,
        Commit,
        Reveal,
        Settlement,
        Settled,
        Closed
    }

    /// @dev `None` means the reveal was eligible (or the bid is not yet revealed).
    enum Ineligibility {
        None,
        BelowMinimum,
        InvalidDomain,
        WrongDomain
    }

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
        uint256 winnerRank;
        string domain; // set by the first eligible reveal
    }

    struct Bid {
        bytes32 commitment;
        uint32 commitIndex;
        bool revealed;
        bool eligible;
        Ineligibility reason;
        bool withdrawn;
        uint256 amount;
    }

    struct AuctionView {
        uint256 id;
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
        string domain;
        Phase phase;
    }

    // ------------------------------------------------------------------ config

    uint64 public immutable commitDuration;
    uint64 public immutable revealDuration;
    uint64 public immutable settlementDuration;
    uint256 public immutable deposit;
    uint256 public immutable minBid;
    address public immutable treasury;

    // ------------------------------------------------------------------ state

    uint256 public auctionCount;
    uint256 public treasuryBalance;

    mapping(uint256 => Auction) private _auctions;
    mapping(uint256 => mapping(address => Bid)) private _bids;
    mapping(uint256 => address[]) private _eligibleBidders;
    mapping(bytes32 => bool) private _commitmentUsed;

    /// @notice Latest auction for a nameHash that is not yet settled or finalised (0 = none).
    mapping(bytes32 => uint256) public activeAuctionOf;

    mapping(bytes32 => address) private _owners;
    mapping(bytes32 => string) private _domains;
    mapping(address => string[]) private _names;
    mapping(address => bytes32) private _primary;

    // ------------------------------------------------------------------ events

    event AuctionStarted(
        uint256 indexed auctionId,
        bytes32 indexed nameHash,
        address indexed starter,
        uint64 commitDeadline,
        uint64 revealDeadline
    );
    event BidCommitted(uint256 indexed auctionId, address indexed bidder, bytes32 commitment, uint256 commitIndex);
    event BidRevealed(
        uint256 indexed auctionId,
        address indexed bidder,
        string domain,
        uint256 bid,
        bool eligible,
        Ineligibility reason
    );
    event NameRegistered(
        bytes32 indexed nameHash,
        string domain,
        address indexed owner,
        uint256 indexed auctionId,
        uint256 price
    );
    event AuctionSettled(uint256 indexed auctionId, address indexed winner, uint256 price, uint256 rank);
    event AuctionClosed(uint256 indexed auctionId, bytes32 indexed nameHash, uint256 forfeited);
    event DepositWithdrawn(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);
    event PrimaryNameSet(address indexed owner, string domain);

    // ------------------------------------------------------------------ errors

    error InvalidConfig();
    error ZeroHash();
    error NameAlreadyRegistered();
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
    error TransferFailed();
    error NotOwner();

    // ------------------------------------------------------------------ constructor

    constructor(
        uint64 commitDuration_,
        uint64 revealDuration_,
        uint64 settlementDuration_,
        uint256 deposit_,
        uint256 minBid_,
        address treasury_
    ) {
        if (
            commitDuration_ == 0 || revealDuration_ == 0 || settlementDuration_ == 0 || deposit_ == 0
                || minBid_ < deposit_ || treasury_ == address(0)
        ) revert InvalidConfig();
        commitDuration = commitDuration_;
        revealDuration = revealDuration_;
        settlementDuration = settlementDuration_;
        deposit = deposit_;
        minBid = minBid_;
        treasury = treasury_;
    }

    // ------------------------------------------------------------------ auction lifecycle

    /// @notice Open a blind auction for keccak256(bytes(domain)). Anyone may call.
    function startAuction(bytes32 nameHash) external returns (uint256 auctionId) {
        if (nameHash == bytes32(0)) revert ZeroHash();
        if (_owners[nameHash] != address(0)) revert NameAlreadyRegistered();
        uint256 previous = activeAuctionOf[nameHash];
        if (previous != 0) {
            if (phaseOf(previous) != Phase.Closed) revert AuctionActive();
            _finalise(previous);
        }

        auctionId = ++auctionCount;
        Auction storage a = _auctions[auctionId];
        a.nameHash = nameHash;
        a.starter = msg.sender;
        a.commitDeadline = uint64(block.timestamp) + commitDuration;
        a.revealDeadline = a.commitDeadline + revealDuration;
        activeAuctionOf[nameHash] = auctionId;

        emit AuctionStarted(auctionId, nameHash, msg.sender, a.commitDeadline, a.revealDeadline);
    }

    /// @notice Submit a hidden bid with exactly `deposit` wei. One immutable commitment per address.
    function commitBid(uint256 auctionId, bytes32 commitment) external payable {
        if (phaseOf(auctionId) != Phase.Commit) revert NotInCommitPhase();
        if (msg.value != deposit) revert WrongDeposit();
        if (commitment == bytes32(0)) revert ZeroCommitment();
        Bid storage b = _bids[auctionId][msg.sender];
        if (b.commitment != bytes32(0)) revert AlreadyCommitted();
        // A commitment value is single-use forever, so a copied commitment can never be revealed by the copier.
        if (_commitmentUsed[commitment]) revert CommitmentUsed();

        _commitmentUsed[commitment] = true;
        Auction storage a = _auctions[auctionId];
        b.commitment = commitment;
        b.commitIndex = a.commitCount;
        a.commitCount++;

        emit BidCommitted(auctionId, msg.sender, commitment, b.commitIndex);
    }

    /// @notice Reveal a commitment. Matching but ineligible reveals are recorded and refundable.
    function revealBid(uint256 auctionId, string calldata domain, uint256 bid, bytes32 salt) external {
        if (phaseOf(auctionId) != Phase.Reveal) revert NotInRevealPhase();
        Bid storage b = _bids[auctionId][msg.sender];
        if (b.commitment == bytes32(0)) revert NoCommitment();
        if (b.revealed) revert AlreadyRevealed();
        if (keccak256(abi.encode(domain, bid, salt)) != b.commitment) revert CommitmentMismatch();

        Auction storage a = _auctions[auctionId];
        b.revealed = true;
        b.amount = bid;
        a.revealCount++;

        Ineligibility reason = Ineligibility.None;
        if (!isValidDomain(domain)) reason = Ineligibility.InvalidDomain;
        else if (keccak256(bytes(domain)) != a.nameHash) reason = Ineligibility.WrongDomain;
        else if (bid < minBid) reason = Ineligibility.BelowMinimum;

        if (reason == Ineligibility.None) {
            b.eligible = true;
            _eligibleBidders[auctionId].push(msg.sender);
            a.eligibleCount++;
            if (bytes(a.domain).length == 0) a.domain = domain;
        } else {
            b.reason = reason;
            a.ineligibleCount++;
        }

        emit BidRevealed(auctionId, msg.sender, domain, bid, b.eligible, reason);
    }

    /// @notice Pay (bid - deposit) during your settlement window to register the domain.
    function payWinningBid(uint256 auctionId) external payable {
        if (phaseOf(auctionId) != Phase.Settlement) revert NotInSettlement();
        Bid storage b = _bids[auctionId][msg.sender];
        if (!b.eligible) revert NotEligible();
        Auction storage a = _auctions[auctionId];
        uint256 rank = _rank(auctionId, msg.sender);
        if (rank != _currentWindow(a)) revert NotYourTurn();
        if (msg.value != b.amount - deposit) revert WrongPayment();

        a.settled = true;
        a.finalised = true;
        a.winner = msg.sender;
        a.winningBid = b.amount;
        a.winnerRank = rank;
        // Full price (deposit credited) + defaulted higher-ranked deposits + unrevealed deposits.
        treasuryBalance += b.amount + rank * deposit + uint256(a.commitCount - a.revealCount) * deposit;
        delete activeAuctionOf[a.nameHash];

        _register(a.nameHash, a.domain, msg.sender, auctionId, b.amount);
        emit AuctionSettled(auctionId, msg.sender, b.amount, rank);
    }

    /// @notice Record a closed auction's forfeited deposits. Permissionless.
    function finalise(uint256 auctionId) external {
        if (phaseOf(auctionId) != Phase.Closed) revert NotClosed();
        if (_auctions[auctionId].finalised) revert AlreadyFinalised();
        _finalise(auctionId);
    }

    // ------------------------------------------------------------------ withdrawals

    /// @notice Withdraw your deposit once it is refundable (see canWithdraw).
    function withdrawDeposit(uint256 auctionId) external nonReentrant {
        if (!canWithdraw(auctionId, msg.sender)) revert NotWithdrawable();
        _bids[auctionId][msg.sender].withdrawn = true;
        emit DepositWithdrawn(auctionId, msg.sender, deposit);
        (bool ok,) = msg.sender.call{value: deposit}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Send all accrued revenue to the fixed treasury. Permissionless.
    function withdrawTreasury() external nonReentrant {
        uint256 amount = treasuryBalance;
        if (amount == 0) revert NothingToWithdraw();
        treasuryBalance = 0;
        emit TreasuryWithdrawn(treasury, amount);
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ------------------------------------------------------------------ names

    /// @notice Make one of your registered domains your primary (reverse) name.
    function setPrimaryName(string calldata domain) external {
        bytes32 nameHash = keccak256(bytes(domain));
        if (_owners[nameHash] != msg.sender) revert NotOwner();
        _primary[msg.sender] = nameHash;
        emit PrimaryNameSet(msg.sender, domain);
    }

    // ------------------------------------------------------------------ views

    function phaseOf(uint256 auctionId) public view returns (Phase) {
        Auction storage a = _auctions[auctionId];
        if (a.commitDeadline == 0) return Phase.None;
        if (a.settled) return Phase.Settled;
        if (block.timestamp < a.commitDeadline) return Phase.Commit;
        if (a.commitCount == 0) return Phase.Closed;
        if (block.timestamp < a.revealDeadline) return Phase.Reveal;
        if (a.eligibleCount == 0) return Phase.Closed;
        if (block.timestamp < _settlementEnd(a)) return Phase.Settlement;
        return Phase.Closed;
    }

    function getAuction(uint256 auctionId) external view returns (AuctionView memory v) {
        Auction storage a = _auctions[auctionId];
        v = AuctionView({
            id: auctionId,
            nameHash: a.nameHash,
            starter: a.starter,
            commitDeadline: a.commitDeadline,
            revealDeadline: a.revealDeadline,
            commitCount: a.commitCount,
            revealCount: a.revealCount,
            eligibleCount: a.eligibleCount,
            ineligibleCount: a.ineligibleCount,
            settled: a.settled,
            finalised: a.finalised,
            winner: a.winner,
            winningBid: a.winningBid,
            domain: a.domain,
            phase: phaseOf(auctionId)
        });
    }

    function getBid(uint256 auctionId, address bidder) external view returns (Bid memory) {
        return _bids[auctionId][bidder];
    }

    /// @notice Rank (0 = highest) of an eligible bid and its settlement window [start, end).
    function rankOf(uint256 auctionId, address bidder)
        external
        view
        returns (uint256 rank, uint256 windowStart, uint256 windowEnd)
    {
        if (!_bids[auctionId][bidder].eligible) revert NotEligible();
        rank = _rank(auctionId, bidder);
        windowStart = _auctions[auctionId].revealDeadline + rank * settlementDuration;
        windowEnd = windowStart + settlementDuration;
    }

    /// @notice The bidder allowed to pay right now, or address(0). O(n^2), intended for off-chain calls.
    function currentOfferee(uint256 auctionId) external view returns (address) {
        if (phaseOf(auctionId) != Phase.Settlement) return address(0);
        uint256 window = _currentWindow(_auctions[auctionId]);
        address[] storage list = _eligibleBidders[auctionId];
        for (uint256 i = 0; i < list.length; i++) {
            if (_rank(auctionId, list[i]) == window) return list[i];
        }
        return address(0);
    }

    function amountDue(uint256 auctionId, address bidder) external view returns (uint256) {
        Bid storage b = _bids[auctionId][bidder];
        return b.eligible ? b.amount - deposit : 0;
    }

    function canWithdraw(uint256 auctionId, address bidder) public view returns (bool) {
        Bid storage b = _bids[auctionId][bidder];
        if (!b.revealed || b.withdrawn) return false;
        if (!b.eligible) return true;
        Auction storage a = _auctions[auctionId];
        if (!a.settled || bidder == a.winner) return false;
        return _ranksAbove(_bids[auctionId][a.winner], b);
    }

    function isCommitmentUsed(bytes32 commitment) external view returns (bool) {
        return _commitmentUsed[commitment];
    }

    function resolve(string calldata domain) external view returns (address) {
        return _owners[keccak256(bytes(domain))];
    }

    function ownerOf(string calldata domain) external view returns (address) {
        return _owners[keccak256(bytes(domain))];
    }

    function domainOf(bytes32 nameHash) external view returns (string memory) {
        return _domains[nameHash];
    }

    function reverseResolve(address addr) external view returns (string memory) {
        bytes32 nameHash = _primary[addr];
        return nameHash == bytes32(0) ? "" : _domains[nameHash];
    }

    function namesOf(address owner) external view returns (string[] memory) {
        return _names[owner];
    }

    /// @notice 3-32 characters, each a-z or 0-9.
    function isValidDomain(string calldata domain) public pure returns (bool) {
        bytes calldata d = bytes(domain);
        if (d.length < 3 || d.length > 32) return false;
        for (uint256 i = 0; i < d.length; i++) {
            bytes1 c = d[i];
            if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39))) return false;
        }
        return true;
    }

    // ------------------------------------------------------------------ internal

    function _finalise(uint256 auctionId) private {
        Auction storage a = _auctions[auctionId];
        a.finalised = true;
        // No winner: unrevealed and all eligible (defaulted) deposits are forfeited.
        uint256 forfeited = uint256(a.commitCount - a.ineligibleCount) * deposit;
        treasuryBalance += forfeited;
        if (activeAuctionOf[a.nameHash] == auctionId) delete activeAuctionOf[a.nameHash];
        emit AuctionClosed(auctionId, a.nameHash, forfeited);
    }

    function _register(bytes32 nameHash, string memory domain, address owner, uint256 auctionId, uint256 price)
        private
    {
        _owners[nameHash] = owner;
        _domains[nameHash] = domain;
        _names[owner].push(domain);
        emit NameRegistered(nameHash, domain, owner, auctionId, price);
        if (_primary[owner] == bytes32(0)) {
            _primary[owner] = nameHash;
            emit PrimaryNameSet(owner, domain);
        }
    }

    /// @dev Number of eligible bids ranked ahead of `bidder` (higher amount, or equal amount committed earlier).
    function _rank(uint256 auctionId, address bidder) private view returns (uint256 rank) {
        Bid storage me = _bids[auctionId][bidder];
        address[] storage list = _eligibleBidders[auctionId];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] != bidder && _ranksAbove(_bids[auctionId][list[i]], me)) rank++;
        }
    }

    function _ranksAbove(Bid storage x, Bid storage y) private view returns (bool) {
        return x.amount > y.amount || (x.amount == y.amount && x.commitIndex < y.commitIndex);
    }

    function _currentWindow(Auction storage a) private view returns (uint256) {
        return (block.timestamp - a.revealDeadline) / settlementDuration;
    }

    function _settlementEnd(Auction storage a) private view returns (uint256) {
        return a.revealDeadline + uint256(a.eligibleCount) * settlementDuration;
    }
}
