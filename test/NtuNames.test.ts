import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { NtuNames } from "../typechain-types";

const E = ethers.parseEther;
const C = 180, R = 180, S = 180;
const D = E("0.005"), MIN = E("0.005");
const h = (d: string) => ethers.keccak256(ethers.toUtf8Bytes(d));
const salt = (n: number) => ethers.zeroPadValue(ethers.toBeHex(n + 1), 32);
const commitOf = (d: string, bid: bigint, s: string) =>
  ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "uint256", "bytes32"], [d, bid, s]));

async function deploy() {
  const signers = await ethers.getSigners();
  const [deployer, treasury, ...users] = signers;
  const ntu = (await (await ethers.getContractFactory("NtuNames")).deploy(C, R, S, D, MIN, treasury.address)) as NtuNames;
  return { ntu, deployer, treasury, users };
}

// auction helpers ---------------------------------------------------------
const touched: { id: bigint; who: string }[] = [];
async function start(ntu: NtuNames, name = "alice") {
  await ntu.startAuction(h(name));
  return ntu.auctionCount();
}
async function commit(ntu: NtuNames, id: bigint, user: any, name: string, bid: bigint, n: number) {
  await ntu.connect(user).commitBid(id, commitOf(name, bid, salt(n)), { value: D });
  touched.push({ id, who: user.address });
}
async function reveal(ntu: NtuNames, id: bigint, user: any, name: string, bid: bigint, n: number) {
  return ntu.connect(user).revealBid(id, name, bid, salt(n));
}
async function toReveal(ntu: NtuNames, id: bigint) { await time.increaseTo((await ntu.getAuction(id)).commitDeadline); }
async function toSettlement(ntu: NtuNames, id: bigint) { await time.increaseTo((await ntu.getAuction(id)).revealDeadline); }
async function checkInvariant(ntu: NtuNames) {
  let held = 0n;
  for (const { id, who } of touched) {
    const a = await ntu.getAuction(id);
    const b = await ntu.getBid(id, who);
    if (b.withdrawn) continue;
    if ((await ntu.canWithdraw(id, who)) || !a.finalised) held += D;
  }
  const bal = await ethers.provider.getBalance(await ntu.getAddress());
  // winner's payment already included in treasuryBalance; pending (unfinalised) auctions keep all deposits
  expect(bal).to.equal((await ntu.treasuryBalance()) + held);
}

describe("NtuNames", () => {
  beforeEach(() => { touched.length = 0; });
  const fx = () => loadFixture(deploy);

  describe("deployment", () => {
    it("1. reverts when minBid < deposit", async () => {
      const f = await ethers.getContractFactory("NtuNames");
      const [, t] = await ethers.getSigners();
      await expect(f.deploy(C, R, S, E("0.01"), E("0.005"), t.address)).to.be.revertedWithCustomError(f, "InvalidConfig");
    });
    it("2. reverts on zero duration/deposit/treasury", async () => {
      const f = await ethers.getContractFactory("NtuNames");
      const [, t] = await ethers.getSigners();
      for (const args of [
        [0, R, S, D, MIN, t.address], [C, 0, S, D, MIN, t.address], [C, R, 0, D, MIN, t.address],
        [C, R, S, 0, MIN, t.address], [C, R, S, D, MIN, ethers.ZeroAddress],
      ]) await expect(f.deploy(...(args as [any, any, any, any, any, any]))).to.be.revertedWithCustomError(f, "InvalidConfig");
    });
  });

  describe("start auction", () => {
    it("3. creates auction 1 in commit phase", async () => {
      const { ntu } = await fx();
      await expect(ntu.startAuction(h("alice"))).to.emit(ntu, "AuctionStarted");
      const a = await ntu.getAuction(1);
      const t = BigInt(await time.latest());
      expect(a.commitDeadline).to.equal(t + BigInt(C));
      expect(a.revealDeadline).to.equal(t + BigInt(C + R));
      expect(await ntu.phaseOf(1)).to.equal(1);
    });
    it("4. reverts AuctionActive in commit/reveal/settlement", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await expect(ntu.startAuction(h("alice"))).to.be.revertedWithCustomError(ntu, "AuctionActive");
      await commit(ntu, id, users[0], "alice", E("0.01"), 0);
      await toReveal(ntu, id);
      await expect(ntu.startAuction(h("alice"))).to.be.revertedWithCustomError(ntu, "AuctionActive");
      await reveal(ntu, id, users[0], "alice", E("0.01"), 0);
      await toSettlement(ntu, id);
      expect(await ntu.phaseOf(id)).to.equal(3);
      await expect(ntu.startAuction(h("alice"))).to.be.revertedWithCustomError(ntu, "AuctionActive");
    });
    it("5. reverts NameTaken when registered", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", MIN, 0);
      await toReveal(ntu, id); await reveal(ntu, id, users[0], "alice", MIN, 0);
      await toSettlement(ntu, id);
      await ntu.connect(users[0]).payWinningBid(id);
      await expect(ntu.startAuction(h("alice"))).to.be.revertedWithCustomError(ntu, "NameTaken");
    });
    it("6. reverts ZeroHash", async () => {
      const { ntu } = await fx();
      await expect(ntu.startAuction(ethers.ZeroHash)).to.be.revertedWithCustomError(ntu, "ZeroHash");
    });
    it("7. auto-finalises a closed auction on restart", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", E("0.01"), 0);
      await time.increaseTo((await ntu.getAuction(id)).revealDeadline); // never revealed -> Closed
      expect(await ntu.phaseOf(id)).to.equal(5);
      await expect(ntu.startAuction(h("alice"))).to.emit(ntu, "AuctionClosed").withArgs(id, h("alice"), D);
      expect(await ntu.auctionCount()).to.equal(2);
      expect((await ntu.getAuction(id)).finalised).to.equal(true);
      await checkInvariant(ntu);
    });
  });

  describe("commit", () => {
    it("8. stores bid with next commitIndex", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      const c0 = commitOf("alice", E("0.01"), salt(0));
      await expect(ntu.connect(users[0]).commitBid(id, c0, { value: D })).to.emit(ntu, "BidCommitted").withArgs(id, users[0].address, c0, 0);
      await commit(ntu, id, users[1], "alice", E("0.02"), 1);
      expect((await ntu.getBid(id, users[1].address)).commitIndex).to.equal(1);
      expect(await ntu.isCommitmentUsed(c0)).to.equal(true);
    });
    it("9. reverts WrongDeposit", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await expect(ntu.connect(users[0]).commitBid(id, salt(1), { value: D + 1n })).to.be.revertedWithCustomError(ntu, "WrongDeposit");
      await expect(ntu.connect(users[0]).commitBid(id, salt(1), { value: 0 })).to.be.revertedWithCustomError(ntu, "WrongDeposit");
    });
    it("10. reverts at commitDeadline", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      const dl = (await ntu.getAuction(id)).commitDeadline;
      await time.setNextBlockTimestamp(dl);
      await expect(ntu.connect(users[0]).commitBid(id, salt(1), { value: D })).to.be.revertedWithCustomError(ntu, "NotInCommitPhase");
    });
    it("11. reverts AlreadyCommitted", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", MIN, 0);
      await expect(ntu.connect(users[0]).commitBid(id, salt(99), { value: D })).to.be.revertedWithCustomError(ntu, "AlreadyCommitted");
    });
    it("12. reverts CommitmentUsed across bidders and auctions", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      const x = commitOf("alice", MIN, salt(0));
      await ntu.connect(users[0]).commitBid(id, x, { value: D });
      await expect(ntu.connect(users[1]).commitBid(id, x, { value: D })).to.be.revertedWithCustomError(ntu, "CommitmentUsed");
      await ntu.startAuction(h("bob"));
      await expect(ntu.connect(users[0]).commitBid(2, x, { value: D })).to.be.revertedWithCustomError(ntu, "CommitmentUsed");
    });
    it("13. reverts ZeroCommitment", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await expect(ntu.connect(users[0]).commitBid(id, ethers.ZeroHash, { value: D })).to.be.revertedWithCustomError(ntu, "ZeroCommitment");
    });
    it("14. front-runner copying a commitment cannot win; victim recommits", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      const [victim, attacker] = users;
      const x = commitOf("alice", E("0.01"), salt(0));
      await ntu.connect(attacker).commitBid(id, x, { value: D });
      await expect(ntu.connect(victim).commitBid(id, x, { value: D })).to.be.revertedWithCustomError(ntu, "CommitmentUsed");
      await commit(ntu, id, victim, "alice", E("0.01"), 7);
      await toReveal(ntu, id);
      await expect(reveal(ntu, id, attacker, "alice", E("0.02"), 3)).to.be.revertedWithCustomError(ntu, "CommitmentMismatch");
      await expect(reveal(ntu, id, attacker, "alice", E("0.01"), 7)).to.be.revertedWithCustomError(ntu, "CommitmentMismatch");
    });
    it("15. accepts 100 commits (no cap)", async () => {
      const { ntu } = await fx();
      const id = await start(ntu);
      for (let i = 0; i < 100; i++) {
        const w = ethers.Wallet.createRandom().connect(ethers.provider);
        await ethers.provider.send("hardhat_setBalance", [w.address, "0x56BC75E2D63100000"]);
        await ntu.connect(w).commitBid(id, commitOf("alice", MIN, salt(i)), { value: D });
      }
      expect((await ntu.getAuction(id)).commitCount).to.equal(100);
    });
    it("16. commit tx calldata/events contain no plaintext domain or bid", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      const tx = await ntu.connect(users[0]).commitBid(id, commitOf("alice", E("0.0123"), salt(0)), { value: D });
      const data = tx.data.toLowerCase();
      expect(data).to.not.contain(ethers.hexlify(ethers.toUtf8Bytes("alice")).slice(2));
      expect(data).to.not.contain(ethers.toBeHex(E("0.0123"), 32).slice(2));
      const rc = await tx.wait();
      expect(rc!.logs[0].data.toLowerCase()).to.not.contain(ethers.hexlify(ethers.toUtf8Bytes("alice")).slice(2));
    });
  });

  describe("reveal", () => {
    it("17. accepts reveal exactly at commitDeadline", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", MIN, 0);
      await time.setNextBlockTimestamp((await ntu.getAuction(id)).commitDeadline);
      await reveal(ntu, id, users[0], "alice", MIN, 0);
      expect((await ntu.getBid(id, users[0].address)).revealed).to.equal(true);
    });
    it("18. rejects reveal at revealDeadline", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", MIN, 0);
      await time.setNextBlockTimestamp((await ntu.getAuction(id)).revealDeadline);
      await expect(reveal(ntu, id, users[0], "alice", MIN, 0)).to.be.revertedWithCustomError(ntu, "NotInRevealPhase");
    });
    it("19. mismatch reverts, later correct reveal succeeds", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", E("0.01"), 0);
      await toReveal(ntu, id);
      await expect(reveal(ntu, id, users[0], "alice", E("0.02"), 0)).to.be.revertedWithCustomError(ntu, "CommitmentMismatch");
      await expect(reveal(ntu, id, users[0], "alice", E("0.01"), 5)).to.be.revertedWithCustomError(ntu, "CommitmentMismatch");
      await reveal(ntu, id, users[0], "alice", E("0.01"), 0);
    });
    it("20. NoCommitment", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", MIN, 0);
      await toReveal(ntu, id);
      await expect(reveal(ntu, id, users[1], "alice", MIN, 0)).to.be.revertedWithCustomError(ntu, "NoCommitment");
    });
    it("21. AlreadyRevealed", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", MIN, 0);
      await toReveal(ntu, id); await reveal(ntu, id, users[0], "alice", MIN, 0);
      await expect(reveal(ntu, id, users[0], "alice", MIN, 0)).to.be.revertedWithCustomError(ntu, "AlreadyRevealed");
    });
    it("22. below minimum is ineligible and refundable at once", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", E("0.004"), 0);
      await toReveal(ntu, id);
      await expect(reveal(ntu, id, users[0], "alice", E("0.004"), 0)).to.emit(ntu, "BidRevealed").withArgs(id, users[0].address, "alice", E("0.004"), false, 3);
      expect(await ntu.canWithdraw(id, users[0].address)).to.equal(true);
      await checkInvariant(ntu);
    });
    it("23. invalid domain formats are ineligible InvalidDomain", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      const bad = ["Alice", "al", "a".repeat(33), "al-ice"];
      for (let i = 0; i < bad.length; i++) await commit(ntu, id, users[i], bad[i], MIN, i);
      await toReveal(ntu, id);
      for (let i = 0; i < bad.length; i++) {
        await reveal(ntu, id, users[i], bad[i], MIN, i);
        const b = await ntu.getBid(id, users[i].address);
        expect(b.eligible).to.equal(false);
        expect(b.reason).to.equal(1);
      }
    });
    it("24. wrong domain is ineligible WrongDomain and refundable", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "bob", MIN, 0);
      await toReveal(ntu, id); await reveal(ntu, id, users[0], "bob", MIN, 0);
      expect((await ntu.getBid(id, users[0].address)).reason).to.equal(2);
      expect(await ntu.canWithdraw(id, users[0].address)).to.equal(true);
    });
    it("25/26. exact minimum, 3-char and 32-char domains are eligible", async () => {
      const { ntu, users } = await fx();
      for (const [i, name] of ["abc", "a".repeat(32), "alice"].entries()) {
        const id = await start(ntu, name);
        await commit(ntu, id, users[i], name, MIN, i);
        await toReveal(ntu, id); await reveal(ntu, id, users[i], name, MIN, i);
        expect((await ntu.getBid(id, users[i].address)).eligible).to.equal(true);
      }
    });
  });

  describe("ranking and settlement", () => {
    async function threeBids() {
      const f = await fx();
      const { ntu, users } = f;
      const id = await start(ntu);
      const [A, B, Cc] = users;
      await commit(ntu, id, A, "alice", E("0.03"), 0);
      await commit(ntu, id, B, "alice", E("0.02"), 1);
      await commit(ntu, id, Cc, "alice", E("0.01"), 2);
      await toReveal(ntu, id);
      await reveal(ntu, id, A, "alice", E("0.03"), 0);
      await reveal(ntu, id, B, "alice", E("0.02"), 1);
      await reveal(ntu, id, Cc, "alice", E("0.01"), 2);
      return { ...f, id, A, B, Cc };
    }
    it("27. phase Settlement and offeree is highest", async () => {
      const { ntu, id, A } = await threeBids();
      await toSettlement(ntu, id);
      expect(await ntu.phaseOf(id)).to.equal(3);
      expect(await ntu.currentOfferee(id)).to.equal(A.address);
    });
    it("28. tie broken by earliest commit", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[1], "alice", E("0.02"), 1); // B commits first
      await commit(ntu, id, users[0], "alice", E("0.02"), 0);
      await toReveal(ntu, id);
      await reveal(ntu, id, users[0], "alice", E("0.02"), 0);
      await reveal(ntu, id, users[1], "alice", E("0.02"), 1);
      expect((await ntu.rankOf(id, users[1].address)).rank).to.equal(0);
      expect((await ntu.rankOf(id, users[0].address)).rank).to.equal(1);
    });
    it("29. NotYourTurn for rank 1 during offer 0", async () => {
      const { ntu, id, B } = await threeBids();
      await toSettlement(ntu, id);
      await expect(ntu.connect(B).payWinningBid(id, { value: E("0.015") })).to.be.revertedWithCustomError(ntu, "NotYourTurn");
    });
    it("30. winner pays exact amount; registers, resolves, primary", async () => {
      const { ntu, id, A } = await threeBids();
      await toSettlement(ntu, id);
      await expect(ntu.connect(A).payWinningBid(id, { value: E("0.025") }))
        .to.emit(ntu, "NameRegistered").and.to.emit(ntu, "AuctionSettled").and.to.emit(ntu, "PrimaryNameSet");
      expect(await ntu.resolve("alice")).to.equal(A.address);
      expect(await ntu.namesOf(A.address)).to.deep.equal(["alice"]);
      expect(await ntu.reverseResolve(A.address)).to.equal("alice");
      expect(await ntu.phaseOf(id)).to.equal(4);
      await checkInvariant(ntu);
    });
    it("31. wrong payment reverts", async () => {
      const { ntu, id, A } = await threeBids();
      await toSettlement(ntu, id);
      for (const v of ["0.026", "0.024"])
        await expect(ntu.connect(A).payWinningBid(id, { value: E(v) })).to.be.revertedWithCustomError(ntu, "WrongPayment");
    });
    it("32. bid == minBid allows value 0", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", MIN, 0);
      await toReveal(ntu, id); await reveal(ntu, id, users[0], "alice", MIN, 0);
      await toSettlement(ntu, id);
      await ntu.connect(users[0]).payWinningBid(id, { value: 0 });
      expect(await ntu.resolve("alice")).to.equal(users[0].address);
    });
    it("33. cascade: A defaults, B pays; A forfeits, C refunds", async () => {
      const { ntu, id, A, B, Cc } = await threeBids();
      const rd = (await ntu.getAuction(id)).revealDeadline;
      await time.setNextBlockTimestamp(rd + BigInt(S));
      await expect(ntu.connect(A).payWinningBid(id, { value: E("0.025") })).to.be.revertedWithCustomError(ntu, "NotYourTurn");
      await time.setNextBlockTimestamp(rd + BigInt(S) + 1n);
      expect(await ntu.currentOfferee(id)).to.equal(B.address);
      const before = await ntu.treasuryBalance();
      await ntu.connect(B).payWinningBid(id, { value: E("0.015") });
      expect((await ntu.treasuryBalance()) - before).to.equal(E("0.02") + D); // bid + 1 default
      expect(await ntu.canWithdraw(id, A.address)).to.equal(false);
      expect(await ntu.canWithdraw(id, B.address)).to.equal(false);
      expect(await ntu.canWithdraw(id, Cc.address)).to.equal(true);
      await checkInvariant(ntu);
    });
    it("34. nobody pays: Closed at rd+E*S, finalise forfeits, restart allowed", async () => {
      const { ntu, id } = await threeBids();
      const rd = (await ntu.getAuction(id)).revealDeadline;
      await time.setNextBlockTimestamp(rd + BigInt(3 * S));
      await ethers.provider.send("evm_mine", []);
      expect(await ntu.phaseOf(id)).to.equal(5);
      await expect(ntu.finalise(id)).to.emit(ntu, "AuctionClosed").withArgs(id, h("alice"), 3n * D);
      await checkInvariant(ntu);
      await ntu.startAuction(h("alice"));
    });
    it("35. settled auction cannot be paid again", async () => {
      const { ntu, id, A } = await threeBids();
      await toSettlement(ntu, id);
      await ntu.connect(A).payWinningBid(id, { value: E("0.025") });
      await expect(ntu.connect(A).payWinningBid(id, { value: E("0.025") })).to.be.revertedWithCustomError(ntu, "NotInSettlement");
    });
    it("36. NotEligible for ineligible or non-revealing caller", async () => {
      const { ntu, id, users } = await threeBids();
      await toSettlement(ntu, id);
      await expect(ntu.connect(users[5]).payWinningBid(id)).to.be.revertedWithCustomError(ntu, "NotEligible");
    });
  });

  describe("closure and edge cases", () => {
    it("37. zero commits: Closed at commitDeadline, restart immediate", async () => {
      const { ntu } = await fx();
      const id = await start(ntu);
      await time.increaseTo((await ntu.getAuction(id)).commitDeadline);
      expect(await ntu.phaseOf(id)).to.equal(5);
      await ntu.startAuction(h("alice"));
      expect(await ntu.auctionCount()).to.equal(2);
    });
    it("38. no eligible reveals: Closed at revealDeadline, non-revealers forfeit", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", E("0.01"), 0);
      await commit(ntu, id, users[1], "alice", E("0.01"), 1);
      await toSettlement(ntu, id);
      expect(await ntu.phaseOf(id)).to.equal(5);
      await ntu.finalise(id);
      expect(await ntu.treasuryBalance()).to.equal(2n * D);
      await checkInvariant(ntu);
    });
    it("39. finalise reverts when twice / when not closed", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await expect(ntu.finalise(id)).to.be.revertedWithCustomError(ntu, "NotClosed");
      await commit(ntu, id, users[0], "alice", MIN, 0);
      await toSettlement(ntu, id);
      await ntu.finalise(id);
      await expect(ntu.finalise(id)).to.be.revertedWithCustomError(ntu, "AlreadyFinalised");
    });
  });

  describe("deposits and treasury", () => {
    async function settledWithLosers() {
      const f = await fx();
      const { ntu, users } = f;
      const id = await start(ntu);
      const [A, B, X] = users;
      await commit(ntu, id, A, "alice", E("0.03"), 0);
      await commit(ntu, id, B, "alice", E("0.02"), 1);
      await commit(ntu, id, X, "alice", E("0.02"), 2); // never reveals
      await toReveal(ntu, id);
      await reveal(ntu, id, A, "alice", E("0.03"), 0);
      await reveal(ntu, id, B, "alice", E("0.02"), 1);
      await toSettlement(ntu, id);
      await ntu.connect(A).payWinningBid(id, { value: E("0.025") });
      return { ...f, id, A, B, X };
    }
    it("40. non-revealer can never withdraw; deposit is in treasury", async () => {
      const { ntu, id, X } = await settledWithLosers();
      await expect(ntu.connect(X).withdrawDeposit(id)).to.be.revertedWithCustomError(ntu, "NotWithdrawable");
      expect(await ntu.treasuryBalance()).to.equal(E("0.03") + D); // bid + 1 non-revealer
    });
    it("41. refundable bidder withdraws exactly D once", async () => {
      const { ntu, id, B } = await settledWithLosers();
      await expect(ntu.connect(B).withdrawDeposit(id)).to.changeEtherBalance(B, D);
      await expect(ntu.connect(B).withdrawDeposit(id)).to.be.revertedWithCustomError(ntu, "NotWithdrawable");
      await checkInvariant(ntu);
    });
    it("42. winner and defaulted bidder cannot withdraw", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      const [A, B] = users;
      await commit(ntu, id, A, "alice", E("0.03"), 0);
      await commit(ntu, id, B, "alice", E("0.02"), 1);
      await toReveal(ntu, id);
      await reveal(ntu, id, A, "alice", E("0.03"), 0);
      await reveal(ntu, id, B, "alice", E("0.02"), 1);
      await time.setNextBlockTimestamp((await ntu.getAuction(id)).revealDeadline + BigInt(S) + 1n);
      await ntu.connect(B).payWinningBid(id, { value: E("0.015") });
      await expect(ntu.connect(B).withdrawDeposit(id)).to.be.revertedWithCustomError(ntu, "NotWithdrawable");
      await expect(ntu.connect(A).withdrawDeposit(id)).to.be.revertedWithCustomError(ntu, "NotWithdrawable");
    });
    it("43. re-entrant withdraw is blocked, one D paid", async () => {
      const { ntu, users } = await fx();
      const atk = await (await ethers.getContractFactory("ReentrantBidder")).deploy(await ntu.getAddress());
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", E("0.03"), 0);
      await atk.commit(id, commitOf("alice", E("0.02"), salt(1)), { value: D });
      touched.push({ id, who: await atk.getAddress() });
      await toReveal(ntu, id);
      await reveal(ntu, id, users[0], "alice", E("0.03"), 0);
      await atk.reveal("alice", E("0.02"), salt(1));
      await toSettlement(ntu, id);
      await ntu.connect(users[0]).payWinningBid(id, { value: E("0.025") });
      const before = await ethers.provider.getBalance(await atk.getAddress());
      await atk.withdraw();
      expect(await atk.reentries()).to.equal(1);
      expect(await atk.reentryReverted()).to.equal(true);
      expect((await ethers.provider.getBalance(await atk.getAddress())) - before).to.equal(D);
      await checkInvariant(ntu);
    });
    it("44. treasury increases by bid + k*D + N*D", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      const [A, B, Cc, X, Y] = users;
      await commit(ntu, id, A, "alice", E("0.04"), 0);
      await commit(ntu, id, B, "alice", E("0.03"), 1);
      await commit(ntu, id, Cc, "alice", E("0.02"), 2);
      await commit(ntu, id, X, "alice", E("0.02"), 3);
      await commit(ntu, id, Y, "alice", E("0.02"), 4);
      await toReveal(ntu, id);
      for (const [u, b, n] of [[A, "0.04", 0], [B, "0.03", 1], [Cc, "0.02", 2]] as const) await reveal(ntu, id, u, "alice", E(b), n);
      await time.setNextBlockTimestamp((await ntu.getAuction(id)).revealDeadline + 2n * BigInt(S));
      await ntu.connect(Cc).payWinningBid(id, { value: E("0.015") }); // k=2, N=2
      expect(await ntu.treasuryBalance()).to.equal(E("0.02") + 2n * D + 2n * D);
      await checkInvariant(ntu);
    });
    it("45. anyone triggers withdrawTreasury; second call reverts", async () => {
      const { ntu, id, treasury, deployer } = await settledWithLosers();
      const bal = await ntu.treasuryBalance();
      await expect(ntu.connect(deployer).withdrawTreasury()).to.changeEtherBalance(treasury, bal);
      await expect(ntu.withdrawTreasury()).to.be.revertedWithCustomError(ntu, "NothingToWithdraw");
      await checkInvariant(ntu);
    });
    it("47. plain ETH send reverts", async () => {
      const { ntu, users } = await fx();
      await expect(users[0].sendTransaction({ to: await ntu.getAddress(), value: 1n })).to.be.reverted;
    });
  });

  describe("names, primary, resolution", () => {
    it("48. primary stays on first name until changed", async () => {
      const { ntu, users } = await fx();
      const A = users[0];
      for (const [i, name] of ["alice", "bob"].entries()) {
        const id = await start(ntu, name);
        await commit(ntu, id, A, name, MIN, i);
        await toReveal(ntu, id); await reveal(ntu, id, A, name, MIN, i);
        await toSettlement(ntu, id);
        await ntu.connect(A).payWinningBid(id);
      }
      expect(await ntu.reverseResolve(A.address)).to.equal("alice");
      await ntu.connect(A).setPrimaryName("bob");
      expect(await ntu.reverseResolve(A.address)).to.equal("bob");
      expect(await ntu.namesOf(A.address)).to.deep.equal(["alice", "bob"]);
    });
    it("49. setPrimaryName by non-owner reverts", async () => {
      const { ntu, users } = await fx();
      const id = await start(ntu);
      await commit(ntu, id, users[0], "alice", MIN, 0);
      await toReveal(ntu, id); await reveal(ntu, id, users[0], "alice", MIN, 0);
      await toSettlement(ntu, id);
      await ntu.connect(users[0]).payWinningBid(id);
      await expect(ntu.connect(users[1]).setPrimaryName("alice")).to.be.revertedWithCustomError(ntu, "NotOwner");
      await expect(ntu.connect(users[1]).setPrimaryName("nothere")).to.be.revertedWithCustomError(ntu, "NotOwner");
    });
    it("50. empty results for unknown names/addresses", async () => {
      const { ntu, users } = await fx();
      expect(await ntu.resolve("nobody")).to.equal(ethers.ZeroAddress);
      expect(await ntu.reverseResolve(users[0].address)).to.equal("");
    });
  });
});
