// Tests are labelled with the SPEC.md acceptance criterion they cover (AC<n>).
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { AbiCoder, Signer, hexlify, keccak256, parseEther, randomBytes, toUtf8Bytes, ZeroAddress } from "ethers";
import type { NtuNames } from "../typechain-types";
import vectorsFile from "../../shared/commitment-vectors.json";

const C = 180;
const R = 180;
const S = 180;
const D = parseEther("0.005");
const MIN = parseEther("0.005");

enum Phase { None, Commit, Reveal, Settlement, Settled, Closed }
enum Ineligibility { None, BelowMinimum, InvalidDomain, WrongDomain }

const nh = (domain: string) => keccak256(toUtf8Bytes(domain));

type Sealed = { domain: string; bid: bigint; salt: string; commitment: string };

function seal(domain: string, bid: string | bigint, salt = hexlify(randomBytes(32))): Sealed {
  const bidWei = typeof bid === "string" ? parseEther(bid) : bid;
  const commitment = keccak256(
    AbiCoder.defaultAbiCoder().encode(["string", "uint256", "bytes32"], [domain, bidWei, salt]),
  );
  return { domain, bid: bidWei, salt, commitment };
}

async function deployFixture() {
  const [deployer, treasury, alice, bob, carol, dave, eve] = await ethers.getSigners();
  const c = (await ethers.deployContract("NtuNames", [C, R, S, D, MIN, treasury.address])) as unknown as NtuNames;
  return { c, deployer, treasury, alice, bob, carol, dave, eve };
}

async function start(c: NtuNames, domain = "alice") {
  await c.startAuction(nh(domain));
  const id = await c.auctionCount();
  const a = await c.getAuction(id);
  return { id, cd: Number(a.commitDeadline), rd: Number(a.revealDeadline) };
}

async function commit(c: NtuNames, id: bigint, signer: Signer, domain: string, bid: string | bigint) {
  const s = seal(domain, bid);
  await c.connect(signer).commitBid(id, s.commitment, { value: D });
  return s;
}

const reveal = (c: NtuNames, id: bigint, signer: Signer, s: Sealed) =>
  c.connect(signer).revealBid(id, s.domain, s.bid, s.salt);

/** Alice bids 0.03, Bob 0.02, Carol 0.01 (committed in that order), all revealed. */
async function threeBiddersFixture() {
  const f = await deployFixture();
  const { c, alice, bob, carol } = f;
  const { id, cd, rd } = await start(c);
  const sa = await commit(c, id, alice, "alice", "0.03");
  const sb = await commit(c, id, bob, "alice", "0.02");
  const sc = await commit(c, id, carol, "alice", "0.01");
  await time.increaseTo(cd);
  await reveal(c, id, alice, sa);
  await reveal(c, id, bob, sb);
  await reveal(c, id, carol, sc);
  return { ...f, id, cd, rd, sa, sb, sc };
}

/** AC46: contract balance == treasuryBalance + all deposits that are still refundable. */
async function expectAccountingInvariant(c: NtuNames, entries: Array<[bigint, string]>) {
  let refundable = 0n;
  for (const [id, bidder] of entries) if (await c.canWithdraw(id, bidder)) refundable += D;
  const balance = await ethers.provider.getBalance(await c.getAddress());
  expect(balance).to.equal((await c.treasuryBalance()) + refundable);
}

describe("NtuNames", () => {
  describe("deployment", () => {
    it("AC1: reverts when minBid < deposit", async () => {
      const [, treasury] = await ethers.getSigners();
      const F = await ethers.getContractFactory("NtuNames");
      await expect(F.deploy(C, R, S, D, D - 1n, treasury.address)).to.be.revertedWithCustomError(F, "InvalidConfig");
    });

    it("AC2: reverts on zero duration, zero deposit or zero treasury", async () => {
      const [, treasury] = await ethers.getSigners();
      const F = await ethers.getContractFactory("NtuNames");
      const bad: Array<[number, number, number, bigint, bigint, string]> = [
        [0, R, S, D, MIN, treasury.address],
        [C, 0, S, D, MIN, treasury.address],
        [C, R, 0, D, MIN, treasury.address],
        [C, R, S, 0n, MIN, treasury.address],
        [C, R, S, D, MIN, ZeroAddress],
      ];
      for (const args of bad) await expect(F.deploy(...args)).to.be.revertedWithCustomError(F, "InvalidConfig");
    });

    it("exposes the configured parameters", async () => {
      const { c, treasury } = await loadFixture(deployFixture);
      expect(await c.commitDuration()).to.equal(C);
      expect(await c.revealDuration()).to.equal(R);
      expect(await c.settlementDuration()).to.equal(S);
      expect(await c.deposit()).to.equal(D);
      expect(await c.minBid()).to.equal(MIN);
      expect(await c.treasury()).to.equal(treasury.address);
    });
  });

  describe("startAuction", () => {
    it("AC3: opens auction 1 in Commit with C/R deadlines and emits AuctionStarted", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      const t = (await time.latest()) + 10;
      await time.setNextBlockTimestamp(t);
      await expect(c.connect(alice).startAuction(nh("alice")))
        .to.emit(c, "AuctionStarted")
        .withArgs(1, nh("alice"), alice.address, t + C, t + C + R);
      const a = await c.getAuction(1);
      expect(a.commitDeadline).to.equal(t + C);
      expect(a.revealDeadline).to.equal(t + C + R);
      expect(a.phase).to.equal(Phase.Commit);
      expect(await c.activeAuctionOf(nh("alice"))).to.equal(1);
    });

    it("AC4: reverts AuctionActive during Commit, Reveal and Settlement", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      const { id, cd, rd } = await start(c);
      await expect(c.startAuction(nh("alice"))).to.be.revertedWithCustomError(c, "AuctionActive");
      const s = await commit(c, id, alice, "alice", "0.01");
      await time.increaseTo(cd);
      await expect(c.startAuction(nh("alice"))).to.be.revertedWithCustomError(c, "AuctionActive");
      await reveal(c, id, alice, s);
      await time.increaseTo(rd);
      await expect(c.startAuction(nh("alice"))).to.be.revertedWithCustomError(c, "AuctionActive");
    });

    it("AC5: reverts NameAlreadyRegistered for a registered domain", async () => {
      const { c, alice, rd, sa } = await loadFixture(threeBiddersFixture);
      await time.increaseTo(rd);
      await c.connect(alice).payWinningBid(1, { value: sa.bid - D });
      await expect(c.startAuction(nh("alice"))).to.be.revertedWithCustomError(c, "NameAlreadyRegistered");
    });

    it("AC6: reverts ZeroHash", async () => {
      const { c } = await loadFixture(deployFixture);
      await expect(c.startAuction(ethers.ZeroHash)).to.be.revertedWithCustomError(c, "ZeroHash");
    });

    it("AC7: auto-finalises a closed auction and opens a new one in the same transaction", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      const { id, rd } = await start(c);
      await commit(c, id, alice, "alice", "0.01"); // never revealed
      await time.increaseTo(rd);
      expect(await c.phaseOf(id)).to.equal(Phase.Closed);
      await expect(c.startAuction(nh("alice")))
        .to.emit(c, "AuctionClosed")
        .withArgs(id, nh("alice"), D)
        .and.to.emit(c, "AuctionStarted");
      expect(await c.auctionCount()).to.equal(2);
      expect((await c.getAuction(id)).finalised).to.equal(true);
      expect(await c.treasuryBalance()).to.equal(D);
      expect(await c.activeAuctionOf(nh("alice"))).to.equal(2);
    });
  });

  describe("commitBid", () => {
    it("AC8: stores the bid with the next commitIndex and marks the commitment used", async () => {
      const { c, alice, bob } = await loadFixture(deployFixture);
      const { id } = await start(c);
      const s1 = seal("alice", "0.01");
      const s2 = seal("alice", "0.02");
      await expect(c.connect(alice).commitBid(id, s1.commitment, { value: D }))
        .to.emit(c, "BidCommitted")
        .withArgs(id, alice.address, s1.commitment, 0);
      await expect(c.connect(bob).commitBid(id, s2.commitment, { value: D }))
        .to.emit(c, "BidCommitted")
        .withArgs(id, bob.address, s2.commitment, 1);
      const b = await c.getBid(id, bob.address);
      expect(b.commitment).to.equal(s2.commitment);
      expect(b.commitIndex).to.equal(1);
      expect(await c.isCommitmentUsed(s1.commitment)).to.equal(true);
      expect((await c.getAuction(id)).commitCount).to.equal(2);
    });

    it("AC9: reverts WrongDeposit when msg.value != deposit", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      const { id } = await start(c);
      const s = seal("alice", "0.01");
      for (const value of [0n, D - 1n, D + 1n])
        await expect(c.connect(alice).commitBid(id, s.commitment, { value })).to.be.revertedWithCustomError(
          c,
          "WrongDeposit",
        );
    });

    it("AC10: accepts a commit at commitDeadline-1 and rejects one at commitDeadline", async () => {
      const { c, alice, bob } = await loadFixture(deployFixture);
      const { id, cd } = await start(c);
      await time.setNextBlockTimestamp(cd - 1);
      await c.connect(alice).commitBid(id, seal("alice", "0.01").commitment, { value: D });
      await time.setNextBlockTimestamp(cd);
      await expect(
        c.connect(bob).commitBid(id, seal("alice", "0.01").commitment, { value: D }),
      ).to.be.revertedWithCustomError(c, "NotInCommitPhase");
    });

    it("rejects commits to a non-existent auction", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      await expect(
        c.connect(alice).commitBid(99, seal("alice", "0.01").commitment, { value: D }),
      ).to.be.revertedWithCustomError(c, "NotInCommitPhase");
    });

    it("AC11: reverts AlreadyCommitted on a second commit from the same address", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      const { id } = await start(c);
      await commit(c, id, alice, "alice", "0.01");
      await expect(
        c.connect(alice).commitBid(id, seal("alice", "0.02").commitment, { value: D }),
      ).to.be.revertedWithCustomError(c, "AlreadyCommitted");
    });

    it("AC12: reverts CommitmentUsed for a reused commitment, in any auction", async () => {
      const { c, alice, bob } = await loadFixture(deployFixture);
      const { id } = await start(c);
      const s = await commit(c, id, alice, "alice", "0.01");
      await expect(c.connect(bob).commitBid(id, s.commitment, { value: D })).to.be.revertedWithCustomError(
        c,
        "CommitmentUsed",
      );
      const other = await start(c, "bob");
      await expect(c.connect(alice).commitBid(other.id, s.commitment, { value: D })).to.be.revertedWithCustomError(
        c,
        "CommitmentUsed",
      );
    });

    it("AC13: reverts ZeroCommitment", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      const { id } = await start(c);
      await expect(c.connect(alice).commitBid(id, ethers.ZeroHash, { value: D })).to.be.revertedWithCustomError(
        c,
        "ZeroCommitment",
      );
    });

    it("AC14: a front-run copy blocks only one attempt; the victim recommits and the copier cannot reveal", async () => {
      const { c, alice, eve } = await loadFixture(deployFixture);
      const { id, cd } = await start(c);
      const x = seal("alice", "0.01");
      await c.connect(eve).commitBid(id, x.commitment, { value: D }); // eve copies X from the mempool first
      await expect(c.connect(alice).commitBid(id, x.commitment, { value: D })).to.be.revertedWithCustomError(
        c,
        "CommitmentUsed",
      );
      const x2 = await commit(c, id, alice, "alice", "0.01");
      await time.increaseTo(cd);
      await reveal(c, id, alice, x2);
      // Eve only knows X, not its salt; guesses (even using alice's now-public X2 values) fail.
      await expect(reveal(c, id, eve, x2)).to.be.revertedWithCustomError(c, "CommitmentMismatch");
      await expect(reveal(c, id, eve, seal("alice", "0.01"))).to.be.revertedWithCustomError(c, "CommitmentMismatch");
    });

    it("AC15: accepts 100 commits from distinct addresses (no cap)", async () => {
      const { c } = await loadFixture(deployFixture);
      const { id } = await start(c);
      for (let i = 0; i < 100; i++) {
        const w = ethers.Wallet.createRandom().connect(ethers.provider);
        await setBalance(w.address, parseEther("1"));
        await c.connect(w).commitBid(id, seal("alice", "0.01").commitment, { value: D });
      }
      expect((await c.getAuction(id)).commitCount).to.equal(100);
    });

    it("AC16: commit calldata and events contain no plaintext domain or bid", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      const { id } = await start(c, "secretname");
      const s = seal("secretname", "0.0421");
      const tx = await c.connect(alice).commitBid(id, s.commitment, { value: D });
      const receipt = (await tx.wait())!;
      const domainHex = hexlify(toUtf8Bytes("secretname")).slice(2);
      const bidHex = s.bid.toString(16).padStart(64, "0");
      const blobs = [tx.data, ...receipt.logs.map((l) => l.data + l.topics.join(""))].map((x) => x.toLowerCase());
      for (const blob of blobs) {
        expect(blob).to.not.include(domainHex);
        expect(blob).to.not.include(bidHex);
      }
    });
  });

  describe("revealBid", () => {
    async function committedFixture() {
      const f = await deployFixture();
      const { id, cd, rd } = await start(f.c);
      const s = await commit(f.c, id, f.alice, "alice", "0.01");
      return { ...f, id, cd, rd, s };
    }

    it("AC17: accepts a matching reveal at exactly commitDeadline", async () => {
      const { c, alice, id, cd, s } = await loadFixture(committedFixture);
      await time.setNextBlockTimestamp(cd);
      await expect(reveal(c, id, alice, s))
        .to.emit(c, "BidRevealed")
        .withArgs(id, alice.address, "alice", s.bid, true, Ineligibility.None);
    });

    it("AC18: rejects a reveal at exactly revealDeadline (and accepts at revealDeadline-1)", async () => {
      const { c, alice, bob, id, rd, s } = await loadFixture(committedFixture);
      const sb = await commit(c, id, bob, "alice", "0.02");
      await time.setNextBlockTimestamp(rd - 1);
      await reveal(c, id, bob, sb);
      await time.setNextBlockTimestamp(rd);
      await expect(reveal(c, id, alice, s)).to.be.revertedWithCustomError(c, "NotInRevealPhase");
    });

    it("rejects a reveal during the commit phase", async () => {
      const { c, alice, id, s } = await loadFixture(committedFixture);
      await expect(reveal(c, id, alice, s)).to.be.revertedWithCustomError(c, "NotInRevealPhase");
    });

    it("AC19: a mismatching reveal reverts and a later correct reveal succeeds", async () => {
      const { c, alice, id, cd, s } = await loadFixture(committedFixture);
      await time.increaseTo(cd);
      await expect(reveal(c, id, alice, { ...s, bid: s.bid + 1n })).to.be.revertedWithCustomError(
        c,
        "CommitmentMismatch",
      );
      await expect(reveal(c, id, alice, { ...s, salt: hexlify(randomBytes(32)) })).to.be.revertedWithCustomError(
        c,
        "CommitmentMismatch",
      );
      await expect(reveal(c, id, alice, s)).to.emit(c, "BidRevealed");
    });

    it("AC20: reverts NoCommitment for an address that never committed", async () => {
      const { c, bob, id, cd, s } = await loadFixture(committedFixture);
      await time.increaseTo(cd);
      await expect(reveal(c, id, bob, s)).to.be.revertedWithCustomError(c, "NoCommitment");
    });

    it("AC21: reverts AlreadyRevealed on a duplicate reveal", async () => {
      const { c, alice, id, cd, s } = await loadFixture(committedFixture);
      await time.increaseTo(cd);
      await reveal(c, id, alice, s);
      await expect(reveal(c, id, alice, s)).to.be.revertedWithCustomError(c, "AlreadyRevealed");
    });

    it("AC22: a bid below the minimum is ineligible (BelowMinimum) and refundable immediately", async () => {
      const { c, bob, id, cd } = await loadFixture(committedFixture);
      const s = await commit(c, id, bob, "alice", "0.004");
      await time.increaseTo(cd);
      await expect(reveal(c, id, bob, s))
        .to.emit(c, "BidRevealed")
        .withArgs(id, bob.address, "alice", s.bid, false, Ineligibility.BelowMinimum);
      expect(await c.canWithdraw(id, bob.address)).to.equal(true);
      await expect(c.connect(bob).withdrawDeposit(id)).to.changeEtherBalance(bob, D);
    });

    it("AC23: invalid domain formats are ineligible (InvalidDomain)", async () => {
      const { c, id, cd } = await loadFixture(committedFixture);
      const signers = (await ethers.getSigners()).slice(10);
      const bad = ["Alice", "al", "a".repeat(33), "al-ice", "alice.ntu", "alicé"];
      const sealed = [];
      for (let i = 0; i < bad.length; i++) sealed.push(await commit(c, id, signers[i], bad[i], "0.01"));
      await time.increaseTo(cd);
      for (let i = 0; i < bad.length; i++) {
        await expect(reveal(c, id, signers[i], sealed[i]))
          .to.emit(c, "BidRevealed")
          .withArgs(id, signers[i].address, bad[i], sealed[i].bid, false, Ineligibility.InvalidDomain);
        expect(await c.canWithdraw(id, signers[i].address)).to.equal(true);
      }
    });

    it("AC24: a valid domain that is not this auction's is ineligible (WrongDomain) and refundable", async () => {
      const { c, bob, id, cd } = await loadFixture(committedFixture);
      const s = await commit(c, id, bob, "bob", "0.5");
      await time.increaseTo(cd);
      await expect(reveal(c, id, bob, s))
        .to.emit(c, "BidRevealed")
        .withArgs(id, bob.address, "bob", s.bid, false, Ineligibility.WrongDomain);
      await expect(c.connect(bob).withdrawDeposit(id)).to.changeEtherBalance(bob, D);
    });

    it("AC25: a bid of exactly the minimum is eligible", async () => {
      const { c, bob, id, cd } = await loadFixture(committedFixture);
      const s = await commit(c, id, bob, "alice", MIN);
      await time.increaseTo(cd);
      await expect(reveal(c, id, bob, s))
        .to.emit(c, "BidRevealed")
        .withArgs(id, bob.address, "alice", MIN, true, Ineligibility.None);
      expect(await c.canWithdraw(id, bob.address)).to.equal(false);
    });

    it("AC26: 3- and 32-character domains are eligible", async () => {
      const { c, alice, bob } = await loadFixture(deployFixture);
      for (const [domain, signer] of [["abc", alice], ["a1".repeat(16), bob]] as const) {
        const { id, cd } = await start(c, domain);
        const s = await commit(c, id, signer, domain, "0.01");
        await time.increaseTo(cd);
        await reveal(c, id, signer, s);
        expect((await c.getBid(id, signer.address)).eligible).to.equal(true);
      }
    });

    it("AC51 (contract side): every shared commitment vector commits and reveals successfully", async () => {
      const { c } = await loadFixture(deployFixture);
      const signers = await ethers.getSigners();
      for (const [i, v] of vectorsFile.vectors.entries()) {
        expect(nh(v.domain)).to.equal(v.nameHash);
        const { id, cd } = await start(c, v.domain);
        await c.connect(signers[i + 2]).commitBid(id, v.commitment, { value: D });
        await time.increaseTo(cd);
        await expect(c.connect(signers[i + 2]).revealBid(id, v.domain, v.bidWei, v.salt))
          .to.emit(c, "BidRevealed")
          .withArgs(id, signers[i + 2].address, v.domain, v.bidWei, true, Ineligibility.None);
      }
    });
  });

  describe("ranking and settlement", () => {
    it("AC27: at revealDeadline the phase is Settlement and the top bidder is the offeree", async () => {
      const { c, alice, bob, carol, id, rd } = await loadFixture(threeBiddersFixture);
      expect(await c.currentOfferee(id)).to.equal(ZeroAddress);
      await time.increaseTo(rd);
      expect(await c.phaseOf(id)).to.equal(Phase.Settlement);
      expect(await c.currentOfferee(id)).to.equal(alice.address);
      const ranks = await Promise.all([alice, bob, carol].map((s) => c.rankOf(id, s.address)));
      expect(ranks.map((r) => r.rank)).to.deep.equal([0n, 1n, 2n]);
      expect(ranks[1].windowStart).to.equal(rd + S);
      expect(ranks[1].windowEnd).to.equal(rd + 2 * S);
      expect(await c.amountDue(id, alice.address)).to.equal(parseEther("0.025"));
    });

    it("AC28: equal bids are ranked by earliest commit", async () => {
      const { c, alice, bob } = await loadFixture(deployFixture);
      const { id, cd, rd } = await start(c);
      const sb = await commit(c, id, bob, "alice", "0.02"); // bob commits first
      const sa = await commit(c, id, alice, "alice", "0.02");
      await time.increaseTo(cd);
      await reveal(c, id, alice, sa); // alice reveals first: reveal order must not matter
      await reveal(c, id, bob, sb);
      expect((await c.rankOf(id, bob.address)).rank).to.equal(0);
      expect((await c.rankOf(id, alice.address)).rank).to.equal(1);
      await time.increaseTo(rd);
      expect(await c.currentOfferee(id)).to.equal(bob.address);
    });

    it("AC29: a lower-ranked bidder cannot pay during the top bidder's window", async () => {
      const { c, bob, id, rd, sb } = await loadFixture(threeBiddersFixture);
      await time.setNextBlockTimestamp(rd);
      await expect(c.connect(bob).payWinningBid(id, { value: sb.bid - D })).to.be.revertedWithCustomError(
        c,
        "NotYourTurn",
      );
    });

    it("AC30: the top bidder pays bid-deposit at revealDeadline and the domain is registered", async () => {
      const { c, alice, id, rd, sa } = await loadFixture(threeBiddersFixture);
      await time.setNextBlockTimestamp(rd);
      await expect(c.connect(alice).payWinningBid(id, { value: parseEther("0.025") }))
        .to.emit(c, "NameRegistered")
        .withArgs(nh("alice"), "alice", alice.address, id, sa.bid)
        .and.to.emit(c, "AuctionSettled")
        .withArgs(id, alice.address, sa.bid, 0)
        .and.to.emit(c, "PrimaryNameSet")
        .withArgs(alice.address, "alice");
      expect(await c.resolve("alice")).to.equal(alice.address);
      expect(await c.ownerOf("alice")).to.equal(alice.address);
      expect(await c.domainOf(nh("alice"))).to.equal("alice");
      expect(await c.namesOf(alice.address)).to.deep.equal(["alice"]);
      expect(await c.reverseResolve(alice.address)).to.equal("alice");
      expect(await c.phaseOf(id)).to.equal(Phase.Settled);
      expect(await c.activeAuctionOf(nh("alice"))).to.equal(0);
    });

    it("AC30: the top bidder can still pay at the last second of its window", async () => {
      const { c, alice, id, rd, sa } = await loadFixture(threeBiddersFixture);
      await time.setNextBlockTimestamp(rd + S - 1);
      await expect(c.connect(alice).payWinningBid(id, { value: sa.bid - D })).to.emit(c, "AuctionSettled");
    });

    it("AC31: payment must be exact", async () => {
      const { c, alice, id, rd } = await loadFixture(threeBiddersFixture);
      await time.increaseTo(rd);
      for (const value of [parseEther("0.026"), parseEther("0.024"), 0n])
        await expect(c.connect(alice).payWinningBid(id, { value })).to.be.revertedWithCustomError(c, "WrongPayment");
    });

    it("AC32: a winner who bid exactly the minimum pays 0 ETH", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      const { id, cd, rd } = await start(c);
      const s = await commit(c, id, alice, "alice", MIN);
      await time.increaseTo(cd);
      await reveal(c, id, alice, s);
      await time.increaseTo(rd);
      await expect(c.connect(alice).payWinningBid(id, { value: 0 })).to.emit(c, "NameRegistered");
      expect(await c.treasuryBalance()).to.equal(MIN);
    });

    it("AC33: after the top bidder defaults, the runner-up pays and lower bids become refundable", async () => {
      const { c, alice, bob, carol, eve, id, rd, sb } = await loadFixture(threeBiddersFixture);
      await time.setNextBlockTimestamp(rd + S);
      await expect(c.connect(alice).payWinningBid(id, { value: parseEther("0.025") })).to.be.revertedWithCustomError(
        c,
        "NotYourTurn",
      );
      expect(await c.currentOfferee(id)).to.equal(bob.address);
      await expect(c.connect(bob).payWinningBid(id, { value: parseEther("0.015") }))
        .to.emit(c, "AuctionSettled")
        .withArgs(id, bob.address, sb.bid, 1);
      expect(await c.resolve("alice")).to.equal(bob.address);
      expect(await c.canWithdraw(id, alice.address)).to.equal(false); // defaulted: forfeited
      expect(await c.canWithdraw(id, bob.address)).to.equal(false); // winner: credited to price
      expect(await c.canWithdraw(id, carol.address)).to.equal(true);
      expect(await c.canWithdraw(id, eve.address)).to.equal(false); // never bid
      // treasury = winning bid + 1 defaulted deposit + 0 unrevealed
      expect(await c.treasuryBalance()).to.equal(sb.bid + D);
      await expectAccountingInvariant(c, [alice, bob, carol].map((s) => [id, s.address] as [bigint, string]));
    });

    it("AC34: if nobody pays, the auction closes at revealDeadline + E*S and can be restarted", async () => {
      const { c, alice, bob, carol, id, rd } = await loadFixture(threeBiddersFixture);
      await time.setNextBlockTimestamp(rd + 3 * S - 1);
      await expect(c.finalise(id)).to.be.revertedWithCustomError(c, "NotClosed");
      await time.setNextBlockTimestamp(rd + 3 * S);
      await expect(c.connect(carol).payWinningBid(id, { value: parseEther("0.005") })).to.be.revertedWithCustomError(
        c,
        "NotInSettlement",
      );
      await time.setNextBlockTimestamp(rd + 3 * S + 1);
      await expect(c.finalise(id)).to.emit(c, "AuctionClosed").withArgs(id, nh("alice"), 3n * D);
      expect(await c.treasuryBalance()).to.equal(3n * D);
      for (const s of [alice, bob, carol]) expect(await c.canWithdraw(id, s.address)).to.equal(false);
      await expectAccountingInvariant(c, [alice, bob, carol].map((s) => [id, s.address] as [bigint, string]));
      await expect(c.startAuction(nh("alice"))).to.emit(c, "AuctionStarted");
    });

    it("AC35: a settled auction cannot be paid again", async () => {
      const { c, alice, bob, id, rd, sa, sb } = await loadFixture(threeBiddersFixture);
      await time.increaseTo(rd);
      await c.connect(alice).payWinningBid(id, { value: sa.bid - D });
      await expect(c.connect(alice).payWinningBid(id, { value: sa.bid - D })).to.be.revertedWithCustomError(
        c,
        "NotInSettlement",
      );
      await time.increaseTo(rd + S);
      await expect(c.connect(bob).payWinningBid(id, { value: sb.bid - D })).to.be.revertedWithCustomError(
        c,
        "NotInSettlement",
      );
    });

    it("AC36: ineligible and non-revealing addresses cannot pay", async () => {
      const { c, alice, bob, carol, dave } = await loadFixture(deployFixture);
      const { id, cd, rd } = await start(c);
      const sa = await commit(c, id, alice, "alice", "0.01");
      const sb = await commit(c, id, bob, "alice", "0.001"); // below minimum
      await commit(c, id, carol, "alice", "0.05"); // never revealed
      await time.increaseTo(cd);
      await reveal(c, id, alice, sa);
      await reveal(c, id, bob, sb);
      await time.increaseTo(rd);
      for (const s of [bob, carol, dave])
        await expect(c.connect(s).payWinningBid(id, { value: 0 })).to.be.revertedWithCustomError(c, "NotEligible");
      await expect(c.rankOf(id, carol.address)).to.be.revertedWithCustomError(c, "NotEligible");
    });
  });

  describe("closure edge cases", () => {
    it("AC37: an auction with zero commits closes at commitDeadline and can be restarted immediately", async () => {
      const { c } = await loadFixture(deployFixture);
      const { id, cd } = await start(c);
      await time.setNextBlockTimestamp(cd - 1);
      await expect(c.startAuction(nh("alice"))).to.be.revertedWithCustomError(c, "AuctionActive");
      await time.setNextBlockTimestamp(cd);
      await expect(c.startAuction(nh("alice")))
        .to.emit(c, "AuctionClosed")
        .withArgs(id, nh("alice"), 0)
        .and.to.emit(c, "AuctionStarted");
      expect(await c.phaseOf(id)).to.equal(Phase.Closed);
    });

    it("AC38: commits with zero eligible reveals close at revealDeadline; finalise forfeits unrevealed deposits", async () => {
      const { c, alice, bob, carol } = await loadFixture(deployFixture);
      const { id, cd, rd } = await start(c);
      await commit(c, id, alice, "alice", "0.01"); // unrevealed
      await commit(c, id, bob, "alice", "0.02"); // unrevealed
      const sc = await commit(c, id, carol, "alice", "0.001"); // ineligible
      await time.increaseTo(cd);
      await reveal(c, id, carol, sc);
      await time.setNextBlockTimestamp(rd - 1);
      await expect(c.finalise(id)).to.be.revertedWithCustomError(c, "NotClosed");
      await time.setNextBlockTimestamp(rd);
      await expect(c.finalise(id)).to.emit(c, "AuctionClosed").withArgs(id, nh("alice"), 2n * D);
      expect(await c.canWithdraw(id, carol.address)).to.equal(true);
      await expectAccountingInvariant(c, [alice, bob, carol].map((s) => [id, s.address] as [bigint, string]));
    });

    it("AC39: finalise twice reverts AlreadyFinalised; finalise on a live auction reverts NotClosed", async () => {
      const { c } = await loadFixture(deployFixture);
      const { id, cd } = await start(c);
      await expect(c.finalise(id)).to.be.revertedWithCustomError(c, "NotClosed");
      await expect(c.finalise(42)).to.be.revertedWithCustomError(c, "NotClosed");
      await time.increaseTo(cd);
      await c.finalise(id);
      await expect(c.finalise(id)).to.be.revertedWithCustomError(c, "AlreadyFinalised");
      expect(await c.activeAuctionOf(nh("alice"))).to.equal(0);
    });

    it("finalise on a settled auction reverts NotClosed", async () => {
      const { c, alice, id, rd, sa } = await loadFixture(threeBiddersFixture);
      await time.increaseTo(rd);
      await c.connect(alice).payWinningBid(id, { value: sa.bid - D });
      await expect(c.finalise(id)).to.be.revertedWithCustomError(c, "NotClosed");
    });
  });

  describe("deposits and treasury", () => {
    it("AC40: a bidder who never revealed can never withdraw; the deposit goes to the treasury", async () => {
      const { c, alice, bob } = await loadFixture(deployFixture);
      const { id, cd, rd } = await start(c);
      const sa = await commit(c, id, alice, "alice", "0.01");
      await commit(c, id, bob, "alice", "0.05"); // bob never reveals
      await time.increaseTo(cd);
      await reveal(c, id, alice, sa);
      await expect(c.connect(bob).withdrawDeposit(id)).to.be.revertedWithCustomError(c, "NotWithdrawable");
      await time.increaseTo(rd);
      await c.connect(alice).payWinningBid(id, { value: sa.bid - D });
      await expect(c.connect(bob).withdrawDeposit(id)).to.be.revertedWithCustomError(c, "NotWithdrawable");
      expect(await c.treasuryBalance()).to.equal(sa.bid + D);
      await expectAccountingInvariant(c, [[id, alice.address], [id, bob.address]]);
    });

    it("AC41: a refundable bidder withdraws exactly the deposit once", async () => {
      const { c, alice, carol, id, rd, sa } = await loadFixture(threeBiddersFixture);
      await time.increaseTo(rd);
      await c.connect(alice).payWinningBid(id, { value: sa.bid - D });
      const tx = c.connect(carol).withdrawDeposit(id);
      await expect(tx).to.emit(c, "DepositWithdrawn").withArgs(id, carol.address, D);
      await expect(tx).to.changeEtherBalances([carol, c], [D, -D]);
      await expect(c.connect(carol).withdrawDeposit(id)).to.be.revertedWithCustomError(c, "NotWithdrawable");
      expect((await c.getBid(id, carol.address)).withdrawn).to.equal(true);
    });

    it("AC42: neither the winner nor a defaulted higher bidder can withdraw", async () => {
      const { c, alice, bob, carol, id, rd, sb } = await loadFixture(threeBiddersFixture);
      await time.increaseTo(rd + S);
      await c.connect(bob).payWinningBid(id, { value: sb.bid - D });
      await expect(c.connect(bob).withdrawDeposit(id)).to.be.revertedWithCustomError(c, "NotWithdrawable");
      await expect(c.connect(alice).withdrawDeposit(id)).to.be.revertedWithCustomError(c, "NotWithdrawable");
      await expect(c.connect(carol).withdrawDeposit(id)).to.changeEtherBalance(carol, D);
    });

    it("eligible losers cannot withdraw before someone pays", async () => {
      const { c, carol, id, rd } = await loadFixture(threeBiddersFixture);
      await time.increaseTo(rd);
      await expect(c.connect(carol).withdrawDeposit(id)).to.be.revertedWithCustomError(c, "NotWithdrawable");
    });

    it("AC43: re-entering withdrawDeposit from the refund callback fails and pays only once", async () => {
      const { c } = await loadFixture(deployFixture);
      const attacker = await ethers.deployContract("ReentrantBidder", [await c.getAddress()]);
      const { id, cd } = await start(c);
      const s = seal("alice", "0.001"); // ineligible -> refundable right after reveal
      await attacker.commit(id, s.commitment, { value: D });
      await time.increaseTo(cd);
      await attacker.reveal(s.domain, s.bid, s.salt);
      await expect(attacker.withdraw()).to.changeEtherBalances([attacker, c], [D, -D]);
      expect(await attacker.reentryAttempted()).to.equal(true);
      expect(await attacker.reentryFailed()).to.equal(true);
    });

    it("AC44: treasury accrues bid + k*deposit + unrevealed deposits when rank k pays", async () => {
      const { c, alice, bob, carol, dave } = await loadFixture(deployFixture);
      const { id, cd, rd } = await start(c);
      const sa = await commit(c, id, alice, "alice", "0.04");
      const sb = await commit(c, id, bob, "alice", "0.03");
      const sc = await commit(c, id, carol, "alice", "0.02");
      await commit(c, id, dave, "alice", "0.9"); // unrevealed
      await time.increaseTo(cd);
      for (const [s, x] of [[alice, sa], [bob, sb], [carol, sc]] as const) await reveal(c, id, s, x);
      await time.increaseTo(rd + 2 * S);
      await c.connect(carol).payWinningBid(id, { value: sc.bid - D });
      expect(await c.treasuryBalance()).to.equal(sc.bid + 2n * D + 1n * D);
      await expectAccountingInvariant(
        c,
        [alice, bob, carol, dave].map((s) => [id, s.address] as [bigint, string]),
      );
    });

    it("AC45: anyone can send accrued revenue to the treasury; a second call reverts", async () => {
      const { c, alice, treasury, eve, id, rd, sa } = await loadFixture(threeBiddersFixture);
      await expect(c.connect(eve).withdrawTreasury()).to.be.revertedWithCustomError(c, "NothingToWithdraw");
      await time.increaseTo(rd);
      await c.connect(alice).payWinningBid(id, { value: sa.bid - D });
      const tx = c.connect(eve).withdrawTreasury();
      await expect(tx).to.emit(c, "TreasuryWithdrawn").withArgs(treasury.address, sa.bid);
      await expect(tx).to.changeEtherBalances([treasury, c], [sa.bid, -sa.bid]);
      expect(await c.treasuryBalance()).to.equal(0);
      await expect(c.connect(eve).withdrawTreasury()).to.be.revertedWithCustomError(c, "NothingToWithdraw");
    });

    it("AC46: accounting invariant holds through refunds and treasury withdrawal", async () => {
      const { c, alice, bob, carol, id, rd, sa } = await loadFixture(threeBiddersFixture);
      const entries = [alice, bob, carol].map((s) => [id, s.address] as [bigint, string]);
      await time.increaseTo(rd);
      await c.connect(alice).payWinningBid(id, { value: sa.bid - D });
      await expectAccountingInvariant(c, entries);
      await c.connect(bob).withdrawDeposit(id);
      await expectAccountingInvariant(c, entries);
      await c.withdrawTreasury();
      await expectAccountingInvariant(c, entries);
      await c.connect(carol).withdrawDeposit(id);
      expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(0);
    });

    it("AC47: plain ETH transfers to the contract revert", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      await expect(alice.sendTransaction({ to: await c.getAddress(), value: 1n })).to.be.reverted;
    });
  });

  describe("names, primary name and resolution", () => {
    async function win(c: NtuNames, signer: Signer, domain: string) {
      const { id, cd, rd } = await start(c, domain);
      const s = await commit(c, id, signer, domain, "0.01");
      await time.increaseTo(cd);
      await reveal(c, id, signer, s);
      await time.increaseTo(rd);
      await c.connect(signer).payWinningBid(id, { value: s.bid - D });
    }

    it("AC48: the first name becomes primary, later names do not, and setPrimaryName switches it", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      await win(c, alice, "alice");
      await win(c, alice, "bob");
      expect(await c.reverseResolve(alice.address)).to.equal("alice");
      expect(await c.namesOf(alice.address)).to.deep.equal(["alice", "bob"]);
      await expect(c.connect(alice).setPrimaryName("bob")).to.emit(c, "PrimaryNameSet").withArgs(alice.address, "bob");
      expect(await c.reverseResolve(alice.address)).to.equal("bob");
    });

    it("AC49: setPrimaryName reverts NotOwner for someone else's or an unregistered domain", async () => {
      const { c, alice, bob } = await loadFixture(deployFixture);
      await win(c, alice, "alice");
      await expect(c.connect(bob).setPrimaryName("alice")).to.be.revertedWithCustomError(c, "NotOwner");
      await expect(c.connect(bob).setPrimaryName("nobody")).to.be.revertedWithCustomError(c, "NotOwner");
    });

    it("AC50: unregistered lookups return the zero address / empty string", async () => {
      const { c, alice } = await loadFixture(deployFixture);
      expect(await c.resolve("nobody")).to.equal(ZeroAddress);
      expect(await c.ownerOf("nobody")).to.equal(ZeroAddress);
      expect(await c.reverseResolve(alice.address)).to.equal("");
      expect(await c.namesOf(alice.address)).to.deep.equal([]);
    });

    it("isValidDomain enforces 3-32 characters of a-z0-9", async () => {
      const { c } = await loadFixture(deployFixture);
      for (const ok of ["abc", "ntu2026", "0".repeat(32)]) expect(await c.isValidDomain(ok)).to.equal(true);
      for (const bad of ["ab", "a".repeat(33), "ABC", "a-b", "a_b", "a b", "a.ntu", ""])
        expect(await c.isValidDomain(bad)).to.equal(false);
    });
  });
});
