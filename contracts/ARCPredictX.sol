// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ARCPredictX — Decentralized YES/NO Prediction Market
/// @notice Users bet native tokens on binary outcomes. Rewards are proportional pool distribution.
/// @dev Deployed on Arc Testnet (chain 5042002). Uses checks-effects-interactions pattern.
contract ARCPredictX {

    struct Market {
        uint256 id;
        string  question;
        uint256 endTime;
        uint256 totalYesAmount;
        uint256 totalNoAmount;
        bool    resolved;
        bool    outcome;       // true = YES wins, false = NO wins
    }

    address public admin;
    uint256 public marketCount;

    mapping(uint256 => Market)                            public markets;
    mapping(uint256 => mapping(address => uint256))       public yesBets;
    mapping(uint256 => mapping(address => uint256))       public noBets;
    mapping(uint256 => mapping(address => bool))          public claimed;

    // ── Events ──────────────────────────────────────────
    event MarketCreated(uint256 indexed id, string question, uint256 endTime);
    event BetPlaced(uint256 indexed id, address indexed user, bool isYes, uint256 amount);
    event MarketResolved(uint256 indexed id, bool outcome);
    event RewardClaimed(uint256 indexed id, address indexed user, uint256 reward);

    // ── Errors ──────────────────────────────────────────
    error OnlyAdmin();
    error EndTimeInPast();
    error MarketExpired();
    error MarketNotExpired();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error ZeroBet();
    error NotWinner();
    error AlreadyClaimed();
    error TransferFailed();
    error InvalidMarket();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    // ── Admin Functions ─────────────────────────────────

    /// @notice Create a new prediction market
    /// @param question The YES/NO question
    /// @param endTime  Unix timestamp when betting closes
    function createMarket(string memory question, uint256 endTime) external onlyAdmin {
        if (endTime <= block.timestamp) revert EndTimeInPast();

        uint256 id = marketCount;
        markets[id] = Market({
            id:             id,
            question:       question,
            endTime:        endTime,
            totalYesAmount: 0,
            totalNoAmount:  0,
            resolved:       false,
            outcome:        false
        });
        marketCount++;

        emit MarketCreated(id, question, endTime);
    }

    /// @notice Resolve a market with the outcome
    /// @param marketId The market to resolve
    /// @param outcome  true = YES wins, false = NO wins
    function resolveMarket(uint256 marketId, bool outcome) external onlyAdmin {
        if (marketId >= marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (block.timestamp < m.endTime) revert MarketNotExpired();
        if (m.resolved) revert MarketAlreadyResolved();

        // Effects
        m.resolved = true;
        m.outcome  = outcome;

        emit MarketResolved(marketId, outcome);
    }

    // ── User Functions ──────────────────────────────────

    /// @notice Bet on YES for a market
    function buyYes(uint256 marketId) external payable {
        if (marketId >= marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (block.timestamp >= m.endTime) revert MarketExpired();
        if (msg.value == 0) revert ZeroBet();

        // Effects
        yesBets[marketId][msg.sender] += msg.value;
        m.totalYesAmount += msg.value;

        emit BetPlaced(marketId, msg.sender, true, msg.value);
    }

    /// @notice Bet on NO for a market
    function buyNo(uint256 marketId) external payable {
        if (marketId >= marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (block.timestamp >= m.endTime) revert MarketExpired();
        if (msg.value == 0) revert ZeroBet();

        // Effects
        noBets[marketId][msg.sender] += msg.value;
        m.totalNoAmount += msg.value;

        emit BetPlaced(marketId, msg.sender, false, msg.value);
    }

    /// @notice Claim reward if on the winning side
    /// @dev reward = (userBet / winningPool) * totalPool
    function claimReward(uint256 marketId) external {
        if (marketId >= marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (!m.resolved) revert MarketNotResolved();
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed();

        uint256 totalPool = m.totalYesAmount + m.totalNoAmount;
        uint256 reward;

        if (m.outcome) {
            // YES wins
            uint256 userBet = yesBets[marketId][msg.sender];
            if (userBet == 0) revert NotWinner();
            reward = (userBet * totalPool) / m.totalYesAmount;
        } else {
            // NO wins
            uint256 userBet = noBets[marketId][msg.sender];
            if (userBet == 0) revert NotWinner();
            reward = (userBet * totalPool) / m.totalNoAmount;
        }

        // Effects
        claimed[marketId][msg.sender] = true;

        // Interactions
        (bool ok, ) = payable(msg.sender).call{value: reward}("");
        if (!ok) revert TransferFailed();

        emit RewardClaimed(marketId, msg.sender, reward);
    }

    // ── View Helpers ────────────────────────────────────

    /// @notice Get full market data
    function getMarket(uint256 marketId) external view returns (
        uint256 id,
        string memory question,
        uint256 endTime,
        uint256 totalYesAmount,
        uint256 totalNoAmount,
        bool resolved,
        bool outcome
    ) {
        Market storage m = markets[marketId];
        return (m.id, m.question, m.endTime, m.totalYesAmount, m.totalNoAmount, m.resolved, m.outcome);
    }

    /// @notice Get user's bets for a market
    function getUserBets(uint256 marketId, address user) external view returns (
        uint256 yesBet,
        uint256 noBet,
        bool hasClaimed
    ) {
        return (
            yesBets[marketId][user],
            noBets[marketId][user],
            claimed[marketId][user]
        );
    }

    /// @notice Check if user can claim and how much
    function getClaimable(uint256 marketId, address user) external view returns (uint256) {
        Market storage m = markets[marketId];
        if (!m.resolved || claimed[marketId][user]) return 0;

        uint256 totalPool = m.totalYesAmount + m.totalNoAmount;
        if (totalPool == 0) return 0;

        if (m.outcome) {
            uint256 bet = yesBets[marketId][user];
            if (bet == 0 || m.totalYesAmount == 0) return 0;
            return (bet * totalPool) / m.totalYesAmount;
        } else {
            uint256 bet = noBets[marketId][user];
            if (bet == 0 || m.totalNoAmount == 0) return 0;
            return (bet * totalPool) / m.totalNoAmount;
        }
    }
}
