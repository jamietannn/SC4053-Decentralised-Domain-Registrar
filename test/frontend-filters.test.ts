import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import abi from "../frontend/src/lib/abi.json";
import { commitmentOf, nameHash, randomSalt } from "../frontend/src/lib/domain";
import { bidCommittedBy, historyFilters, nameRegisteredBy } from "../frontend/src/lib/filters";

// The frontend finds a user's names/auctions/history with indexed-event filters. A filter with an argument in the
// wrong position throws in ethers, so run every one against a real contract after a full auction.
describe("frontend event filters", () => {
  it("every filter the UI uses can be queried, and returns the user's events", async () => {
    const [, treasury, bidder, other] = await ethers.getSigners();
    const D = ethers.parseEther("0.005");
    const deployed = await (await ethers.getContractFactory("NtuNames")).deploy(180, 180, 180, D, D, treasury.address);
    const c = new ethers.Contract(await deployed.getAddress(), abi, ethers.provider);
    const ntu = deployed;

    await ntu.connect(bidder).startAuction(nameHash("alice"));
    const bid = ethers.parseEther("0.02"), salt = randomSalt(), salt2 = randomSalt();
    await ntu.connect(bidder).commitBid(1, commitmentOf("alice", bid, salt), { value: D });
    await ntu.connect(other).commitBid(1, commitmentOf("alice", D, salt2), { value: D });
    await time.increaseTo((await ntu.getAuction(1)).commitDeadline);
    await ntu.connect(bidder).revealBid(1, "alice", bid, salt);
    await ntu.connect(other).revealBid(1, "alice", D, salt2);
    await time.increaseTo((await ntu.getAuction(1)).revealDeadline);
    await ntu.connect(bidder).payWinningBid(1, { value: bid - D });
    await ntu.connect(other).withdrawDeposit(1);

    const names = await c.queryFilter(nameRegisteredBy(c as any, bidder.address), 0);
    expect(names.map((l: any) => l.args.domain)).to.deep.equal(["alice"]);
    expect((await c.queryFilter(nameRegisteredBy(c as any, other.address), 0)).length).to.equal(0);
    expect((await c.queryFilter(bidCommittedBy(c as any, bidder.address), 0)).length).to.equal(1);

    const mine = (await Promise.all(historyFilters(c as any, bidder.address).map((f) => c.queryFilter(f, 0)))).flat();
    const kinds = mine.map((l: any) => l.fragment.name).sort();
    expect(kinds).to.deep.equal(["AuctionSettled", "AuctionStarted", "BidCommitted", "BidRevealed", "NameRegistered", "PrimaryNameSet"]);
    const others = (await Promise.all(historyFilters(c as any, other.address).map((f) => c.queryFilter(f, 0)))).flat();
    expect(others.map((l: any) => l.fragment.name).sort()).to.deep.equal(["BidCommitted", "BidRevealed", "DepositWithdrawn"]);
  });
});
