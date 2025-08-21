// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice minimal ERC20 interface (transfer/transferFrom/balanceOf/allowance/decimals)
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/**
 * @title FreakyFridayAuto (Freaks2) — Final merged
 * @notice Two modes:
 *         - Standard: 50 in, 49 refundable per player (after close), 1 GCC per player forms prize for 1 winner
 *         - Jackpot:  50 in, no refunds, winner takes full pot
 *
 * Key guarantees:
 * - NO refunds during enter/relayedEnter. All entitlements are set at close.
 * - Escrow accounting (escrowedTokens) prevents admin withdrawals that would break liabilities.
 * - Public close with optional tip paid ONLY from surplus (never from escrow).
 * - Pull refunds (claimRefund) + optional relayer batch (batchClaimRefunds) for scalability.
 * - Active round = (roundStart != 0); starts on first join, ends at close.
 */
contract FreakyFridayAuto {
    // ------- Events -------
    event Joined(address indexed user, uint256 round);
    event RoundCompleted(address indexed winner, uint256 round);
    event RoundModeChanged(PrizeMode newMode);
    event Received(address sender, uint256 amount);
    event RefundClaimed(address indexed user, uint256 indexed round, uint256 amount);
    event CloseTipPaid(address indexed caller, uint256 amount);

    // ------- Admin / Roles -------
    address public admin;
    address public relayer;

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "not relayer");
        _;
    }

    // ------- Token / Game Params -------
    IERC20 public gcc;                // GCC token
    uint256 public entryAmount;       // default 50e18
    uint256 public duration;          // round duration in seconds
    uint256 public maxPlayers;        // cap participants for a round

    // Escrow & tip
    uint256 public escrowedTokens;    // total GCC reserved for prizes + unclaimed refunds
    uint256 public closeTip;          // optional GCC tip to close caller (paid from surplus only)

    // ------- Round State -------
    uint256 public currentRound;      // increments when a new round starts
    uint256 public roundStart;        // 0 when idle; set on first join
    address[] public participants;    // participants list
    mapping(uint256 => mapping(address => bool)) public hasJoinedThisRound; // double-join guard

    // ------- Prize Modes -------
    enum PrizeMode { Standard, Jackpot }
    PrizeMode public roundMode;       // default Standard (0)

    // ------- Pull-Refunds Data (snapshotted at close) -------
    mapping(uint256 => bool) public roundResolved;                // true once closed
    mapping(uint256 => PrizeMode) public roundModeAtClose;        // mode snapshot at close
    mapping(uint256 => uint256) public refundPerPlayer;           // Standard mode refund per player
    mapping(uint256 => uint256) public playersInRound;            // participant count snapshot
    mapping(uint256 => address) public winnerOfRound;             // winner snapshot
    mapping(uint256 => mapping(address => bool)) public refundClaimed; // refund claimed bitmap

    // ------- Constructor -------
    /**
     * @param _gcc  GCC token address
     * Defaults:
     * - entryAmount = 50e18
     * - duration    = 1 days
     * - maxPlayers  = 500
     * - admin       = deployer
     * - closeTip    = 0.1e18 (ONLY from surplus)
     */
    constructor(address _gcc) {
        require(_gcc != address(0), "gcc=0");
        admin = msg.sender;
        gcc = IERC20(_gcc);
        require(gcc.decimals() == 18, "GCC decimals != 18");

        entryAmount = 50e18;
        duration = 1 days;
        maxPlayers = 500;
        closeTip   = 0.1e18; // OPTIONAL small tip; 0 to disable
    }

    // ------- Views / Helpers -------
    function isRoundActive() public view returns (bool) {
        return roundStart != 0;
    }

    function getParticipants() external view returns (address[] memory) {
        address[] memory list = new address[](participants.length);
        for (uint256 i; i < participants.length; ) {
            list[i] = participants[i];
            unchecked { ++i; }
        }
        return list;
    }

    function getContractTokenBalance() external view returns (uint256) {
        return gcc.balanceOf(address(this));
    }

    function checkRewardBalance() external view returns (uint256) {
        return gcc.balanceOf(address(this));
    }

    function checkBNBBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ------- Admin Ops -------
    function setRelayer(address _relayer) external onlyAdmin {
        require(_relayer != address(0), "relayer=0");
        relayer = _relayer;
    }

    function setMaxPlayers(uint256 newLimit) external onlyAdmin {
        require(newLimit > 0, "limit=0");
        maxPlayers = newLimit;
    }

    function setCloseTip(uint256 newTip) external onlyAdmin {
        closeTip = newTip; // paid only from surplus; 0 disables
    }

    /// @notice Optional admin funding (pulls tokens using allowance) — counted as surplus
    function fundBonus(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(gcc.transferFrom(msg.sender, address(this), amount), "fund failed");
        // not added to escrow — remains surplus
    }

    /// @notice Withdraw stray BNB (blocked while active)
    function withdrawBNB(address payable to, uint256 amount) external onlyAdmin {
        require(to != address(0), "to=0");
        require(!isRoundActive(), "round active");
        require(amount <= address(this).balance, "insufficient BNB");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "BNB withdraw failed");
    }

    /// @notice Withdraw surplus GCC tokens; cannot reduce below escrowedTokens
    function withdrawLeftovers(address to, uint256 amount) external onlyAdmin {
        require(to != address(0), "to=0");
        uint256 bal = gcc.balanceOf(address(this));
        require(bal >= escrowedTokens + amount, "exceeds surplus");
        require(gcc.transfer(to, amount), "GCC withdraw failed");
    }

    // ------- Prize Mode Controls -------
    function setRoundMode(PrizeMode newMode) external onlyAdmin {
        require(!isRoundActive(), "round active");
        roundMode = newMode;
        emit RoundModeChanged(newMode);
    }

    function getRoundMode() external view returns (PrizeMode) {
        return roundMode;
    }

    // ------- Entry Flows -------
    /// @notice user-pays-gas flow (requires allowance of entryAmount)
    function enter() external {
        _takeEntry(msg.sender);
        _register(msg.sender);
    }

    /// @notice relayer-pays-gas flow (requires user allowance of entryAmount)
    function relayedEnter(address user) external onlyRelayer {
        require(user != address(0), "user=0");
        _takeEntry(user);
        _register(user);
    }

    // Internal: pull GCC from user & add to escrow (no refunds here)
    function _takeEntry(address from) internal {
        require(gcc.allowance(from, address(this)) >= entryAmount, "insufficient allowance");
        uint256 beforeBal = gcc.balanceOf(address(this));
        require(gcc.transferFrom(from, address(this), entryAmount), "transferFrom failed");
        uint256 received = gcc.balanceOf(address(this)) - beforeBal;
        require(received == entryAmount, "unsupported token behavior"); // no fee-on-transfer
        escrowedTokens += received; // every entry increases liabilities
    }

    // Internal: register participant + start round on first join
    function _register(address user) internal {
        require(participants.length < maxPlayers, "Too many players");
        if (!isRoundActive()) { // start new round
            currentRound += 1;
            roundStart = block.timestamp;
        }
        require(!hasJoinedThisRound[currentRound][user], "Already joined");
        hasJoinedThisRound[currentRound][user] = true;

        participants.push(user);
        emit Joined(user, currentRound);
    }

    // ------- Round Close / Payout (public, with optional tip) -------
    /**
     * @notice Anyone can call after duration has elapsed.
     * Standard: sets refund entitlement (49 GCC each) & pays prize (1 GCC * N) to winner.
     * Jackpot:  pays full pot (entryAmount * N) to winner; no refunds.
     * Caller may receive `closeTip` only from SURPLUS (not escrow).
     */
    function checkTimeExpired() external {
        require(isRoundActive(), "No active round");
        require(block.timestamp >= roundStart + duration, "Time not up");
        uint256 n = participants.length;
        require(n > 0, "No players");

        uint256 thisRound = currentRound;
        uint256 idx = _rng(n);
        address winner = participants[idx];

        uint256 prize;
        if (roundMode == PrizeMode.Standard) {
            // snapshot entitlements: refunds recorded, not paid here
            uint256 refund = entryAmount - 1e18;  // e.g., 49e18 if entryAmount=50e18
            uint256 totalRefund = refund * n;     // liability to participants
            prize = (entryAmount * n) - totalRefund; // equals 1e18 * n

            roundResolved[thisRound]  = true;
            roundModeAtClose[thisRound] = PrizeMode.Standard;
            playersInRound[thisRound] = n;
            winnerOfRound[thisRound]  = winner;
            refundPerPlayer[thisRound] = refund;

            // prize is paid now; refunds remain in escrow for claims
            require(escrowedTokens >= prize, "escrow underflow");
            unchecked { escrowedTokens -= prize; }
            require(gcc.transfer(winner, prize), "prize transfer failed");
        } else {
            // Jackpot: winner takes everything; no refunds
            prize = entryAmount * n;

            roundResolved[thisRound]  = true;
            roundModeAtClose[thisRound] = PrizeMode.Jackpot;
            playersInRound[thisRound] = n;
            winnerOfRound[thisRound]  = winner;
            refundPerPlayer[thisRound] = 0;

            require(escrowedTokens >= prize, "escrow underflow");
            unchecked { escrowedTokens -= prize; }
            require(gcc.transfer(winner, prize), "prize transfer failed");
        }

        // Optional caller tip — ONLY from surplus above escrow
        if (closeTip > 0) {
            uint256 bal = gcc.balanceOf(address(this));
            uint256 surplus = bal > escrowedTokens ? (bal - escrowedTokens) : 0;
            uint256 tip = closeTip <= surplus ? closeTip : 0;
            if (tip > 0) {
                require(gcc.transfer(msg.sender, tip), "tip transfer failed");
                emit CloseTipPaid(msg.sender, tip);
            }
        }

        emit RoundCompleted(winner, thisRound);

        // reset round
        delete participants;
        roundStart = 0;
        // hasJoinedThisRound[thisRound][addr] remains for claim checks
    }

    // ------- Pull-Refunds Claim (post-close) -------
    /**
     * @notice Claim Standard-mode refund for a resolved round you joined.
     */
    function claimRefund(uint256 round) public {
        require(roundResolved[round], "round not resolved");
        require(roundModeAtClose[round] == PrizeMode.Standard, "no refunds");
        require(hasJoinedThisRound[round][msg.sender], "not a participant");
        require(!refundClaimed[round][msg.sender], "already claimed");

        uint256 amount = refundPerPlayer[round];
        require(amount > 0, "no refund");

        // Effects
        refundClaimed[round][msg.sender] = true;
        // Accounting
        require(escrowedTokens >= amount, "escrow insufficient");
        unchecked { escrowedTokens -= amount; }
        // Interaction
        require(gcc.transfer(msg.sender, amount), "refund transfer failed");

        emit RefundClaimed(msg.sender, round, amount);
    }

    /**
     * @notice Relayer batch refund utility to simulate “instant after close” UX (still post-close).
     * Processes a bounded list to keep gas safe. Skips already-claimed/not-joined silently.
     */
    function batchClaimRefunds(uint256 round, address[] calldata users, uint256 maxCount) external onlyRelayer {
        require(roundResolved[round] && roundModeAtClose[round] == PrizeMode.Standard, "no refunds");
        uint256 amt = refundPerPlayer[round];
        require(amt > 0, "no refund");
        uint256 processed;

        for (uint256 i; i < users.length && processed < maxCount; ) {
            address u = users[i];
            if (hasJoinedThisRound[round][u] && !refundClaimed[round][u]) {
                refundClaimed[round][u] = true;
                require(escrowedTokens >= amt, "escrow insufficient");
                unchecked { escrowedTokens -= amt; }
                require(gcc.transfer(u, amt), "refund transfer failed");
                emit RefundClaimed(u, round, amt);
                unchecked { ++processed; }
            }
            unchecked { ++i; }
        }
    }

    // ------- RNG helper -------
    function _rng(uint256 n) internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), address(this), currentRound))) % n;
    }

    // ------- Receive BNB -------
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }
}
