import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

// Measures the cost of the O(n) rank scan in payWinningBid (worst case: lowest-ranked bidder pays last).
describe("gas scaling of payWinningBid", () => {
  for (const n of [10, 50, 200, 600]) {
    it(`n=${n} eligible bids`, async function () {
      this.timeout(300000);
      const [, treasury] = await ethers.getSigners();
      const D = ethers.parseEther("0.005");
      const ntu = await (await ethers.getContractFactory("NtuNames")).deploy(100000, 100000, 180, D, D, treasury.address);
      await ntu.startAuction(ethers.keccak256(ethers.toUtf8Bytes("alice")));
      const enc = ethers.AbiCoder.defaultAbiCoder();
      const ws: any[] = [];
      for (let i = 0; i < n; i++) {
        const w = ethers.Wallet.createRandom().connect(ethers.provider);
        await ethers.provider.send("hardhat_setBalance", [w.address, "0x56BC75E2D63100000"]);
        const bid = D + BigInt(i) * 1000n;
        const salt = ethers.zeroPadValue(ethers.toBeHex(i + 1), 32);
        await ntu.connect(w).commitBid(1, ethers.keccak256(enc.encode(["string", "uint256", "bytes32"], ["alice", bid, salt])), { value: D });
        ws.push({ w, bid, salt });
      }
      await time.increaseTo((await ntu.getAuction(1)).commitDeadline);
      for (const { w, bid, salt } of ws) await ntu.connect(w).revealBid(1, "alice", bid, salt);
      const rd = (await ntu.getAuction(1)).revealDeadline;
      // lowest bidder is rank n-1 -> pays in the last window
      await time.setNextBlockTimestamp(rd + BigInt((n - 1) * 180));
      const { w, bid } = ws[0];
      const tx = await ntu.connect(w).payWinningBid(1, { value: bid - D });
      const gas = (await tx.wait())!.gasUsed;
      console.log(`      payWinningBid gas @ n=${n}: ${gas}`);
      expect(gas).to.be.greaterThan(0n);
    });
  }
});
