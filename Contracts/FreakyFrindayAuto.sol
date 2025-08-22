// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

//import { IERC20 }    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
//import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FreakyFridayAuto {
    //using SafeERC20 for IERC20;

    // ------- Events -------
    event Joined(address indexed user, uint256 round);
    event RoundCompleted(address indexed winner, uint256 round, uint256 prizePaid, uint256 refundPerPlayerFinal);
    event RoundModeChanged(PrizeMode newMode);
    event Received(address sender, uint256 amount);
    event RefundClaimed(address indexed user, uint256 indexed round, uint256 amount);
    event CloseTipPaid(address indexed caller, uint256 amount);

    // ------- Admin / Roles -------
    address public admin;
    address public relayer;

    modifier onlyAdmin()    { require(msg.sender == admin,   "not admin");   _; }
    modifier onlyRelayer()  { require(msg.sender == relayer, "not relayer"); _; }

    // ------- Token / Game Params -------
    //IERC20  public gcc;                  // GCC token
    uint256 public entryAmount;          // default 50e18
    uint256 public duration;             // round duration in seconds
    uint256 public maxPlayers;           // cap participants
    uint256 public closeTip;             // optional tip (paid only from surplus)

    // Escrow & accounting (backing for prize + refunds)
    uint256 public escrowedTokens;       // liabilities backing
    uint256 public currentRound;
    uint256 public roundStart;           // 0 when idle
    address[] public participants;
    mapping(uint256 => mapping(address => bool)) public hasJoinedThisRound;

    // Track actual tokens received this round (sum of net deposits)
    uint256 public totalReceivedThisRound;

    // ------- Prize Modes -------
    enum PrizeMode { Standard, Jackpot }
    PrizeMode public roundMode;          // default Standard

    // ------- Snapshots at close -------
    mapping(uint256 => bool)      public roundResolved;
    mapping(uint256 => PrizeMode) public roundModeAtClose;
    mapping(uint256 => uint256)   public playersInRound;
    mapping(uint256 => address)   public winnerOfRound;
    mapping(uint256 => uint256)   public refundPerPlayer;       // final (may be < 49e18 if escrow short)
    mapping(uint256 => mapping(address => bool)) public refundClaimed;

    // ------- Constructor -------
    constructor(address _gcc) {
        require(_gcc != address(0), "gcc=0");
        admin       = msg.sender;
        gcc         = IERC20(_gcc);
        // If GCC != 18 decimals, set entryAmount accordingly via setEntryAmount.
        entryAmount = 50e18;
        duration    = 1 days;
        maxPlayers  = 500;
        closeTip    = 0.1e18; // optional; set 0 to disable
        roundMode   = PrizeMode.Standard;
    }

    // ------- Views / Helpers -------
    function isRoundActive() public view returns (bool) { return roundStart != 0; }

    function getParticipants() external view returns (address[] memory list) {
        list = new address[](participants.length);
        for (uint256 i; i < participants.length; ) {
            list[i] = participants[i];
            unchecked { ++i; }
        }
    }

    function getContractTokenBalance() external view returns (uint256) { return gcc.balanceOf(address(this)); }
    function checkRewardBalance()    external view returns (uint256) { return gcc.balanceOf(address(this)); }
    function checkBNBBalance()       external view returns (uint256) { return address(this).balance; }

    // ------- Admin Ops -------
    function setRelayer(address _relayer) external onlyAdmin {
        require(_relayer != address(0), "relayer=0");
        relayer = _relayer;
    }
    function setMaxPlayers(uint256 newLimit) external onlyAdmin {
        require(newLimit > 0, "limit=0");
        maxPlayers = newLimit;
    }
    function setCloseTip(uint256 newTip) external onlyAdmin { closeTip = newTip; }
    function setEntryAmount(uint256 newAmt) external onlyAdmin { require(newAmt > 0, "amt=0"); entryAmount = newAmt; }

    /// Optional admin funding (counted as surplus, not escrow)
    function fundBonus(uint256 amount) external {
        require(amount > 0, "amount=0");
        gcc.safeTransferFrom(msg.sender, address(this), amount);
        // not added to escrow; remains surplus available for prize/tip
    }

    function withdrawBNB(address payable to, uint256 amount) external onlyAdmin {
        require(to != address(0), "to=0");
        require(!isRoundActive(), "round active");
        require(amount <= address(this).balance, "insufficient BNB");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "BNB withdraw failed");
    }

    /// Withdraw surplus GCC tokens; cannot reduce below escrowedTokens
    function withdrawLeftovers(address to, uint256 amount) external onlyAdmin {
        require(to != address(0), "to=0");
        uint256 bal = gcc.balanceOf(address(this));
        require(bal >= escrowedTokens + amount, "exceeds surplus");
        gcc.safeTransfer(to, amount);
    }

    // ------- Prize Mode Controls -------
    function setRoundMode(PrizeMode newMode) external onlyAdmin {
        require(!isRoundActive(), "round active");
        roundMode = newMode;
        emit RoundModeChanged(newMode);
    }

    function getRoundMode() external view returns (PrizeMode) { return roundMode; }

    // ------- Entry Flows -------
    function enter() external {
        _takeEntry(msg.sender);
        _register(msg.sender);
    }

    function relayedEnter(address user) external onlyRelayer {
        require(user != address(0), "user=0");
        _takeEntry(user);
        _register(user);
    }

    // Accept taxed inbound: measure net received and add to escrow
    function _takeEntry(address from) internal {
        require(participants.length < maxPlayers, "Too many players");
        require(gcc.allowance(from, address(this)) >= entryAmount, "insufficient allowance");

        uint256 beforeBal = gcc.balanceOf(address(this));
        gcc.safeTransferFrom(from, address(this), entryAmount);
        uint256 received = gcc.balanceOf(address(this)) - beforeBal;
        require(received > 0, "no tokens received");

        // Escrow grows by what actually landed (not the nominal 50e18)
        escrowedTokens         += received;
        totalReceivedThisRound += received;
    }

    function _register(address user) internal {
        if (!isRoundActive()) {
            currentRound += 1;
            roundStart = block.timestamp;
        }
        require(!hasJoinedThisRound[currentRound][user], "Already joined");
        hasJoinedThisRound[currentRound][user] = true;
        participants.push(user);
        emit Joined(user, currentRound);
    }

    // ------- Round Close / Payout (public, solvency-safe) -------
    function checkTimeExpired() external {
        require(isRoundActive(), "No active round");
        require(block.timestamp >= roundStart + duration, "Time not up");

        uint256 n = participants.length;
        require(n > 0, "No players");
        uint256 thisRound = currentRound;
        address winner = participants[_rng(n)];

        uint256 prizePaid;
        uint256 refundEachFinal;

        if (roundMode == PrizeMode.Standard) {
            // Targets (ideal): 49 refund each, 1 per player as prize
            uint256 targetRefundEach = entryAmount - 1e18; // 49e18 if entry=50e18
            uint256 targetRefundAll  = targetRefundEach * n;

            // Available escrow right now
            uint256 available = escrowedTokens;

            // 1) Prioritize refunds. If escrow short, scale refunds evenly.
            if (available >= targetRefundAll) {
                refundEachFinal = targetRefundEach;        // full 49
            } else {
                refundEachFinal = available / n;           // scaled (floor)
            }
            uint256 refundsTotal = refundEachFinal * n;

            // 2) Prize is whatever remains after reserving refunds.
            uint256 prizeBudget = (available > refundsTotal) ? (available - refundsTotal) : 0;

            // Transfer prize now; leave refunds backed by escrow for pull-claims
            if (prizeBudget > 0) {
                escrowedTokens = available - prizeBudget;  // leave only refund liabilities in escrow
                gcc.safeTransfer(winner, prizeBudget);
                prizePaid = prizeBudget;
            } else {
                prizePaid = 0;
                // escrowedTokens already equals available, which equals refundsTotal here
            }

            // Snapshot round state
            roundResolved[thisRound]    = true;
            roundModeAtClose[thisRound] = PrizeMode.Standard;
            playersInRound[thisRound]   = n;
            winnerOfRound[thisRound]    = winner;
            refundPerPlayer[thisRound]  = refundEachFinal;

        } else {
            // Jackpot: winner takes all escrow
            uint256 available = escrowedTokens;
            if (available > 0) {
                escrowedTokens = 0;
                gcc.safeTransfer(winner, available);
                prizePaid = available;
            }

            roundResolved[thisRound]    = true;
            roundModeAtClose[thisRound] = PrizeMode.Jackpot;
            playersInRound[thisRound]   = n;
            winnerOfRound[thisRound]    = winner;
            refundPerPlayer[thisRound]  = 0;
        }

        // Optional tip from surplus only (never from escrow)
        if (closeTip > 0) {
            uint256 bal = gcc.balanceOf(address(this));
            uint256 surplus = (bal > escrowedTokens) ? (bal - escrowedTokens) : 0;
            uint256 tip = closeTip <= surplus ? closeTip : 0;
            if (tip > 0) {
                gcc.safeTransfer(msg.sender, tip);
                emit CloseTipPaid(msg.sender, tip);
            }
        }

        emit RoundCompleted(winner, thisRound, prizePaid, refundEachFinal);

        // reset live round state
        delete participants;
        roundStart = 0;
        totalReceivedThisRound = 0;
    }

    // ------- Pull-Refunds Claim (post-close) -------
    function claimRefund(uint256 round) public {
        require(roundResolved[round], "round not resolved");
        require(roundModeAtClose[round] == PrizeMode.Standard, "no refunds");
        require(hasJoinedThisRound[round][msg.sender], "not a participant");
        require(!refundClaimed[round][msg.sender], "already claimed");

        uint256 amount = refundPerPlayer[round];
        require(amount > 0, "no refund");

        refundClaimed[round][msg.sender] = true;

        // Pay from escrow
        require(escrowedTokens >= amount, "escrow insufficient");
        unchecked { escrowedTokens -= amount; }

        gcc.safeTransfer(msg.sender, amount);
        emit RefundClaimed(msg.sender, round, amount);
    }

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
                gcc.safeTransfer(u, amt);
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
    receive() external payable { emit Received(msg.sender, msg.value); }
}
