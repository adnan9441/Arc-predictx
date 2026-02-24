const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ARCPredictX", function () {
  let contract, admin, user1, user2, user3;
  const ONE_DAY = 86400;
  const ONE_ETHER = ethers.parseEther("1");

  beforeEach(async function () {
    [admin, user1, user2, user3] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ARCPredictX");
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set deployer as admin", async function () {
      expect(await contract.admin()).to.equal(admin.address);
    });

    it("should start with zero markets", async function () {
      expect(await contract.marketCount()).to.equal(0);
    });
  });

  describe("createMarket", function () {
    it("should create a market with correct data", async function () {
      const endTime = (await time.latest()) + ONE_DAY;
      await contract.createMarket("Will BTC hit 100k?", endTime);

      const m = await contract.getMarket(0);
      expect(m.id).to.equal(0);
      expect(m.question).to.equal("Will BTC hit 100k?");
      expect(m.endTime).to.equal(endTime);
      expect(m.totalYesAmount).to.equal(0);
      expect(m.totalNoAmount).to.equal(0);
      expect(m.resolved).to.equal(false);
      expect(m.outcome).to.equal(false);
    });

    it("should increment marketCount", async function () {
      const endTime = (await time.latest()) + ONE_DAY;
      await contract.createMarket("Q1?", endTime);
      await contract.createMarket("Q2?", endTime);
      expect(await contract.marketCount()).to.equal(2);
    });

    it("should emit MarketCreated event", async function () {
      const endTime = (await time.latest()) + ONE_DAY;
      await expect(contract.createMarket("Test?", endTime))
        .to.emit(contract, "MarketCreated")
        .withArgs(0, "Test?", endTime);
    });

    it("should revert if not admin", async function () {
      const endTime = (await time.latest()) + ONE_DAY;
      await expect(
        contract.connect(user1).createMarket("Test?", endTime)
      ).to.be.revertedWithCustomError(contract, "OnlyAdmin");
    });

    it("should revert if endTime is in the past", async function () {
      const pastTime = (await time.latest()) - 100;
      await expect(
        contract.createMarket("Test?", pastTime)
      ).to.be.revertedWithCustomError(contract, "EndTimeInPast");
    });
  });

  describe("buyYes / buyNo", function () {
    let endTime;

    beforeEach(async function () {
      endTime = (await time.latest()) + ONE_DAY;
      await contract.createMarket("Will it rain?", endTime);
    });

    it("should accept YES bet and update pool", async function () {
      await contract.connect(user1).buyYes(0, { value: ONE_ETHER });
      const m = await contract.getMarket(0);
      expect(m.totalYesAmount).to.equal(ONE_ETHER);
      expect(await contract.yesBets(0, user1.address)).to.equal(ONE_ETHER);
    });

    it("should accept NO bet and update pool", async function () {
      await contract.connect(user1).buyNo(0, { value: ONE_ETHER });
      const m = await contract.getMarket(0);
      expect(m.totalNoAmount).to.equal(ONE_ETHER);
      expect(await contract.noBets(0, user1.address)).to.equal(ONE_ETHER);
    });

    it("should accumulate multiple bets from same user", async function () {
      await contract.connect(user1).buyYes(0, { value: ONE_ETHER });
      await contract.connect(user1).buyYes(0, { value: ONE_ETHER });
      expect(await contract.yesBets(0, user1.address)).to.equal(ethers.parseEther("2"));
    });

    it("should emit BetPlaced event", async function () {
      await expect(contract.connect(user1).buyYes(0, { value: ONE_ETHER }))
        .to.emit(contract, "BetPlaced")
        .withArgs(0, user1.address, true, ONE_ETHER);
    });

    it("should revert with zero value", async function () {
      await expect(
        contract.connect(user1).buyYes(0, { value: 0 })
      ).to.be.revertedWithCustomError(contract, "ZeroBet");
    });

    it("should revert after endTime", async function () {
      await time.increaseTo(endTime);
      await expect(
        contract.connect(user1).buyYes(0, { value: ONE_ETHER })
      ).to.be.revertedWithCustomError(contract, "MarketExpired");
    });

    it("should revert for invalid market ID", async function () {
      await expect(
        contract.connect(user1).buyYes(99, { value: ONE_ETHER })
      ).to.be.revertedWithCustomError(contract, "InvalidMarket");
    });
  });

  describe("resolveMarket", function () {
    let endTime;

    beforeEach(async function () {
      endTime = (await time.latest()) + ONE_DAY;
      await contract.createMarket("Will ARC moon?", endTime);
    });

    it("should resolve market with YES outcome", async function () {
      await time.increaseTo(endTime);
      await contract.resolveMarket(0, true);
      const m = await contract.getMarket(0);
      expect(m.resolved).to.equal(true);
      expect(m.outcome).to.equal(true);
    });

    it("should resolve market with NO outcome", async function () {
      await time.increaseTo(endTime);
      await contract.resolveMarket(0, false);
      const m = await contract.getMarket(0);
      expect(m.resolved).to.equal(true);
      expect(m.outcome).to.equal(false);
    });

    it("should emit MarketResolved event", async function () {
      await time.increaseTo(endTime);
      await expect(contract.resolveMarket(0, true))
        .to.emit(contract, "MarketResolved")
        .withArgs(0, true);
    });

    it("should revert if not admin", async function () {
      await time.increaseTo(endTime);
      await expect(
        contract.connect(user1).resolveMarket(0, true)
      ).to.be.revertedWithCustomError(contract, "OnlyAdmin");
    });

    it("should revert if market not expired", async function () {
      await expect(
        contract.resolveMarket(0, true)
      ).to.be.revertedWithCustomError(contract, "MarketNotExpired");
    });

    it("should revert if already resolved", async function () {
      await time.increaseTo(endTime);
      await contract.resolveMarket(0, true);
      await expect(
        contract.resolveMarket(0, false)
      ).to.be.revertedWithCustomError(contract, "MarketAlreadyResolved");
    });
  });

  describe("claimReward", function () {
    let endTime;

    beforeEach(async function () {
      endTime = (await time.latest()) + ONE_DAY;
      await contract.createMarket("Test market?", endTime);
    });

    it("should pay proportional reward when YES wins", async function () {
      // user1 bets 3 ETH YES, user2 bets 1 ETH YES, user3 bets 4 ETH NO
      await contract.connect(user1).buyYes(0, { value: ethers.parseEther("3") });
      await contract.connect(user2).buyYes(0, { value: ethers.parseEther("1") });
      await contract.connect(user3).buyNo(0, { value: ethers.parseEther("4") });

      // totalPool = 8 ETH, totalYes = 4 ETH
      // user1 reward = (3/4) * 8 = 6 ETH
      // user2 reward = (1/4) * 8 = 2 ETH

      await time.increaseTo(endTime);
      await contract.resolveMarket(0, true);

      const bal1Before = await ethers.provider.getBalance(user1.address);
      const tx1 = await contract.connect(user1).claimReward(0);
      const receipt1 = await tx1.wait();
      const gas1 = receipt1.gasUsed * receipt1.gasPrice;
      const bal1After = await ethers.provider.getBalance(user1.address);
      const reward1 = bal1After - bal1Before + gas1;
      expect(reward1).to.equal(ethers.parseEther("6"));

      const bal2Before = await ethers.provider.getBalance(user2.address);
      const tx2 = await contract.connect(user2).claimReward(0);
      const receipt2 = await tx2.wait();
      const gas2 = receipt2.gasUsed * receipt2.gasPrice;
      const bal2After = await ethers.provider.getBalance(user2.address);
      const reward2 = bal2After - bal2Before + gas2;
      expect(reward2).to.equal(ethers.parseEther("2"));
    });

    it("should pay proportional reward when NO wins", async function () {
      await contract.connect(user1).buyYes(0, { value: ethers.parseEther("6") });
      await contract.connect(user2).buyNo(0, { value: ethers.parseEther("2") });
      await contract.connect(user3).buyNo(0, { value: ethers.parseEther("2") });

      // totalPool = 10 ETH, totalNo = 4 ETH
      // user2 reward = (2/4) * 10 = 5 ETH
      // user3 reward = (2/4) * 10 = 5 ETH

      await time.increaseTo(endTime);
      await contract.resolveMarket(0, false);

      const claimable2 = await contract.getClaimable(0, user2.address);
      expect(claimable2).to.equal(ethers.parseEther("5"));

      const claimable3 = await contract.getClaimable(0, user3.address);
      expect(claimable3).to.equal(ethers.parseEther("5"));
    });

    it("should emit RewardClaimed event", async function () {
      await contract.connect(user1).buyYes(0, { value: ONE_ETHER });
      await time.increaseTo(endTime);
      await contract.resolveMarket(0, true);

      await expect(contract.connect(user1).claimReward(0))
        .to.emit(contract, "RewardClaimed")
        .withArgs(0, user1.address, ONE_ETHER);
    });

    it("should revert if market not resolved", async function () {
      await contract.connect(user1).buyYes(0, { value: ONE_ETHER });
      await expect(
        contract.connect(user1).claimReward(0)
      ).to.be.revertedWithCustomError(contract, "MarketNotResolved");
    });

    it("should revert if user is not on winning side", async function () {
      await contract.connect(user1).buyNo(0, { value: ONE_ETHER });
      await time.increaseTo(endTime);
      await contract.resolveMarket(0, true); // YES wins

      await expect(
        contract.connect(user1).claimReward(0) // user1 bet NO
      ).to.be.revertedWithCustomError(contract, "NotWinner");
    });

    it("should revert on double claim", async function () {
      await contract.connect(user1).buyYes(0, { value: ONE_ETHER });
      await time.increaseTo(endTime);
      await contract.resolveMarket(0, true);

      await contract.connect(user1).claimReward(0);
      await expect(
        contract.connect(user1).claimReward(0)
      ).to.be.revertedWithCustomError(contract, "AlreadyClaimed");
    });

    it("should set claimed to true after claiming", async function () {
      await contract.connect(user1).buyYes(0, { value: ONE_ETHER });
      await time.increaseTo(endTime);
      await contract.resolveMarket(0, true);

      expect(await contract.claimed(0, user1.address)).to.equal(false);
      await contract.connect(user1).claimReward(0);
      expect(await contract.claimed(0, user1.address)).to.equal(true);
    });
  });

  describe("View functions", function () {
    it("getUserBets should return correct data", async function () {
      const endTime = (await time.latest()) + ONE_DAY;
      await contract.createMarket("Test?", endTime);
      await contract.connect(user1).buyYes(0, { value: ethers.parseEther("2") });
      await contract.connect(user1).buyNo(0, { value: ethers.parseEther("1") });

      const ub = await contract.getUserBets(0, user1.address);
      expect(ub.yesBet).to.equal(ethers.parseEther("2"));
      expect(ub.noBet).to.equal(ethers.parseEther("1"));
      expect(ub.hasClaimed).to.equal(false);
    });

    it("getClaimable should return 0 for unresolved market", async function () {
      const endTime = (await time.latest()) + ONE_DAY;
      await contract.createMarket("Test?", endTime);
      await contract.connect(user1).buyYes(0, { value: ONE_ETHER });
      expect(await contract.getClaimable(0, user1.address)).to.equal(0);
    });

    it("getClaimable should return 0 after claiming", async function () {
      const endTime = (await time.latest()) + ONE_DAY;
      await contract.createMarket("Test?", endTime);
      await contract.connect(user1).buyYes(0, { value: ONE_ETHER });
      await time.increaseTo(endTime);
      await contract.resolveMarket(0, true);
      await contract.connect(user1).claimReward(0);
      expect(await contract.getClaimable(0, user1.address)).to.equal(0);
    });
  });
});
