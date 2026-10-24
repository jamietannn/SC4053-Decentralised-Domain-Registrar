import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { commitmentOf, nameHash, randomSalt } from "../frontend/src/lib/domain";

// SPEC.md criterion 51: the frontend's commitment must equal the contract's. The contract accepts a reveal
// only if keccak256(abi.encode(domain, bid, salt)) equals the stored commitment, so a successful reveal proves it.
describe("frontend commitment encoding matches the contract", () => {
  it("51. reveal succeeds for a commitment built by the frontend helper", async () => {
    const [, treasury, bidder] = await ethers.getSigners();
    const D = ethers.parseEther("0.005");
    const ntu = await (await ethers.getContractFactory("NtuNames")).deploy(180, 180, 180, D, D, treasury.address);
    await ntu.startAuction(nameHash("alice"));
    const bid = ethers.parseEther("0.0123");
    const salt = randomSalt();
    await ntu.connect(bidder).commitBid(1, commitmentOf("alice", bid, salt), { value: D });
    await time.increaseTo((await ntu.getAuction(1)).commitDeadline);
    await expect(ntu.connect(bidder).revealBid(1, "alice", bid, salt)).to.emit(ntu, "BidRevealed").withArgs(1, bidder.address, "alice", bid, true, 0);
  });
});
