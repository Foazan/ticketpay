// Contract tests. Test-matrix cases T9 to T14, plus roles, approvals, cancel and supply rules.
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const Status = { None: 0n, Valid: 1n, Redeemed: 2n, Cancelled: 3n };
const EVENT = 1n;
const ref = (n: number) => ethers.keccak256(ethers.toUtf8Bytes(`payment-${n}`));

async function deployFixture() {
  const [admin, signer, buyer, otherBuyer, outsider, platform] = await ethers.getSigners();
  const contract = await ethers.deployContract('TicketPayTicket', [admin.address]);
  // The backend signer gets exactly the three operational roles, as in scripts/deploy.ts.
  await contract.grantRole(await contract.MINTER_ROLE(), signer.address);
  await contract.grantRole(await contract.GATE_ROLE(), signer.address);
  await contract.grantRole(await contract.EVENT_MANAGER_ROLE(), signer.address);
  await contract.connect(signer).setEventSupply(EVENT, 3);
  const asSigner = contract.connect(signer);
  return { contract, asSigner, admin, signer, buyer, otherBuyer, outsider, platform };
}

async function mintedFixture() {
  const f = await deployFixture();
  await f.asSigner.mintTicket(f.buyer.address, EVENT, 1, ref(1));
  return { ...f, tokenId: 1n };
}

describe('TicketPayTicket', () => {
  describe('minting', () => {
    it('mints a valid ticket to the buyer and records event, tier and payment reference', async () => {
      const { asSigner, contract, buyer } = await loadFixture(deployFixture);
      await expect(asSigner.mintTicket(buyer.address, EVENT, 2, ref(1)))
        .to.emit(contract, 'TicketMinted')
        .withArgs(1n, buyer.address, EVENT, 2, ref(1));
      expect(await contract.ownerOf(1n)).to.equal(buyer.address);
      expect(await contract.ticketStatus(1n)).to.equal(Status.Valid);
      const info = await contract.ticketInfo(1n);
      expect([info.eventId, info.tier, info.status, info.paymentRef, info.owner]).to.deep.equal([EVENT, 2n, Status.Valid, ref(1), buyer.address]);
      expect(await contract.tokenIdByPaymentRef(ref(1))).to.equal(1n);
      expect(await contract.mintedCount(EVENT)).to.equal(1n);
    });

    it('gives each ticket a unique token id', async () => {
      const { asSigner, contract, buyer } = await loadFixture(deployFixture);
      await asSigner.mintTicket(buyer.address, EVENT, 1, ref(1));
      await asSigner.mintTicket(buyer.address, EVENT, 1, ref(2));
      expect(await contract.tokenIdByPaymentRef(ref(1))).to.equal(1n);
      expect(await contract.tokenIdByPaymentRef(ref(2))).to.equal(2n);
      expect(await contract.totalMinted()).to.equal(2n);
    });

    it('T9: a payment reference that was already used reverts', async () => {
      const { asSigner, contract, buyer, otherBuyer } = await loadFixture(mintedFixture);
      await expect(asSigner.mintTicket(otherBuyer.address, EVENT, 1, ref(1)))
        .to.be.revertedWithCustomError(contract, 'PaymentRefAlreadyUsed')
        .withArgs(ref(1), 1n);
      expect(await contract.balanceOf(buyer.address)).to.equal(1n);
    });

    it('rejects an empty payment reference', async () => {
      const { asSigner, contract, buyer } = await loadFixture(deployFixture);
      await expect(asSigner.mintTicket(buyer.address, EVENT, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(contract, 'PaymentRefRequired');
    });

    it('T12: an account without the minter role cannot mint', async () => {
      const { contract, outsider, buyer, admin } = await loadFixture(deployFixture);
      const minterRole = await contract.MINTER_ROLE();
      await expect(contract.connect(outsider).mintTicket(buyer.address, EVENT, 1, ref(9)))
        .to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount')
        .withArgs(outsider.address, minterRole);
      // Not even the admin, unless it is granted the role.
      await expect(contract.connect(admin).mintTicket(buyer.address, EVENT, 1, ref(9))).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount');
    });

    it('T14: minting beyond the event supply reverts', async () => {
      const { asSigner, contract, buyer } = await loadFixture(deployFixture);
      for (let i = 1; i <= 3; i++) await asSigner.mintTicket(buyer.address, EVENT, 1, ref(i));
      await expect(asSigner.mintTicket(buyer.address, EVENT, 1, ref(4)))
        .to.be.revertedWithCustomError(contract, 'EventSoldOut')
        .withArgs(EVENT, 3n);
    });

    it('refuses to mint for an event whose supply was never set', async () => {
      const { asSigner, contract, buyer } = await loadFixture(deployFixture);
      await expect(asSigner.mintTicket(buyer.address, 99, 1, ref(1)))
        .to.be.revertedWithCustomError(contract, 'EventSupplyNotSet')
        .withArgs(99n);
    });
  });

  describe('event supply', () => {
    it('can be raised, but never set below what is already minted', async () => {
      const { asSigner, contract, buyer } = await loadFixture(deployFixture);
      await asSigner.mintTicket(buyer.address, EVENT, 1, ref(1));
      await asSigner.mintTicket(buyer.address, EVENT, 1, ref(2));
      await expect(asSigner.setEventSupply(EVENT, 1)).to.be.revertedWithCustomError(contract, 'SupplyBelowMinted').withArgs(EVENT, 2n);
      await expect(asSigner.setEventSupply(EVENT, 10)).to.emit(contract, 'EventSupplySet').withArgs(EVENT, 10n);
      expect(await contract.maxSupply(EVENT)).to.equal(10n);
    });

    it('only an event manager can change it', async () => {
      const { contract, outsider } = await loadFixture(deployFixture);
      await expect(contract.connect(outsider).setEventSupply(EVENT, 100)).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount');
    });
  });

  describe('redeeming', () => {
    it('marks a valid ticket redeemed and emits TicketRedeemed', async () => {
      const { asSigner, contract, signer, tokenId } = await loadFixture(mintedFixture);
      await expect(asSigner.redeem(tokenId)).to.emit(contract, 'TicketRedeemed').withArgs(tokenId, EVENT, signer.address);
      expect(await contract.ticketStatus(tokenId)).to.equal(Status.Redeemed);
    });

    it('T10: redeeming the same ticket twice reverts', async () => {
      const { asSigner, contract, tokenId } = await loadFixture(mintedFixture);
      await asSigner.redeem(tokenId);
      await expect(asSigner.redeem(tokenId)).to.be.revertedWithCustomError(contract, 'TicketNotValid').withArgs(tokenId, Status.Redeemed);
    });

    it('T11: an account without the gate role cannot redeem', async () => {
      const { contract, buyer, outsider, tokenId } = await loadFixture(mintedFixture);
      const gateRole = await contract.GATE_ROLE();
      // Not a stranger, and not the ticket holder either.
      for (const who of [outsider, buyer]) {
        await expect(contract.connect(who).redeem(tokenId)).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount').withArgs(who.address, gateRole);
      }
      expect(await contract.ticketStatus(tokenId)).to.equal(Status.Valid);
    });

    it('cannot redeem a cancelled or non-existent ticket', async () => {
      const { asSigner, contract, admin, tokenId } = await loadFixture(mintedFixture);
      await expect(contract.connect(admin).cancel(tokenId)).to.emit(contract, 'TicketCancelled').withArgs(tokenId, EVENT);
      await expect(asSigner.redeem(tokenId)).to.be.revertedWithCustomError(contract, 'TicketNotValid').withArgs(tokenId, Status.Cancelled);
      await expect(asSigner.redeem(42)).to.be.revertedWithCustomError(contract, 'TicketNotFound').withArgs(42n);
    });

    it('reports None for a token that does not exist', async () => {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.ticketStatus(42)).to.equal(Status.None);
    });
  });

  describe('cancelling', () => {
    it('only the admin can cancel, and a redeemed ticket cannot be cancelled', async () => {
      const { asSigner, contract, admin, outsider, tokenId } = await loadFixture(mintedFixture);
      await expect(contract.connect(outsider).cancel(tokenId)).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount');
      await expect(asSigner.cancel(tokenId)).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount');
      await asSigner.redeem(tokenId);
      await expect(contract.connect(admin).cancel(tokenId)).to.be.revertedWithCustomError(contract, 'TicketNotValid').withArgs(tokenId, Status.Redeemed);
    });
  });

  describe('transfers', () => {
    it('T13: the holder cannot transfer a ticket directly', async () => {
      const { contract, buyer, otherBuyer, tokenId } = await loadFixture(mintedFixture);
      await expect(contract.connect(buyer).transferFrom(buyer.address, otherBuyer.address, tokenId)).to.be.revertedWithCustomError(contract, 'TransfersDisabled');
      await expect(contract.connect(buyer)['safeTransferFrom(address,address,uint256)'](buyer.address, otherBuyer.address, tokenId)).to.be.revertedWithCustomError(
        contract,
        'TransfersDisabled',
      );
      expect(await contract.ownerOf(tokenId)).to.equal(buyer.address);
    });

    it('approvals are disabled, so no marketplace can move a ticket', async () => {
      const { contract, buyer, otherBuyer, tokenId } = await loadFixture(mintedFixture);
      await expect(contract.connect(buyer).approve(otherBuyer.address, tokenId)).to.be.revertedWithCustomError(contract, 'ApprovalsDisabled');
      await expect(contract.connect(buyer).setApprovalForAll(otherBuyer.address, true)).to.be.revertedWithCustomError(contract, 'ApprovalsDisabled');
    });

    it('the minter and admin cannot move a ticket either', async () => {
      const { contract, signer, admin, buyer, otherBuyer, tokenId } = await loadFixture(mintedFixture);
      for (const who of [signer, admin]) {
        await expect(contract.connect(who).transferFrom(buyer.address, otherBuyer.address, tokenId)).to.be.reverted;
      }
    });

    it('a future platform role can move a valid ticket, for an official resale flow', async () => {
      const { contract, admin, platform, buyer, otherBuyer, tokenId } = await loadFixture(mintedFixture);
      await expect(contract.connect(platform).platformTransfer(tokenId, otherBuyer.address)).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount');
      await contract.connect(admin).grantRole(await contract.PLATFORM_ROLE(), platform.address);
      await expect(contract.connect(platform).platformTransfer(tokenId, otherBuyer.address))
        .to.emit(contract, 'TicketTransferredByPlatform')
        .withArgs(tokenId, buyer.address, otherBuyer.address);
      expect(await contract.ownerOf(tokenId)).to.equal(otherBuyer.address);
    });
  });

  describe('roles', () => {
    it('only the admin can grant roles', async () => {
      const { contract, outsider } = await loadFixture(deployFixture);
      await expect(contract.connect(outsider).grantRole(await contract.MINTER_ROLE(), outsider.address)).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount');
    });

    it('a revoked minter can no longer mint', async () => {
      const { contract, asSigner, admin, signer, buyer } = await loadFixture(deployFixture);
      await contract.connect(admin).revokeRole(await contract.MINTER_ROLE(), signer.address);
      await expect(asSigner.mintTicket(buyer.address, EVENT, 1, ref(1))).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount');
    });

    it('supports the ERC-721 and AccessControl interfaces', async () => {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.supportsInterface('0x80ac58cd')).to.equal(true); // ERC-721
      expect(await contract.supportsInterface('0x7965db0b')).to.equal(true); // AccessControl
    });
  });
});
