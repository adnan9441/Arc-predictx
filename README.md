# ARC PredictX — Decentralized Prediction Market

A full-stack decentralized YES/NO prediction market deployed on **Arc Testnet** (Chain ID: 5042002). Users bet native USDC on binary outcomes with proportional reward distribution.

---

## Overview

ARC PredictX enables permissionless prediction markets where:

- **Users** view active markets, bet YES or NO, and claim proportional rewards
- **Admin** creates markets with time-limited betting windows and resolves outcomes
- All logic is enforced on-chain — no trusted backend required

---

## Architecture

```
arc-predictx/
├── contracts/
│   └── ARCPredictX.sol          # Prediction market smart contract
├── scripts/
│   └── deploy.js                # Hardhat deployment script
├── test/
│   └── ARCPredictX.test.js      # 20+ unit tests
├── frontend/
│   ├── public/
│   │   └── deployer.html        # One-click browser deployer
│   ├── src/
│   │   ├── App.jsx              # Full React application
│   │   ├── main.jsx             # Entry point
│   │   └── deployment.json      # Contract ABI + address
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── hardhat.config.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Smart Contract — ARCPredictX

### Market Structure

```solidity
struct Market {
    uint256 id;
    string  question;
    uint256 endTime;
    uint256 totalYesAmount;
    uint256 totalNoAmount;
    bool    resolved;
    bool    outcome;  // true = YES wins, false = NO wins
}
```

### Storage Mappings

| Mapping | Purpose |
|---------|---------|
| `markets[id]` | Market data |
| `yesBets[id][user]` | User's YES bet amount |
| `noBets[id][user]` | User's NO bet amount |
| `claimed[id][user]` | Whether user already claimed |

### Functions

| Function | Access | Description |
|----------|--------|-------------|
| `createMarket(question, endTime)` | Admin | Create new YES/NO market |
| `buyYes(marketId)` | Public (payable) | Bet on YES |
| `buyNo(marketId)` | Public (payable) | Bet on NO |
| `resolveMarket(marketId, outcome)` | Admin | Declare winner after endTime |
| `claimReward(marketId)` | Public | Claim proportional reward |
| `getMarket(marketId)` | View | Full market data |
| `getUserBets(marketId, user)` | View | User's bets + claim status |
| `getClaimable(marketId, user)` | View | Claimable reward amount |

### Security

- Custom errors for gas-efficient reverts
- Checks-Effects-Interactions pattern in `claimReward`
- Double-claim prevention via `claimed` mapping
- Time-based access control (no bets after endTime)
- No external dependencies — zero OpenZeppelin imports needed

---

## Reward Calculation

Rewards use **proportional pool distribution**:

```
totalPool = totalYesAmount + totalNoAmount

If YES wins:
  reward = (userYesBet / totalYesAmount) × totalPool

If NO wins:
  reward = (userNoBet / totalNoAmount) × totalPool
```

### Example

| User | Bet | Amount |
|------|-----|--------|
| Alice | YES | 3 USDC |
| Bob | YES | 1 USDC |
| Carol | NO | 4 USDC |

Total Pool = 8 USDC, Total YES = 4 USDC, Total NO = 4 USDC

**If YES wins:**
- Alice: (3/4) × 8 = **6 USDC** (+3 profit)
- Bob: (1/4) × 8 = **2 USDC** (+1 profit)
- Carol: **0 USDC** (lost 4)

**If NO wins:**
- Carol: (4/4) × 8 = **8 USDC** (+4 profit)
- Alice: **0 USDC** (lost 3)
- Bob: **0 USDC** (lost 1)

---

## ARC Testnet Setup

### Network Details

| Parameter | Value |
|-----------|-------|
| Network Name | Arc Network Testnet |
| RPC URL | `https://rpc.testnet.arc.network` |
| Chain ID | `5042002` (hex: `0x4CEF52`) |
| Currency | USDC |
| Explorer | `https://testnet.arcscan.app` |

### Add to MetaMask

The dApp auto-adds Arc Testnet on first connect. Manual setup:

1. Open MetaMask → Networks → Add Network
2. Enter the details from the table above
3. Set Currency Symbol to `USDC`, Decimals to `18`
4. Save

### Get Testnet USDC

Use the Arc Testnet faucet to get test tokens for gas + betting.

---

## Deployment

### Option A: Browser Deployer (Recommended)

Zero setup — no Node.js, no Hardhat, no Remix:

1. Open `deployer.html` in your browser (or deploy frontend to Vercel first)
2. Click **"Deploy ARCPredictX Contract"**
3. MetaMask connects, switches to Arc Testnet, compiles + deploys
4. Copy the deployed contract address
5. Paste into the dApp's contract config field

### Option B: Hardhat CLI

```bash
# 1. Install dependencies
cd arc-predictx
npm install

# 2. Configure .env
cp .env.example .env
# Edit .env with your private key

# 3. Compile
npx hardhat compile

# 4. Run tests
npx hardhat test

# 5. Deploy to Arc Testnet
npx hardhat run scripts/deploy.js --network arcTestnet
```

The deploy script automatically writes `frontend/src/deployment.json` with the contract address and ABI.

---

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`

### Build for Production

```bash
npm run build
```

Deploy the `dist/` folder to Vercel, Netlify, or any static host.

### Vercel Deployment

```bash
cd frontend
npx vercel --prod
```

---

## Frontend Pages

### Markets (Home)
- Lists all prediction markets
- Shows question, YES/NO pool sizes, time remaining
- Visual pool distribution bar (green/red)
- Percentage odds display
- Input field + YES/NO bet buttons
- Disabled after market expiry

### My Positions
- Shows all markets where user has placed bets
- Displays YES bet amount, NO bet amount
- Shows claimable reward after resolution
- Claim button for resolved winning positions
- "Claimed" status indicator

### Admin Panel
- Only visible to deployer/admin wallet
- Create Market form: question + duration (days/hours)
- Resolve Market section: shows all expired unresolved markets
- Resolve YES or Resolve NO buttons
- All Markets overview with live/pending/resolved status

---

## Environment Variables

For Hardhat deployment only:

```
PRIVATE_KEY=your_private_key_without_0x
```

The frontend uses no env vars — the contract address is stored in `localStorage` or `deployment.json`.

---

## Testing

```bash
npx hardhat test
```

Test coverage:
- Deployment (admin set, zero markets)
- createMarket (correct data, incrementing, events, access control, time validation)
- buyYes/buyNo (pool updates, accumulation, events, zero bet, expiry, invalid ID)
- resolveMarket (YES/NO outcomes, events, access control, timing, double-resolve)
- claimReward (proportional math, events, access control, double-claim, loser rejection)
- View functions (getUserBets, getClaimable edge cases)

---

## Screenshots

> *Replace with actual screenshots after deployment*

| Screen | Description |
|--------|-------------|
| `screenshot-markets.png` | Markets listing with pool bars |
| `screenshot-bet.png` | Placing a YES/NO bet |
| `screenshot-positions.png` | My Positions with claimable rewards |
| `screenshot-admin.png` | Admin panel — create + resolve |
| `screenshot-deployer.png` | Browser deployer in action |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contract | Solidity 0.8.20 |
| Development | Hardhat |
| Frontend | React 18 + Vite |
| Web3 | ethers.js v6 |
| Wallet | MetaMask |
| Blockchain | Arc Testnet (5042002) |
| Deployment | Vercel (frontend) + Browser deployer |

---

## License

MIT
