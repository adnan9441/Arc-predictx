import { useState, useEffect, useCallback, useRef } from "react";
import { BrowserProvider, Contract, ContractFactory, formatEther, parseEther, getAddress, isAddress } from "ethers";
import deployment from "./deployment.json";

/* ─── Arc Testnet ──────────────────────────────────────── */
const ARC = {
  chainId: "0x4CEF52",
  chainName: "Arc Network Testnet",
  rpcUrls: ["https://rpc.testnet.arc.network"],
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};
const ABI = deployment.abi;
const SAVED_ADDR_KEY = "predictx_contract";
const SAVED_CONN_KEY = "predictx_connected";

function getContractAddr() {
  try { const s = localStorage.getItem(SAVED_ADDR_KEY); if (s && isAddress(s)) return getAddress(s); } catch {}
  const d = deployment.address; return d.includes("YOUR") ? "" : d;
}

/* ─── Embedded Solidity Source (for browser deploy) ──── */
const SOL_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract ARCPredictX {
    struct Market { uint256 id; string question; uint256 endTime; uint256 totalYesAmount; uint256 totalNoAmount; bool resolved; bool outcome; }
    address public admin; uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => uint256)) public yesBets;
    mapping(uint256 => mapping(address => uint256)) public noBets;
    mapping(uint256 => mapping(address => bool)) public claimed;
    event MarketCreated(uint256 indexed id, string question, uint256 endTime);
    event BetPlaced(uint256 indexed id, address indexed user, bool isYes, uint256 amount);
    event MarketResolved(uint256 indexed id, bool outcome);
    event RewardClaimed(uint256 indexed id, address indexed user, uint256 reward);
    error OnlyAdmin(); error EndTimeInPast(); error MarketExpired(); error MarketNotExpired();
    error MarketAlreadyResolved(); error MarketNotResolved(); error ZeroBet();
    error NotWinner(); error AlreadyClaimed(); error TransferFailed(); error InvalidMarket();
    modifier onlyAdmin() { if (msg.sender != admin) revert OnlyAdmin(); _; }
    constructor() { admin = msg.sender; }
    function createMarket(string memory question, uint256 endTime) external onlyAdmin {
        if (endTime <= block.timestamp) revert EndTimeInPast();
        uint256 id = marketCount;
        markets[id] = Market({ id: id, question: question, endTime: endTime, totalYesAmount: 0, totalNoAmount: 0, resolved: false, outcome: false });
        marketCount++; emit MarketCreated(id, question, endTime);
    }
    function resolveMarket(uint256 marketId, bool outcome) external onlyAdmin {
        if (marketId >= marketCount) revert InvalidMarket(); Market storage m = markets[marketId];
        if (block.timestamp < m.endTime) revert MarketNotExpired(); if (m.resolved) revert MarketAlreadyResolved();
        m.resolved = true; m.outcome = outcome; emit MarketResolved(marketId, outcome);
    }
    function buyYes(uint256 marketId) external payable {
        if (marketId >= marketCount) revert InvalidMarket(); Market storage m = markets[marketId];
        if (block.timestamp >= m.endTime) revert MarketExpired(); if (msg.value == 0) revert ZeroBet();
        yesBets[marketId][msg.sender] += msg.value; m.totalYesAmount += msg.value;
        emit BetPlaced(marketId, msg.sender, true, msg.value);
    }
    function buyNo(uint256 marketId) external payable {
        if (marketId >= marketCount) revert InvalidMarket(); Market storage m = markets[marketId];
        if (block.timestamp >= m.endTime) revert MarketExpired(); if (msg.value == 0) revert ZeroBet();
        noBets[marketId][msg.sender] += msg.value; m.totalNoAmount += msg.value;
        emit BetPlaced(marketId, msg.sender, false, msg.value);
    }
    function claimReward(uint256 marketId) external {
        if (marketId >= marketCount) revert InvalidMarket(); Market storage m = markets[marketId];
        if (!m.resolved) revert MarketNotResolved(); if (claimed[marketId][msg.sender]) revert AlreadyClaimed();
        uint256 totalPool = m.totalYesAmount + m.totalNoAmount; uint256 reward;
        if (m.outcome) { uint256 ub = yesBets[marketId][msg.sender]; if (ub == 0) revert NotWinner(); reward = (ub * totalPool) / m.totalYesAmount; }
        else { uint256 ub = noBets[marketId][msg.sender]; if (ub == 0) revert NotWinner(); reward = (ub * totalPool) / m.totalNoAmount; }
        claimed[marketId][msg.sender] = true;
        (bool ok, ) = payable(msg.sender).call{value: reward}(""); if (!ok) revert TransferFailed();
        emit RewardClaimed(marketId, msg.sender, reward);
    }
    function getMarket(uint256 marketId) external view returns (uint256 id, string memory question, uint256 endTime, uint256 totalYesAmount, uint256 totalNoAmount, bool resolved, bool outcome) {
        Market storage m = markets[marketId]; return (m.id, m.question, m.endTime, m.totalYesAmount, m.totalNoAmount, m.resolved, m.outcome);
    }
    function getUserBets(uint256 marketId, address user) external view returns (uint256 yesBet, uint256 noBet, bool hasClaimed) {
        return (yesBets[marketId][user], noBets[marketId][user], claimed[marketId][user]);
    }
    function getClaimable(uint256 marketId, address user) external view returns (uint256) {
        Market storage m = markets[marketId]; if (!m.resolved || claimed[marketId][user]) return 0;
        uint256 tp = m.totalYesAmount + m.totalNoAmount; if (tp == 0) return 0;
        if (m.outcome) { uint256 b = yesBets[marketId][user]; if (b == 0 || m.totalYesAmount == 0) return 0; return (b * tp) / m.totalYesAmount; }
        else { uint256 b = noBets[marketId][user]; if (b == 0 || m.totalNoAmount == 0) return 0; return (b * tp) / m.totalNoAmount; }
    }
}`;

/* ─── Helpers ──────────────────────────────────────────── */
const short = (a) => a ? `${a.slice(0,6)}···${a.slice(-4)}` : "";
const fmtAmt = (v) => { const n = Number(formatEther(v)); return n < 0.0001 && n > 0 ? "<0.0001" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }); };
const timeLeft = (ts) => {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86400), h = Math.floor((diff % 86400) / 3600), m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

/* ═══════════════════════════════════════════════════════ */
export default function App() {
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("0");
  const [isArc, setIsArc] = useState(false);
  const [contractAddr, setContractAddr] = useState(getContractAddr);
  const [addrInput, setAddrInput] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [page, setPage] = useState("markets");
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState("");
  const [toast, setToast] = useState(null);
  const [newQ, setNewQ] = useState("");
  const [newDays, setNewDays] = useState("1");
  const [newHours, setNewHours] = useState("0");
  // Deployer
  const [deployStatus, setDeployStatus] = useState("");
  const [deployPct, setDeployPct] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const deployed = !!contractAddr && isAddress(contractAddr);
  const getContract = useCallback((s) => s && deployed ? new Contract(getAddress(contractAddr), ABI, s) : null, [contractAddr, deployed]);

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 5000); };

  /* ─── Connect ── */
  const connect = useCallback(async (silent = false) => {
    try {
      if (!window.ethereum) { if (!silent) showToast("Install MetaMask", "err"); return; }
      const bp = new BrowserProvider(window.ethereum);
      const accs = silent ? await bp.send("eth_accounts", []) : await bp.send("eth_requestAccounts", []);
      if (!accs.length) return;
      const s = await bp.getSigner();
      const addr = await s.getAddress();
      const { chainId } = await bp.getNetwork();
      const ok = Number(chainId) === 5042002;
      setSigner(s); setAccount(addr); setIsArc(ok);
      localStorage.setItem(SAVED_CONN_KEY, "1");
      const bal = await bp.getBalance(addr);
      setBalance(bal.toString());
      if (!ok && !silent) {
        try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC.chainId }] }); }
        catch (e) { if (e.code === 4902 || e.code === -32603) await window.ethereum.request({ method: "wallet_addEthereumChain", params: [ARC] }); }
      }
    } catch (e) { if (!silent) showToast(e.message, "err"); }
  }, []);

  const disconnect = useCallback(() => {
    setAccount(""); setSigner(null); setIsArc(false); setBalance("0"); setIsAdmin(false);
    localStorage.removeItem(SAVED_CONN_KEY);
  }, []);

  /* ─── In-App Deploy ── */
  const deployContract = useCallback(async () => {
    if (!signer) return showToast("Connect wallet first", "err");
    setDeploying(true); setDeployPct(5); setDeployStatus("Loading Solidity compiler…");
    try {
      const workerCode = `self.onmessage = function(e) {
        try {
          importScripts("https://binaries.soliditylang.org/bin/soljson-v0.8.20+commit.a1b79de6.js");
          self.postMessage({t:"loaded"});
          var compile = Module.cwrap("solidity_compile","string",["string","number","number"]);
          var input = JSON.stringify({language:"Solidity",sources:{"C.sol":{content:e.data}},
            settings:{optimizer:{enabled:true,runs:200},outputSelection:{"*":{"*":["abi","evm.bytecode.object"]}}}});
          self.postMessage({t:"done",d:compile(input,0,0)});
        } catch(err) { self.postMessage({t:"err",d:err.message}); }
      };`;
      const blob = new Blob([workerCode], { type: "text/javascript" });
      const worker = new Worker(URL.createObjectURL(blob));
      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.t === "loaded") { setDeployPct(40); setDeployStatus("Compiling contract…"); }
          else if (e.data.t === "done") resolve(e.data.d);
          else reject(new Error(e.data.d));
        };
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage(SOL_SOURCE);
      });
      worker.terminate();

      const output = JSON.parse(result);
      if (output.errors) { const errs = output.errors.filter(e => e.severity === "error"); if (errs.length) throw new Error(errs[0].formattedMessage); }
      const compiled = output.contracts["C.sol"]["ARCPredictX"];
      const bytecode = "0x" + compiled.evm.bytecode.object;

      setDeployPct(65); setDeployStatus("Deploying to Arc Testnet…");
      const factory = new ContractFactory(ABI, bytecode, signer);
      const contract = await factory.deploy();
      setDeployPct(80); setDeployStatus("Waiting for confirmation…");
      await contract.waitForDeployment();
      const addr = await contract.getAddress();

      setContractAddr(addr);
      localStorage.setItem(SAVED_ADDR_KEY, addr);
      setDeployPct(100); setDeployStatus("Deployed!");
      showToast("Contract deployed: " + short(addr));
    } catch (e) {
      showToast(e?.reason || e?.message || "Deploy failed", "err");
      setDeployStatus(""); setDeployPct(0);
    } finally { setDeploying(false); }
  }, [signer]);

  /* ─── Load Markets ── */
  const loadMarkets = useCallback(async () => {
    if (!signer || !deployed || !isArc) return;
    try {
      const c = getContract(signer); if (!c) return;
      const count = await c.marketCount();
      const n = Number(count);
      const addr = await signer.getAddress();
      const arr = [];
      for (let i = 0; i < n; i++) {
        const m = await c.getMarket(i);
        const ub = await c.getUserBets(i, addr);
        const cl = await c.getClaimable(i, addr);
        arr.push({
          id: Number(m.id), question: m.question, endTime: Number(m.endTime),
          totalYes: m.totalYesAmount.toString(), totalNo: m.totalNoAmount.toString(),
          resolved: m.resolved, outcome: m.outcome,
          yesBet: ub.yesBet.toString(), noBet: ub.noBet.toString(),
          claimed: ub.hasClaimed, claimable: cl.toString(),
        });
      }
      setMarkets(arr.reverse());
      try { const adm = await c.admin(); setIsAdmin(adm.toLowerCase() === addr.toLowerCase()); } catch { setIsAdmin(false); }
    } catch (e) { console.error("Load failed:", e); }
  }, [signer, deployed, isArc, getContract]);

  /* ─── Effects ── */
  useEffect(() => { if (localStorage.getItem(SAVED_CONN_KEY) === "1") connect(true); }, [connect]);
  useEffect(() => { loadMarkets(); const id = setInterval(loadMarkets, 15000); return () => clearInterval(id); }, [loadMarkets]);
  useEffect(() => {
    if (!window.ethereum) return;
    const hc = () => connect(true);
    const ha = (a) => { if (!a.length) disconnect(); else connect(true); };
    window.ethereum.on("chainChanged", hc); window.ethereum.on("accountsChanged", ha);
    return () => { window.ethereum.removeListener("chainChanged", hc); window.ethereum.removeListener("accountsChanged", ha); };
  }, [connect, disconnect]);

  /* ─── Actions ── */
  const execTx = async (label, fn) => {
    try { setLoading(label); const tx = await fn(); await tx.wait(); await loadMarkets(); showToast(`${label} successful!`); }
    catch (e) { showToast(e?.reason || e?.info?.error?.message || e?.message || "Failed", "err"); }
    finally { setLoading(""); }
  };
  const betYes = (id, amt) => execTx("Betting YES", () => getContract(signer).buyYes(id, { value: parseEther(amt) }));
  const betNo = (id, amt) => execTx("Betting NO", () => getContract(signer).buyNo(id, { value: parseEther(amt) }));
  const claim = (id) => execTx("Claiming", () => getContract(signer).claimReward(id));
  const createMkt = () => {
    if (!newQ.trim()) return showToast("Enter a question", "err");
    const endTime = Math.floor(Date.now() / 1000) + Number(newDays) * 86400 + Number(newHours) * 3600;
    execTx("Creating market", async () => {
      const tx = await getContract(signer).createMarket(newQ.trim(), endTime);
      setNewQ(""); setNewDays("1"); setNewHours("0"); return tx;
    });
  };
  const resolve = (id, outcome) => execTx("Resolving", () => getContract(signer).resolveMarket(id, outcome));

  const saveAddr = () => {
    if (!addrInput || !isAddress(addrInput)) return;
    const a = getAddress(addrInput);
    setContractAddr(a); localStorage.setItem(SAVED_ADDR_KEY, a); setAddrInput(""); setShowManual(false);
  };

  /* ═══ RENDER ════════════════════════════════════════════ */
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700;800&display=swap');
        *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
        :root{
          --bg:#050810;--sf:rgba(12,16,26,.92);--sf2:rgba(14,20,34,.7);
          --bd:rgba(99,102,241,.06);--bdh:rgba(99,102,241,.14);
          --tx:#e8edf5;--dm:#4a5568;
          --pr:#6366f1;--pr2:#818cf8;--prg:rgba(99,102,241,.08);
          --yes:#10b981;--yesg:rgba(16,185,129,.08);
          --no:#ef4444;--nog:rgba(239,68,68,.08);
          --warn:#f59e0b;--warng:rgba(245,158,11,.08);
          --mono:'JetBrains Mono',monospace;--sans:'Outfit',system-ui,sans-serif;
        }
        html{height:100%}
        body{background:var(--bg);color:var(--tx);font-family:var(--sans);min-height:100vh;overflow-x:hidden}
        body::before{
          content:'';position:fixed;inset:0;
          background:radial-gradient(ellipse 50% 40% at 20% 10%,rgba(99,102,241,.04) 0%,transparent 55%),
                     radial-gradient(ellipse 35% 30% at 80% 85%,rgba(129,140,248,.03) 0%,transparent 55%);
          pointer-events:none;
        }
        body::after{
          content:'';position:fixed;inset:0;
          background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          opacity:.018;pointer-events:none;
        }
        .root{position:relative;z-index:1;max-width:720px;margin:0 auto;padding:32px 16px 80px}

        /* ── Header ── */
        .hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px}
        .hdr-left{display:flex;align-items:center;gap:10px}
        .hdr-ico{
          width:36px;height:36px;border-radius:10px;
          background:linear-gradient(135deg,var(--pr),var(--pr2));
          display:flex;align-items:center;justify-content:center;
          font-size:16px;font-weight:800;color:#fff;font-family:var(--mono);
          box-shadow:0 0 20px rgba(99,102,241,.2);
        }
        .hdr-nm{font-family:var(--mono);font-size:22px;font-weight:700;letter-spacing:-.5px}
        .hdr-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .hdr-bal{font-family:var(--mono);font-size:11px;color:var(--dm);padding:6px 12px;background:var(--sf2);border:1px solid var(--bd);border-radius:8px}
        .hdr-addr{font-family:var(--mono);font-size:11px;color:var(--pr2);padding:6px 12px;background:var(--prg);border:1px solid rgba(99,102,241,.12);border-radius:8px}
        .hdr-dc{
          width:28px;height:28px;border-radius:7px;background:rgba(255,255,255,.04);
          border:1px solid var(--bd);color:var(--dm);cursor:pointer;font-size:12px;
          display:flex;align-items:center;justify-content:center;transition:all .15s;
        }
        .hdr-dc:hover{background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.15);color:var(--no)}

        /* ── Card ── */
        .crd{
          background:var(--sf);border:1px solid var(--bd);border-radius:14px;
          padding:20px 22px;margin-bottom:10px;backdrop-filter:blur(20px);
          -webkit-backdrop-filter:blur(20px);transition:border-color .25s;
          animation:up .35s ease both;
        }
        .crd:hover{border-color:var(--bdh)}
        @keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

        /* ── Landing / Deploy Page ── */
        .land{text-align:center;padding:48px 24px 36px}
        .land-ico{
          width:80px;height:80px;border-radius:22px;
          background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(129,140,248,.08));
          border:1px solid rgba(99,102,241,.15);
          display:flex;align-items:center;justify-content:center;
          margin:0 auto 28px;font-size:36px;
          box-shadow:0 0 40px rgba(99,102,241,.08);
        }
        .land h2{font-family:var(--mono);font-size:24px;font-weight:700;margin-bottom:8px;letter-spacing:-.5px}
        .land p{color:var(--dm);font-size:14px;line-height:1.6;margin-bottom:32px;max-width:380px;margin-left:auto;margin-right:auto}

        .land-features{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:32px;text-align:left}
        .land-feat{
          padding:14px 16px;background:rgba(8,12,22,.5);border:1px solid var(--bd);
          border-radius:10px;transition:border-color .2s;
        }
        .land-feat:hover{border-color:var(--bdh)}
        .land-feat-ico{font-size:18px;margin-bottom:8px}
        .land-feat-t{font-size:12px;font-weight:600;margin-bottom:3px}
        .land-feat-d{font-size:11px;color:var(--dm);line-height:1.4}

        .deploy-btn{
          width:100%;padding:16px;background:linear-gradient(135deg,var(--pr),var(--pr2));
          color:#fff;border:none;border-radius:12px;font-family:var(--sans);
          font-size:15px;font-weight:700;cursor:pointer;transition:all .25s;
          display:flex;align-items:center;justify-content:center;gap:8px;
        }
        .deploy-btn:hover:not(:disabled){box-shadow:0 4px 32px rgba(99,102,241,.3);transform:translateY(-2px)}
        .deploy-btn:active:not(:disabled){transform:translateY(0)}
        .deploy-btn:disabled{opacity:.5;cursor:not-allowed}

        .prog{width:100%;height:5px;background:rgba(99,102,241,.08);border-radius:3px;overflow:hidden;margin-top:14px}
        .prog-bar{height:100%;background:linear-gradient(90deg,var(--pr),var(--pr2));border-radius:3px;transition:width .4s}
        .deploy-st{font-family:var(--mono);font-size:11px;color:var(--dm);text-align:center;margin-top:10px;min-height:18px}

        .or-divider{
          display:flex;align-items:center;gap:12px;margin:20px 0;color:var(--dm);font-size:11px;
        }
        .or-divider::before,.or-divider::after{content:'';flex:1;height:1px;background:var(--bd)}

        .manual-toggle{
          background:none;border:none;color:var(--pr2);font-size:12px;font-weight:600;
          cursor:pointer;font-family:var(--sans);transition:opacity .15s;
        }
        .manual-toggle:hover{opacity:.8}
        .manual-row{display:flex;gap:8px;margin-top:10px}
        .manual-row .inp{flex:1}
        .manual-row .btn-save{
          flex:0 0 auto;padding:11px 20px;border-radius:9px;
          background:linear-gradient(135deg,var(--pr),var(--pr2));
          color:#fff;border:none;font-weight:700;cursor:pointer;font-family:var(--sans);font-size:13px;
        }
        .manual-row .btn-save:disabled{opacity:.3;cursor:not-allowed}

        /* ── Nav ── */
        .nav{
          display:flex;gap:2px;background:var(--sf);border:1px solid var(--bd);
          border-radius:12px;padding:3px;margin-bottom:20px;
        }
        .nav-btn{
          flex:1;background:none;border:none;color:var(--dm);font-family:var(--sans);
          font-size:13px;font-weight:600;padding:10px 0;border-radius:10px;cursor:pointer;transition:all .2s;
        }
        .nav-btn:hover{color:var(--tx)}
        .nav-btn.on{background:var(--prg);color:var(--pr2);box-shadow:0 0 10px rgba(99,102,241,.05)}

        /* ── Market Card ── */
        .mkt-q{font-size:15px;font-weight:600;line-height:1.4;margin-bottom:12px}
        .mkt-meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
        .mkt-tag{font-family:var(--mono);font-size:10px;font-weight:600;padding:4px 10px;border-radius:6px;letter-spacing:.3px}
        .tag-time{background:var(--prg);color:var(--pr2);border:1px solid rgba(99,102,241,.1)}
        .tag-live{background:var(--yesg);color:var(--yes);border:1px solid rgba(16,185,129,.12)}
        .tag-ended{background:var(--warng);color:var(--warn);border:1px solid rgba(245,158,11,.12)}
        .tag-yes-win{background:var(--yesg);color:var(--yes);border:1px solid rgba(16,185,129,.12)}
        .tag-no-win{background:var(--nog);color:var(--no);border:1px solid rgba(239,68,68,.12)}
        .mkt-pools{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
        .pool-box{padding:12px;border-radius:10px;text-align:center;background:rgba(8,12,22,.5);border:1px solid var(--bd)}
        .pool-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
        .pool-yes .pool-lbl{color:var(--yes)} .pool-no .pool-lbl{color:var(--no)}
        .pool-val{font-family:var(--mono);font-size:16px;font-weight:700}
        .pool-u{font-size:10px;color:var(--dm);margin-left:3px}
        .mkt-bet{display:flex;gap:8px;align-items:stretch}
        .inp{
          flex:1;background:rgba(8,12,22,.6);border:1px solid var(--bd);
          border-radius:9px;padding:11px 12px;color:var(--tx);font-family:var(--mono);
          font-size:13px;outline:none;transition:border-color .2s;min-width:0;
        }
        .inp::placeholder{color:#1e2a3d} .inp:focus{border-color:rgba(99,102,241,.25)}
        .btn-yes,.btn-no{
          padding:11px 18px;border:none;border-radius:9px;font-family:var(--sans);
          font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;white-space:nowrap;
        }
        .btn-yes{background:rgba(16,185,129,.12);color:var(--yes);border:1px solid rgba(16,185,129,.18)}
        .btn-yes:hover:not(:disabled){background:rgba(16,185,129,.2);box-shadow:0 0 12px rgba(16,185,129,.12)}
        .btn-no{background:rgba(239,68,68,.1);color:var(--no);border:1px solid rgba(239,68,68,.15)}
        .btn-no:hover:not(:disabled){background:rgba(239,68,68,.18);box-shadow:0 0 12px rgba(239,68,68,.1)}
        .btn-yes:disabled,.btn-no:disabled{opacity:.3;cursor:not-allowed}

        /* ── Positions ── */
        .pos-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
        .pos-chip{font-family:var(--mono);font-size:11px;font-weight:600;padding:5px 12px;border-radius:6px}
        .pos-y{background:var(--yesg);color:var(--yes);border:1px solid rgba(16,185,129,.12)}
        .pos-n{background:var(--nog);color:var(--no);border:1px solid rgba(239,68,68,.12)}
        .pos-cl{background:var(--prg);color:var(--pr2);border:1px solid rgba(99,102,241,.12)}
        .btn-claim{
          padding:10px 24px;background:linear-gradient(135deg,var(--pr),var(--pr2));
          color:#fff;border:none;border-radius:9px;font-family:var(--sans);
          font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;
        }
        .btn-claim:hover:not(:disabled){box-shadow:0 4px 20px rgba(99,102,241,.25);transform:translateY(-1px)}
        .btn-claim:disabled{opacity:.3;cursor:not-allowed}
        .claimed-tag{font-size:11px;color:var(--yes);font-weight:600}

        /* ── Admin ── */
        .adm-form{display:flex;flex-direction:column;gap:12px}
        .adm-lbl{font-size:11px;font-weight:600;color:var(--dm);margin-bottom:4px;letter-spacing:.3px}
        .adm-inp{
          width:100%;background:rgba(8,12,22,.6);border:1px solid var(--bd);
          border-radius:9px;padding:13px 14px;color:var(--tx);font-family:var(--mono);
          font-size:13px;outline:none;transition:border-color .2s;
        }
        .adm-inp:focus{border-color:rgba(99,102,241,.25)} .adm-inp::placeholder{color:#1e2a3d}
        .adm-row{display:flex;gap:8px} .adm-row>div{flex:1}
        .btn-create{
          padding:14px;width:100%;background:linear-gradient(135deg,var(--pr),var(--pr2));
          color:#fff;border:none;border-radius:10px;font-family:var(--sans);
          font-size:14px;font-weight:700;cursor:pointer;transition:all .2s;margin-top:4px;
        }
        .btn-create:hover:not(:disabled){box-shadow:0 4px 20px rgba(99,102,241,.25);transform:translateY(-1px)}
        .btn-create:disabled{opacity:.3;cursor:not-allowed}
        .resolve-row{display:flex;gap:8px;margin-top:10px}
        .btn-res{flex:1;padding:10px;border-radius:8px;font-family:var(--sans);font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;border:none}
        .btn-res-y{background:rgba(16,185,129,.1);color:var(--yes)} .btn-res-y:hover{background:rgba(16,185,129,.2)}
        .btn-res-n{background:rgba(239,68,68,.08);color:var(--no)} .btn-res-n:hover{background:rgba(239,68,68,.16)}

        /* ── Connect Card ── */
        .con-card{text-align:center;padding:60px 24px}
        .con-ico{
          width:64px;height:64px;border-radius:18px;
          background:linear-gradient(135deg,rgba(99,102,241,.1),rgba(129,140,248,.06));
          border:1px solid rgba(99,102,241,.12);
          display:flex;align-items:center;justify-content:center;
          margin:0 auto 24px;font-size:28px;box-shadow:0 0 30px rgba(99,102,241,.06);
        }
        .con-txt{color:var(--dm);font-size:15px;margin-bottom:28px;line-height:1.6}
        .con-btn{
          padding:16px 48px;background:linear-gradient(135deg,var(--pr),var(--pr2));
          color:#fff;border:none;border-radius:12px;font-family:var(--sans);
          font-size:15px;font-weight:700;cursor:pointer;transition:all .25s;
        }
        .con-btn:hover{box-shadow:0 4px 32px rgba(99,102,241,.3);transform:translateY(-2px)}

        /* ── Toast / Misc ── */
        .toast{
          position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
          padding:12px 24px;border-radius:10px;font-family:var(--mono);font-size:12px;
          z-index:999;animation:toastin .3s ease;max-width:90vw;text-align:center;backdrop-filter:blur(20px);
        }
        .toast-ok{background:rgba(16,185,129,.12);color:var(--yes);border:1px solid rgba(16,185,129,.2)}
        .toast-err{background:rgba(239,68,68,.1);color:var(--no);border:1px solid rgba(239,68,68,.15)}
        @keyframes toastin{from{opacity:0;transform:translateX(-50%) translateY(16px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .ld{color:var(--warn);font-family:var(--mono);font-size:12px;text-align:center;padding:12px;animation:pulse 1.5s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
        .empty{text-align:center;padding:40px 20px;color:var(--dm);font-size:14px}
        .ftr{text-align:center;margin-top:32px;color:var(--dm);font-size:10px;font-family:var(--mono);letter-spacing:1px;opacity:.4}

        @media(max-width:600px){
          .root{padding:20px 12px 64px}
          .hdr{flex-direction:column;align-items:flex-start}
          .hdr-right{width:100%}
          .mkt-bet{flex-direction:column}
          .pool-val{font-size:14px}
          .mkt-q{font-size:14px}
          .land-features{grid-template-columns:1fr}
          .land h2{font-size:20px}
        }
      `}</style>

      <div className="root">
        {/* ── Header ── */}
        <div className="hdr">
          <div className="hdr-left">
            <div className="hdr-ico">P</div>
            <span className="hdr-nm">PredictX</span>
          </div>
          {account ? (
            <div className="hdr-right">
              <span className="hdr-bal">{fmtAmt(balance)} USDC</span>
              <span className="hdr-addr">{short(account)}</span>
              {isArc && <span className="mkt-tag tag-live" style={{fontSize:9}}>Arc Testnet</span>}
              <button className="hdr-dc" onClick={disconnect} title="Disconnect">✕</button>
            </div>
          ) : null}
        </div>

        {/* ══ NOT CONNECTED ══ */}
        {!account && (
          <div className="crd con-card">
            <div className="con-ico">◈</div>
            <div className="con-txt">Decentralized prediction markets<br/>on Arc Testnet</div>
            <button className="con-btn" onClick={() => connect(false)}>Connect Wallet</button>
          </div>
        )}

        {/* ══ CONNECTED — NO CONTRACT ══ */}
        {account && isArc && !deployed && (
          <div className="crd land">
            <div className="land-ico">◈</div>
            <h2>Deploy PredictX</h2>
            <p>Launch your own prediction market contract on Arc Testnet. One click — no setup needed.</p>

            <div className="land-features">
              <div className="land-feat"><div className="land-feat-ico">🎯</div><div className="land-feat-t">Binary Markets</div><div className="land-feat-d">Create YES/NO prediction markets on any topic</div></div>
              <div className="land-feat"><div className="land-feat-ico">💰</div><div className="land-feat-t">Pool Rewards</div><div className="land-feat-d">Winners split the entire pool proportionally</div></div>
              <div className="land-feat"><div className="land-feat-ico">⛓️</div><div className="land-feat-t">Fully On-Chain</div><div className="land-feat-d">All bets and rewards enforced by smart contract</div></div>
              <div className="land-feat"><div className="land-feat-ico">⚡</div><div className="land-feat-t">Arc Testnet</div><div className="land-feat-d">Fast, low-cost transactions with native USDC</div></div>
            </div>

            <button className="deploy-btn" onClick={deployContract} disabled={deploying}>
              {deploying ? "Deploying…" : "🚀 Deploy Contract"}
            </button>

            {deploying && (
              <>
                <div className="prog"><div className="prog-bar" style={{width:`${deployPct}%`}} /></div>
                <div className="deploy-st">{deployStatus}</div>
              </>
            )}

            <div className="or-divider">or</div>
            <button className="manual-toggle" onClick={() => setShowManual(!showManual)}>
              {showManual ? "Hide" : "Already deployed? Paste contract address"}
            </button>

            {showManual && (
              <div className="manual-row">
                <input className="inp" placeholder="0x... contract address" value={addrInput} onChange={(e) => setAddrInput(e.target.value)} />
                <button className="btn-save" disabled={!addrInput || !isAddress(addrInput)} onClick={saveAddr}>Save</button>
              </div>
            )}
          </div>
        )}

        {/* ══ CONNECTED — CONTRACT DEPLOYED ══ */}
        {account && isArc && deployed && (
          <>
            <div className="nav">
              {[
                ["markets", "Markets"],
                ["positions", "My Positions"],
                ...(isAdmin ? [["admin", "Admin"]] : []),
              ].map(([k, l]) => (
                <button key={k} className={`nav-btn ${page === k ? "on" : ""}`} onClick={() => setPage(k)}>{l}</button>
              ))}
            </div>

            {loading && <div className="ld">{loading}…</div>}

            {/* ════ MARKETS ════ */}
            {page === "markets" && (
              <>
                {markets.length === 0 && <div className="empty">No markets yet.{isAdmin ? " Create one from the Admin tab." : " Admin will create markets soon."}</div>}
                {markets.map((m) => <MarketCard key={m.id} m={m} loading={loading} onYes={betYes} onNo={betNo} />)}
              </>
            )}

            {/* ════ POSITIONS ════ */}
            {page === "positions" && (
              <>
                {markets.filter(m => m.yesBet !== "0" || m.noBet !== "0").length === 0 && (
                  <div className="empty">No positions yet. Place a bet first!</div>
                )}
                {markets.filter(m => m.yesBet !== "0" || m.noBet !== "0").map((m) => (
                  <div key={m.id} className="crd">
                    <div className="mkt-q">{m.question}</div>
                    <div className="mkt-meta">
                      {m.resolved ? (
                        <span className={`mkt-tag ${m.outcome ? "tag-yes-win" : "tag-no-win"}`}>{m.outcome ? "YES Won" : "NO Won"}</span>
                      ) : (
                        <span className={`mkt-tag ${Date.now()/1000 < m.endTime ? "tag-live" : "tag-ended"}`}>
                          {Date.now()/1000 < m.endTime ? timeLeft(m.endTime) : "Ended — Awaiting resolution"}
                        </span>
                      )}
                    </div>
                    <div className="pos-row">
                      {m.yesBet !== "0" && <span className="pos-chip pos-y">YES: {fmtAmt(m.yesBet)} USDC</span>}
                      {m.noBet !== "0" && <span className="pos-chip pos-n">NO: {fmtAmt(m.noBet)} USDC</span>}
                      {m.claimable !== "0" && !m.claimed && <span className="pos-chip pos-cl">Reward: {fmtAmt(m.claimable)} USDC</span>}
                    </div>
                    {m.resolved && m.claimable !== "0" && !m.claimed && (
                      <button className="btn-claim" disabled={!!loading} onClick={() => claim(m.id)}>Claim Reward</button>
                    )}
                    {m.claimed && <span className="claimed-tag">✓ Claimed</span>}
                  </div>
                ))}
              </>
            )}

            {/* ════ ADMIN ════ */}
            {page === "admin" && isAdmin && (
              <>
                <div className="crd">
                  <div className="adm-lbl" style={{marginBottom:12,fontSize:11,letterSpacing:1.5,textTransform:'uppercase'}}>Create Market</div>
                  <div className="adm-form">
                    <div>
                      <div className="adm-lbl">Question</div>
                      <input className="adm-inp" placeholder="Will ETH hit $10k by 2026?" value={newQ} onChange={(e) => setNewQ(e.target.value)} />
                    </div>
                    <div className="adm-row">
                      <div><div className="adm-lbl">Days</div><input className="adm-inp" type="number" min="0" value={newDays} onChange={(e) => setNewDays(e.target.value)} /></div>
                      <div><div className="adm-lbl">Hours</div><input className="adm-inp" type="number" min="0" max="23" value={newHours} onChange={(e) => setNewHours(e.target.value)} /></div>
                    </div>
                    <button className="btn-create" disabled={!!loading || !newQ.trim()} onClick={createMkt}>Create Market</button>
                  </div>
                </div>

                <div className="crd">
                  <div className="adm-lbl" style={{marginBottom:12,fontSize:11,letterSpacing:1.5,textTransform:'uppercase'}}>Resolve Markets</div>
                  {markets.filter(m => !m.resolved && Date.now()/1000 >= m.endTime).length === 0 && (
                    <div className="empty" style={{padding:16}}>No markets ready to resolve.</div>
                  )}
                  {markets.filter(m => !m.resolved && Date.now()/1000 >= m.endTime).map(m => (
                    <div key={m.id} style={{marginBottom:12}}>
                      <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>#{m.id}: {m.question}</div>
                      <div style={{fontSize:11,color:'var(--dm)',marginBottom:8}}>Pool: {fmtAmt(m.totalYes)} YES / {fmtAmt(m.totalNo)} NO</div>
                      <div className="resolve-row">
                        <button className="btn-res btn-res-y" disabled={!!loading} onClick={() => resolve(m.id, true)}>Resolve YES ✓</button>
                        <button className="btn-res btn-res-n" disabled={!!loading} onClick={() => resolve(m.id, false)}>Resolve NO ✗</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="crd">
                  <div className="adm-lbl" style={{marginBottom:12,fontSize:11,letterSpacing:1.5,textTransform:'uppercase'}}>All Markets</div>
                  {markets.map(m => (
                    <div key={m.id} style={{padding:'8px 0',borderBottom:'1px solid var(--bd)',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12}}>
                      <span style={{fontWeight:600}}>#{m.id} {m.question.slice(0,40)}{m.question.length>40?"…":""}</span>
                      <span className={`mkt-tag ${m.resolved ? (m.outcome ? "tag-yes-win" : "tag-no-win") : (Date.now()/1000<m.endTime ? "tag-live" : "tag-ended")}`}>
                        {m.resolved ? (m.outcome ? "YES" : "NO") : (Date.now()/1000<m.endTime ? "Live" : "Pending")}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{display:'flex',justifyContent:'center',gap:8,marginTop:4}}>
              <span style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--dm)'}}>Contract: {short(contractAddr)}</span>
              <button onClick={() => { localStorage.removeItem(SAVED_ADDR_KEY); setContractAddr(""); }}
                style={{background:'none',border:'none',color:'var(--pr2)',cursor:'pointer',fontSize:10,fontFamily:'var(--sans)',fontWeight:600,opacity:.6}}>change</button>
            </div>
          </>
        )}

        {account && !isArc && (
          <div className="crd" style={{textAlign:'center',padding:32}}>
            <div style={{color:'var(--warn)',marginBottom:16}}>Wrong network. Switch to Arc Testnet.</div>
            <button className="con-btn" style={{padding:'12px 32px'}} onClick={() => connect(false)}>Switch Network</button>
          </div>
        )}

        <div className="ftr">ARC PREDICTX · {new Date().getFullYear()}</div>
        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      </div>
    </>
  );
}

/* ─── Market Card ──────────────────────────────────────── */
function MarketCard({ m, loading, onYes, onNo }) {
  const [amt, setAmt] = useState("");
  const isLive = Date.now() / 1000 < m.endTime;
  const canBet = isLive && !m.resolved;
  const totalPool = BigInt(m.totalYes) + BigInt(m.totalNo);
  const yPct = totalPool > 0n ? Number(BigInt(m.totalYes) * 100n / totalPool) : 50;
  const nPct = 100 - yPct;

  return (
    <div className="crd">
      <div className="mkt-q">{m.question}</div>
      <div className="mkt-meta">
        {m.resolved ? (
          <span className={`mkt-tag ${m.outcome ? "tag-yes-win" : "tag-no-win"}`}>Resolved: {m.outcome ? "YES Won ✓" : "NO Won ✗"}</span>
        ) : (
          <><span className={`mkt-tag ${isLive ? "tag-live" : "tag-ended"}`}>{isLive ? `⏱ ${timeLeft(m.endTime)}` : "Ended"}</span><span className="mkt-tag tag-time">#{m.id}</span></>
        )}
      </div>
      <div className="mkt-pools">
        <div className="pool-box pool-yes"><div className="pool-lbl">YES ({yPct}%)</div><div className="pool-val">{fmtAmt(m.totalYes)}<span className="pool-u">USDC</span></div></div>
        <div className="pool-box pool-no"><div className="pool-lbl">NO ({nPct}%)</div><div className="pool-val">{fmtAmt(m.totalNo)}<span className="pool-u">USDC</span></div></div>
      </div>
      <div style={{height:4,borderRadius:2,background:'var(--nog)',overflow:'hidden',marginBottom:14}}>
        <div style={{height:'100%',width:`${yPct}%`,background:'var(--yes)',borderRadius:2,transition:'width .3s'}} />
      </div>
      {canBet && (
        <div className="mkt-bet">
          <input className="inp" type="number" min="0" step="0.01" placeholder="Amount (USDC)" value={amt} onChange={(e) => setAmt(e.target.value)} />
          <button className="btn-yes" disabled={!!loading || !amt || Number(amt) <= 0} onClick={() => { onYes(m.id, amt); setAmt(""); }}>YES ↑</button>
          <button className="btn-no" disabled={!!loading || !amt || Number(amt) <= 0} onClick={() => { onNo(m.id, amt); setAmt(""); }}>NO ↓</button>
        </div>
      )}
    </div>
  );
}
