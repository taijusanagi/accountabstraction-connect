/* eslint-disable camelcase */

/**
 ** This copied from @account-abstraction/sdk
 **/
import { EntryPoint, EntryPoint__factory, UserOperationStruct } from "@account-abstraction/contracts";
import { SimpleWalletAPI } from "@account-abstraction/sdk";
import { rethrowError } from "@account-abstraction/utils";
import { SampleRecipient, SampleRecipient__factory } from "@account-abstraction/utils/dist/src/types";
import { Hop } from "@hop-protocol/sdk";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";

import { AccountAbstractionWalletAPI } from "../lib/AccountAbstractionWalletAPI";
import { DeterministicDeployer } from "../lib/infinitism/DeterministicDeployer";
import { AccountAbstractionWalletDeployer__factory } from "../typechain-types";

const provider = ethers.provider;

describe("AccountAbstractionWallet", () => {
  let signer: SignerWithAddress;
  let owner: SignerWithAddress;
  let api: SimpleWalletAPI;
  let entryPoint: EntryPoint;
  let beneficiary: string;
  let recipient: SampleRecipient;
  let factoryAddress: string;
  let walletAddress: string;
  let walletDeployed = false;

  before("init", async () => {
    [signer, owner] = await ethers.getSigners();
    entryPoint = await new EntryPoint__factory(signer).deploy(1, 1);
    beneficiary = await signer.getAddress();
    recipient = await new SampleRecipient__factory(signer).deploy();
    factoryAddress = await DeterministicDeployer.deploy(AccountAbstractionWalletDeployer__factory.bytecode);
    api = new AccountAbstractionWalletAPI({
      provider,
      entryPointAddress: entryPoint.address,
      owner,
      factoryAddress,
    });
  });

  describe("Account Abstraction", () => {
    it("#getRequestId should match entryPoint.getRequestId", async function () {
      const userOp: UserOperationStruct = {
        sender: "0x".padEnd(42, "1"),
        nonce: 2,
        initCode: "0x3333",
        callData: "0x4444",
        callGasLimit: 5,
        verificationGasLimit: 6,
        preVerificationGas: 7,
        maxFeePerGas: 8,
        maxPriorityFeePerGas: 9,
        paymasterAndData: "0xaaaaaa",
        signature: "0xbbbb",
      };
      const hash = await api.getRequestId(userOp);
      const epHash = await entryPoint.getRequestId(userOp);
      expect(hash).to.equal(epHash);
    });

    it("should deploy to counterfactual address", async () => {
      walletAddress = await api.getWalletAddress();
      expect(await provider.getCode(walletAddress).then((code) => code.length)).to.equal(2);
      await signer.sendTransaction({
        to: walletAddress,
        value: parseEther("0.1"),
      });
      const op = await api.createSignedUserOp({
        target: recipient.address,
        data: recipient.interface.encodeFunctionData("something", ["hello"]),
      });
      await expect(entryPoint.handleOps([op], beneficiary))
        .to.emit(recipient, "Sender")
        .withArgs(anyValue, walletAddress, "hello");
      expect(await provider.getCode(walletAddress).then((code) => code.length)).to.greaterThan(1000);
      walletDeployed = true;
    });

    context("#rethrowError", () => {
      let userOp: UserOperationStruct;
      before(async () => {
        userOp = await api.createUnsignedUserOp({
          target: ethers.constants.AddressZero,
          data: "0x",
        });
        // expect FailedOp "invalid signature length"
        userOp.signature = "0x11";
      });
      it("should parse FailedOp error", async () => {
        await expect(entryPoint.handleOps([userOp], beneficiary).catch(rethrowError)).to.revertedWith(
          "FailedOp: ECDSA: invalid signature length"
        );
      });
      it("should parse Error(message) error", async () => {
        await expect(entryPoint.addStake(0)).to.revertedWith("unstake delay too low");
      });
      it("should parse revert with no description", async () => {
        // use wrong signature for contract..
        const wrongContract = entryPoint.attach(recipient.address);
        await expect(wrongContract.addStake(0)).to.revertedWithoutReason();
      });
    });

    it("should use wallet API after creation without a factory", async function () {
      if (!walletDeployed) {
        this.skip();
      }
      const api1 = new SimpleWalletAPI({
        provider,
        entryPointAddress: entryPoint.address,
        walletAddress,
        owner,
      });
      const op1 = await api1.createSignedUserOp({
        target: recipient.address,
        data: recipient.interface.encodeFunctionData("something", ["world"]),
      });
      await expect(entryPoint.handleOps([op1], beneficiary))
        .to.emit(recipient, "Sender")
        .withArgs(anyValue, walletAddress, "world");
    });

    describe("Additional testing", () => {
      it("getCreate2Address in factory", async function () {
        const factory = AccountAbstractionWalletDeployer__factory.connect(factoryAddress, provider);
        const salt = 0;
        const calculatedAddress = await factory.getCreate2Address(entryPoint.address, owner.address, salt);
        expect(walletAddress).to.eq(calculatedAddress);
      });
    });
  });

  describe("Hop Integration", () => {
    it("should work", async function () {
      const hop = new Hop("goerli");
      console.log(hop);
    });
  });
});