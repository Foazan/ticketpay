// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title TicketPayTicket
 * @notice ERC-721 ownership and usage record for TicketPay event tickets (academic prototype, Sepolia testnet).
 *
 * The token is a utility ticket: proof that a ticket exists, who holds it and whether it was used.
 * It is not a payment instrument and carries no personal data. Payment is made in rupiah off-chain;
 * the TicketPay backend verifies it with the payment provider before it calls {mintTicket}.
 * This contract cannot prove that a fiat payment happened.
 *
 * Rules enforced here:
 * - Only MINTER_ROLE can mint, and each payment reference mints at most one ticket.
 * - Each event has a maximum supply; minting stops at it.
 * - Only GATE_ROLE can redeem, and a ticket redeems once.
 * - Holders cannot transfer or approve tickets. Only PLATFORM_ROLE can move a ticket, which is the
 *   hook for a future official resale feature. No account holds PLATFORM_ROLE in the prototype.
 */
contract TicketPayTicket is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant GATE_ROLE = keccak256("GATE_ROLE");
    bytes32 public constant EVENT_MANAGER_ROLE = keccak256("EVENT_MANAGER_ROLE");
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    enum Status {
        None,
        Valid,
        Redeemed,
        Cancelled
    }

    struct Ticket {
        uint64 eventId;
        uint8 tier;
        Status status;
        bytes32 paymentRef;
    }

    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => Ticket) private _tickets;
    mapping(bytes32 paymentRef => uint256 tokenId) public tokenIdByPaymentRef;
    mapping(uint256 eventId => uint256) public maxSupply;
    mapping(uint256 eventId => uint256) public mintedCount;

    event TicketMinted(uint256 indexed tokenId, address indexed to, uint256 indexed eventId, uint8 tier, bytes32 paymentRef);
    event TicketRedeemed(uint256 indexed tokenId, uint256 indexed eventId, address indexed by);
    event TicketCancelled(uint256 indexed tokenId, uint256 indexed eventId);
    event EventSupplySet(uint256 indexed eventId, uint256 maxSupply);
    event TicketTransferredByPlatform(uint256 indexed tokenId, address indexed from, address indexed to);

    error PaymentRefRequired();
    error PaymentRefAlreadyUsed(bytes32 paymentRef, uint256 tokenId);
    error EventSupplyNotSet(uint256 eventId);
    error EventSoldOut(uint256 eventId, uint256 maxSupply);
    error SupplyBelowMinted(uint256 eventId, uint256 minted);
    error TicketNotFound(uint256 tokenId);
    error TicketNotValid(uint256 tokenId, Status status);
    error TransfersDisabled();
    error ApprovalsDisabled();

    constructor(address admin) ERC721("TicketPay Ticket", "TPT") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------
    // Issuing and using tickets
    // ------------------------------------------------------------------

    /**
     * @notice Issues a ticket to `to` for a payment the backend has already verified.
     * @param paymentRef keccak256 of (paymentId, merchantId, amount, seq). Never raw payment data.
     */
    function mintTicket(address to, uint256 eventId, uint8 tier, bytes32 paymentRef)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        if (paymentRef == bytes32(0)) revert PaymentRefRequired();
        uint256 existing = tokenIdByPaymentRef[paymentRef];
        if (existing != 0) revert PaymentRefAlreadyUsed(paymentRef, existing);
        uint256 cap = maxSupply[eventId];
        if (cap == 0) revert EventSupplyNotSet(eventId);
        if (mintedCount[eventId] >= cap) revert EventSoldOut(eventId, cap);

        tokenId = _nextTokenId++;
        mintedCount[eventId] += 1;
        tokenIdByPaymentRef[paymentRef] = tokenId;
        _tickets[tokenId] = Ticket({eventId: uint64(eventId), tier: tier, status: Status.Valid, paymentRef: paymentRef});
        _mint(to, tokenId);
        emit TicketMinted(tokenId, to, eventId, tier, paymentRef);
    }

    /// @notice Marks a valid ticket as used at the gate. A second call reverts.
    function redeem(uint256 tokenId) external onlyRole(GATE_ROLE) {
        Ticket storage t = _requireTicket(tokenId);
        if (t.status != Status.Valid) revert TicketNotValid(tokenId, t.status);
        t.status = Status.Redeemed;
        emit TicketRedeemed(tokenId, t.eventId, msg.sender);
    }

    /// @notice Cancels a valid ticket, for example after a refund. A cancelled ticket cannot be redeemed.
    function cancel(uint256 tokenId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Ticket storage t = _requireTicket(tokenId);
        if (t.status != Status.Valid) revert TicketNotValid(tokenId, t.status);
        t.status = Status.Cancelled;
        emit TicketCancelled(tokenId, t.eventId);
    }

    /// @notice Sets how many tickets an event may ever mint. Cannot go below what is already minted.
    function setEventSupply(uint256 eventId, uint256 newMaxSupply) external onlyRole(EVENT_MANAGER_ROLE) {
        if (newMaxSupply < mintedCount[eventId]) revert SupplyBelowMinted(eventId, mintedCount[eventId]);
        maxSupply[eventId] = newMaxSupply;
        emit EventSupplySet(eventId, newMaxSupply);
    }

    /// @notice Platform-controlled move of a valid ticket. Reserved for a future official resale flow.
    function platformTransfer(uint256 tokenId, address to) external onlyRole(PLATFORM_ROLE) {
        Ticket storage t = _requireTicket(tokenId);
        if (t.status != Status.Valid) revert TicketNotValid(tokenId, t.status);
        address from = _ownerOf(tokenId);
        _update(to, tokenId, address(0));
        emit TicketTransferredByPlatform(tokenId, from, to);
    }

    // ------------------------------------------------------------------
    // Reading
    // ------------------------------------------------------------------

    /// @notice Public status lookup. Returns None for a token that does not exist.
    function ticketStatus(uint256 tokenId) external view returns (Status) {
        return _tickets[tokenId].status;
    }

    function ticketInfo(uint256 tokenId)
        external
        view
        returns (uint256 eventId, uint8 tier, Status status, bytes32 paymentRef, address owner)
    {
        Ticket storage t = _requireTicket(tokenId);
        return (t.eventId, t.tier, t.status, t.paymentRef, _ownerOf(tokenId));
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    // ------------------------------------------------------------------
    // Transfer and approval restrictions
    // ------------------------------------------------------------------

    /// @dev Blocks every holder-initiated transfer. Mints and platform transfers pass.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && !hasRole(PLATFORM_ROLE, _msgSender())) revert TransfersDisabled();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert ApprovalsDisabled();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert ApprovalsDisabled();
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _requireTicket(uint256 tokenId) private view returns (Ticket storage t) {
        t = _tickets[tokenId];
        if (t.status == Status.None) revert TicketNotFound(tokenId);
    }
}
