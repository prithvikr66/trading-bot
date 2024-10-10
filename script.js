const ethers = require("ethers");
require("dotenv").config();
const WebSocket = require("ws");
const { ROUTER_ABI, USDT_ABI } = require("./data");

const ws = new WebSocket("wss://stream.binance.com:9443/ws/bnbusdt@trade");

const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const ROUTER_ADDRESS = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const BNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const BNB_RESERVE_FOR_GAS = ethers.utils.parseEther("0.01");
const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);
const usdtContract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);

let basePrice = 555;
const profitThreshold = 1.01;
let holdingBNB = true;

ws.on("message", async (data) => {
  const trade = JSON.parse(data);
  const currentPrice = parseFloat(trade.p);

  if (holdingBNB && currentPrice >= basePrice * profitThreshold) {
    console.log(`Selling BNB at ${currentPrice} USDT for 1% profit`);
    await swapBNBForUSDT();
    basePrice = currentPrice;
    holdingBNB = false;
    console.log(`New base price after sell: ${basePrice}`);
  }

  if (!holdingBNB && currentPrice <= basePrice / profitThreshold) {
    console.log(`Buying BNB at ${currentPrice} USDT after 1% dip`);
    await swapUSDTForBNB();
    basePrice = currentPrice;
    holdingBNB = true;
    console.log(`New base price after buy: ${basePrice}`);
  }
});

async function swapUSDTForBNB() {
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);
  const usdtContract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, wallet);

  const path = [USDT_ADDRESS, BNB_ADDRESS];
  const to = wallet.address;
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const slippageTolerance = 0.5;

  const amountInUSDT = await getTokenBalance("USDT");
  const amountIn = ethers.utils.parseUnits(amountInUSDT.toString(), 18);

  const allowance = await usdtContract.allowance(
    wallet.address,
    ROUTER_ADDRESS
  );
  if (allowance.lt(amountIn)) {
    console.log("Approving USDT...");
    const approveTx = await usdtContract.approve(
      ROUTER_ADDRESS,
      ethers.constants.MaxUint256
    );
    await approveTx.wait();
    console.log("USDT approved");
  }

  const amounts = await router.getAmountsOut(amountIn, path);
  const expectedBNB = amounts[1];

  const slippageMultiplier = 1 - slippageTolerance / 100;
  const minOutBigNumber = ethers.BigNumber.from(expectedBNB)
    .mul(ethers.BigNumber.from(Math.floor(slippageMultiplier * 1000)))
    .div(ethers.BigNumber.from(1000));

  console.log(
    `Swapping ${amountInUSDT} USDT for at least ${ethers.utils.formatEther(
      minOutBigNumber
    )} BNB`
  );

  const tx = await router.swapExactTokensForETH(
    amountIn,
    minOutBigNumber,
    path,
    to,
    deadline,
    { gasLimit: 300000 }
  );

  return tx;
}

async function swapBNBForUSDT() {
  const path = [BNB_ADDRESS, USDT_ADDRESS];
  const to = wallet.address;
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  const walletBalance = await getBalance("BNB");
  const amountToSwap = ethers.utils
    .parseEther(walletBalance)
    .sub(BNB_RESERVE_FOR_GAS);
  if (amountToSwap.lte(0)) {
    console.log("Not enough BNB to swap and cover gas fees");
    return;
  }

  const amounts = await router.getAmountsOut(amountToSwap, path);
  const expectedUSDT = amounts[1];
  const slippageTolerance = 0.5;

  const slippageMultiplier = 1 - slippageTolerance / 100;
  const minOutBigNumber = ethers.BigNumber.from(expectedUSDT)
    .mul(ethers.BigNumber.from(Math.floor(slippageMultiplier * 1000)))
    .div(ethers.BigNumber.from(1000));

  const tx = await router.swapExactETHForTokens(
    minOutBigNumber,
    path,
    to,
    deadline,
    {
      value: amountToSwap,
      gasLimit: 300000,
    }
  );

  return tx;
}

async function getBalance(tokenSymbol) {
  if (tokenSymbol === "BNB") {
    const balance = await provider.getBalance(wallet.address);
    return ethers.utils.formatEther(balance);
  }
}

async function getTokenBalance(tokenSymbol) {
  if (tokenSymbol === "USDT") {
    const balance = await usdtContract.balanceOf(wallet.address);
    return ethers.utils.formatUnits(balance, 18);
  }
}

const init = async () => {
  if (process.env.PRIVATE_KEY && process.env.BSC_RPC_URL) {
    return console.log("found all env keys");
  }
};

init();
