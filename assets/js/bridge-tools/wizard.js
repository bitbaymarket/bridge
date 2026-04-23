// Automation Wizard for BitBay Bridge

(function() {

var wizardState = {
  polPrice: 0,
  ethPrice: 0,
  bayPrice: 0,
  bayrPrice: 0,
  polBalance: 0,
  ethBalance: 0
};

var ETH_GAS_LIDO = 500000;
var ETH_GAS_SWAP = 500000;
var ETH_GAS_SEND = 150000;
var MIN_ALLOC_USD = 0.50;
var WIZARD_AUTOBRIDGE_V0 = '0x5D618a7eBed1e0281Ae3B92eF99c4fDD41432A6a';
var WIZARD_POL_ETH = '0x455e53CBB86018Ac2B8092FD2dADeA5e1F8ad3A8';
var WIZARD_WETH_ETH = '0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2';
var WIZARD_UNISWAP_UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
var WIZARD_UNISWAP_V3_FEE_TIER = '0001f4';
var WIZARD_ROUTER_POLYGON = '0x418fBc4E6B5C694495c90C7cDE1f293EE444F10B';
var WIZARD_EXCHANGE_POLYGON = '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C';
var WIZARD_MIN_POL_GAS_WEI = '1000000000000000000';
var WIZARD_SLIPPAGE_POL = 0.95;
var WIZARD_SLIPPAGE_STABLE = 0.90;
var WIZARD_SLIPPAGE_BAY = 0.90;
var WIZARD_LIDO_SLIPPAGE_BPS = 100;
var WIZARD_EXECUTOR_POLL_INTERVAL_MS = 15000;

var WIZARD_STATUSES = {
  pending: 'pending',
  ethReceived: 'eth_received',
  taskPolSwap: 'task_pol_swap',
  taskPolBridge: 'task_pol_bridge',
  taskLido: 'task_lido',
  taskEthBridge: 'task_eth_bridge',
  taskWaitPolygonFunds: 'task_wait_polygon_funds',
  taskStable: 'task_stable',
  taskBay: 'task_bay',
  taskBayr: 'task_bayr',
  completed: 'completed',
  failed: 'failed'
};

var wizardExecutorInterval = null;
var wizardExecutorBusy = false;

var wizardUniversalRouterAbi = [{
  "inputs": [
    {"internalType":"bytes","name":"commands","type":"bytes"},
    {"internalType":"bytes[]","name":"inputs","type":"bytes[]"},
    {"internalType":"uint256","name":"deadline","type":"uint256"}
  ],
  "name":"execute",
  "outputs":[],
  "stateMutability":"payable",
  "type":"function"
}];

function getWizardStorageKey() {
  return myaccounts + '_automationWizard';
}

function getWizardData() {
  try {
    var data = localStorage.getItem(getWizardStorageKey());
    return data ? JSON.parse(data) : null;
  } catch(e) {
    return null;
  }
}

function setWizardData(data) {
  localStorage.setItem(getWizardStorageKey(), JSON.stringify(data));
}

function clearWizardData() {
  localStorage.removeItem(getWizardStorageKey());
}

function getNewUserKey() {
  return myaccounts + '_wizardDeclined';
}

async function fetchPrices() {
  var polRaw = await getPOLPrice();
  var ethRaw = await getWETHPrice();
  var bayRaw = await getBAYPrice();
  var bayrRaw = await getBAYRPrice();

  wizardState.polPrice = polRaw !== "error" ? parseInt(polRaw) / 1e8 : 0;
  wizardState.ethPrice = ethRaw !== "error" ? parseInt(ethRaw) / 1e8 : 0;
  wizardState.bayPrice = bayRaw !== "error" ? parseInt(bayRaw) / 1e8 : 0;
  wizardState.bayrPrice = bayrRaw !== "error" ? parseInt(bayrRaw) / 1e8 : 0;
}

async function fetchBalances() {
  try {
    var polBal = validation(DOMPurify.sanitize(await web3.eth.getBalance(myaccounts)));
    wizardState.polBalance = parseFloat(new BigNumber(polBal).dividedBy('1e18').toFixed(8));
  } catch(e) {
    wizardState.polBalance = 0;
  }
  try {
    var ethWeb3 = (typeof earnState !== 'undefined' && earnState.ethWeb3) ? earnState.ethWeb3 : null;
    if (!ethWeb3) {
      wizardState.ethBalance = 0;
      return;
    }
    var ethBal = validation(DOMPurify.sanitize(await ethWeb3.eth.getBalance(myaccounts)));
    wizardState.ethBalance = parseFloat(new BigNumber(ethBal).dividedBy('1e18').toFixed(8));
  } catch(e) {
    wizardState.ethBalance = 0;
  }
}

async function estimateEthGasPrice() {
  try {
    var ethWeb3 = (typeof earnState !== 'undefined' && earnState.ethWeb3) ? earnState.ethWeb3 : null;
    if (!ethWeb3) return false;
    var gp = validation(DOMPurify.sanitize(await ethWeb3.eth.getGasPrice()));
    var gpBN = new BigNumber(gp).times(1.5);
    if (gpBN.gt('500000000000')) gpBN = new BigNumber('500000000000');
    if (gpBN.lt('100000000')) gpBN = new BigNumber('100000000');
    return gpBN;
  } catch(e) {
    return false;
  }
}

async function ensureWalletUnlocked() {
  if (loginType === 1) {
    var result = await Swal.fire({
      title: translateThis('Wallet Unlock Required'),
      html: '<div style="text-align:left;max-height:400px;overflow-y:auto;">' +
        '<p>' + translateThis('The automation wizard requires the ability to sign transactions on your behalf. For your security, Metamask does not reveal the private key for your connected account.') + '</p><br>' +
        '<p>' + translateThis('It is recommended that you connect to this site using a password instead of Metamask. However if you wish to use the wizard with Metamask you may unlock your wallet directly using your private key.') + '</p><br>' +
        '<p><strong>' + translateThis('Security Notice') + ':</strong> ' + translateThis('We only recommend this option if you trust the source code of this site. You may also wish to run the code locally. You are responsible for the risks of direct key handling.') + '</p><br>' +
        '<p>' + translateThis('If you agree, you may continue and unlock your wallet using your private key.') + '</p>' +
        '</div>',
      showCancelButton: true,
      confirmButtonText: translateThis('Unlock with Private Key'),
      cancelButtonText: translateThis('Cancel'),
      width: 550
    });
    if (!result.isConfirmed) return false;

    var pkResult = await Swal.fire({
      title: translateThis('Enter Private Key'),
      html: '<div style="text-align:left;">' +
        '<p>' + translateThis('Enter the private key for your connected wallet') + ':</p>' +
        '<p style="font-size:0.9em;color:#777;">' + translateThis('Address') + ': ' + myaccounts + '</p>' +
        '<input type="password" id="wizardPKInput" class="swal2-input" placeholder="' + translateThis('Private Key (with or without 0x)') + '" style="width:100%;">' +
        '</div>',
      showCancelButton: true,
      confirmButtonText: translateThis('Unlock'),
      cancelButtonText: translateThis('Cancel'),
      preConfirm: function() {
        var pk = document.getElementById('wizardPKInput').value.trim();
        if (!pk) {
          Swal.showValidationMessage(translateThis('Please enter a private key'));
          return false;
        }
        if (!pk.startsWith('0x')) pk = '0x' + pk;
        if (pk.length !== 66 || !/^0x[a-fA-F0-9]{64}$/.test(pk)) {
          Swal.showValidationMessage(translateThis('Invalid private key format'));
          return false;
        }
        return pk;
      }
    });
    if (!pkResult.isConfirmed) return false;

    try {
      var account = web3.eth.accounts.privateKeyToAccount(pkResult.value);
      if (account.address.toLowerCase() !== myaccounts.toLowerCase()) {
        await Swal.fire(translateThis('Error'), translateThis('The private key does not match your connected wallet address.'), 'error');
        return false;
      }
      web3.eth.accounts.wallet.add(pkResult.value);
      loginType = 2;
      earnState.isPasswordLogin = true;
      await Swal.fire({
        icon: 'success',
        title: translateThis('Wallet Unlocked'),
        text: translateThis('Your wallet has been unlocked for automation.'),
        timer: 2000,
        showConfirmButton: false
      });
      return true;
    } catch(e) {
      await Swal.fire(translateThis('Error'), translateThis('Failed to verify private key. Please check that it is correct.'), 'error');
      return false;
    }
  }
  return true;
}

function toggleAccordionPanel(headerEl) {
  var panel = headerEl.nextElementSibling;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function buildAccordionItem(id, emoji, title, description, checked, extraHTML) {
  return '<div style="border:1px solid #ccc;border-radius:6px;margin-bottom:8px;overflow:hidden;">' +
    '<div class="wizAccordionHeader" style="display:flex;align-items:center;padding:10px 12px;cursor:pointer;background:#f7f7f7;">' +
      '<input type="checkbox" id="wiz_' + id + '" ' + (checked ? 'checked' : '') +
        ' style="all:unset;display:inline-block;cursor:pointer;appearance:auto;-webkit-appearance:checkbox;-moz-appearance:checkbox;margin-right:8px;flex-shrink:0;" onclick="event.stopPropagation()">' +
      '<span style="font-size:1.1em;">' + emoji + ' ' + title + '</span>' +
      '<span style="margin-left:auto;font-size:0.8em;color:#999;">▼</span>' +
    '</div>' +
    '<div style="display:none;padding:10px 12px;font-size:0.9em;text-align:left;">' +
      '<p>' + description + '</p>' +
      (extraHTML || '') +
    '</div>' +
  '</div>';
}

function adjustAllocations(sliders, changedId) {
  var priority = ['lido', 'stable', 'bay', 'bayr'];
  var total = 0;
  for (var i = 0; i < priority.length; i++) total += parseInt(sliders[priority[i]].value) || 0;
  if (total <= 100) {
    updateAllocationDisplay(sliders);
    return;
  }
  var excess = total - 100;
  var reducePriority = ['bayr', 'bay', 'stable', 'lido'];
  var idx = reducePriority.indexOf(changedId);
  if (idx !== -1) reducePriority.splice(idx, 1);
  for (var j = 0; j < reducePriority.length && excess > 0; j++) {
    var key = reducePriority[j];
    var val = parseInt(sliders[key].value) || 0;
    var reduction = Math.min(val, excess);
    sliders[key].value = val - reduction;
    excess -= reduction;
  }
  updateAllocationDisplay(sliders);
}

function updateAllocationDisplay(sliders) {
  var priority = ['lido', 'stable', 'bay', 'bayr'];
  for (var i = 0; i < priority.length; i++) {
    var disp = document.getElementById('wizAlloc_' + priority[i]);
    if (disp) disp.textContent = sliders[priority[i]].value + '%';
  }
  var total = 0;
  for (var k = 0; k < priority.length; k++) total += parseInt(sliders[priority[k]].value) || 0;
  var totalDisp = document.getElementById('wizAllocTotal');
  if (totalDisp) {
    totalDisp.textContent = translateThis('Total') + ': ' + total + '%';
    totalDisp.style.color = total > 100 ? 'red' : '#333';
  }
}

function sliderHTML(id, label) {
  return '<div style="margin-top:8px;">' +
    '<label style="font-size:0.85em;">' + label + ': <span id="wizAlloc_' + id + '">25%</span></label>' +
    '<input type="range" id="wizSlider_' + id + '" min="0" max="100" value="25" style="width:100%;">' +
    '</div>';
}

window.launchAutomationWizard = async function() {
  if (!myaccounts || loginType === 0) {
    await Swal.fire(translateThis('Error'), translateThis('Please connect your wallet first'), 'error');
    return;
  }

  var unlocked = await ensureWalletUnlocked();
  if (!unlocked) return;

  showSpinner();
  try {
    await fetchPrices();
    await fetchBalances();
  } catch(e) {
    console.log('Wizard price/balance fetch error:', e);
  }
  hideSpinner();

  if (wizardState.ethPrice <= 0) {
    await Swal.fire(translateThis('Error'), translateThis('Unable to fetch current prices. Please try again later.'), 'error');
    return;
  }

  var polNeedGas = wizardState.polBalance < 5 || (wizardState.polBalance * wizardState.polPrice) < 2;
  var polChecked = polNeedGas;
  var polRec = polNeedGas
    ? translateThis('Recommended: Your POL balance is low.')
    : translateThis('Your POL balance appears sufficient.');
  var stableSlippageLabel = ((1 - WIZARD_SLIPPAGE_STABLE) * 100).toFixed(0);

  var polPriceDisplay = wizardState.polPrice > 0 ? '$' + wizardState.polPrice.toFixed(4) : 'N/A';
  var ethPriceDisplay = wizardState.ethPrice > 0 ? '$' + wizardState.ethPrice.toFixed(2) : 'N/A';

  var accordionHTML =
    buildAccordionItem('pol', '⛽', translateThis('Get Polygon for Gas'),
      polRec + ' ' + translateThis('Current POL price') + ': ' + polPriceDisplay +
      '. ' + translateThis('This will acquire POL for gas fees with ±5% slippage based on market rate.'),
      polChecked, '') +

    buildAccordionItem('lido', '🏦', translateThis('Hold ETH Long Term (Lido)'),
      translateThis('Hold your ETH long term to avoid spending it so your investment can grow similar to a trust account while simultaneously supporting the ecosystem in a completely safe and decentralized way.'),
      true,
      sliderHTML('lido', translateThis('Allocation')) +
      '<div style="margin-top:6px;">' +
        '<label style="font-size:0.85em;">' + translateThis('Lock Period (days)') + ':</label>' +
        '<input type="number" id="wizLidoDays" value="180" min="1" max="1095" class="swal2-input" style="width:100px;height:30px;font-size:0.9em;padding:4px;">' +
        '<span style="font-size:0.8em;color:#777;margin-left:6px;">' + translateThis('Default: 180 days (≈6 months)') + '</span>' +
      '</div>') +

    buildAccordionItem('stable', '💱', translateThis('Earn Yield at Uniswap (StableVault)'),
      translateThis('Earn a decentralized and reliable profit from stablecoin pair trading fees where the position is automatically managed to maximize profits while supporting the ecosystem. Includes ±') + stableSlippageLabel + '% ' + translateThis('slippage for the trade to get DAI.'),
      true,
      sliderHTML('stable', translateThis('Allocation'))) +

    buildAccordionItem('bay', '🪙', translateThis('Buy BitBay'),
      translateThis('Purchase BitBay (BAY) liquid tokens. Slippage: ±10%.'),
      true,
      sliderHTML('bay', translateThis('Allocation'))) +

    buildAccordionItem('bayr', '🏛️', translateThis('Buy BitBay Reserve'),
      translateThis('Purchase BitBay Reserve (BAYR) tokens. Slippage: ±10%.'),
      true,
      sliderHTML('bayr', translateThis('Allocation')));

  var wizResult = await Swal.fire({
    title: '🧙 ' + translateThis('Automation Wizard'),
    html: '<div style="max-height:60vh;overflow-y:auto;overflow-x:hidden;text-align:left;padding-right:4px;">' +
      '<p style="margin-bottom:12px;">' + translateThis('This tool will help you get started with the most popular features to start earning so you may become a part of the BitBay ecosystem.') + '</p>' +
      accordionHTML +
      '<div id="wizAllocTotal" style="text-align:right;font-weight:bold;margin-top:4px;">' + translateThis('Total') + ': 100%</div>' +
      '</div>',
    width: '500px',
    showCancelButton: true,
    confirmButtonText: translateThis('Continue'),
    cancelButtonText: translateThis('Cancel'),
    didOpen: function() {
      var headers = document.querySelectorAll('.wizAccordionHeader');
      for (var h = 0; h < headers.length; h++) {
        headers[h].addEventListener('click', function() { toggleAccordionPanel(this); });
      }
      var sliders = {
        lido: document.getElementById('wizSlider_lido'),
        stable: document.getElementById('wizSlider_stable'),
        bay: document.getElementById('wizSlider_bay'),
        bayr: document.getElementById('wizSlider_bayr')
      };
      var ids = ['lido', 'stable', 'bay', 'bayr'];
      for (var i = 0; i < ids.length; i++) {
        (function(id) {
          if (sliders[id]) {
            sliders[id].addEventListener('input', function() {
              adjustAllocations(sliders, id);
            });
          }
        })(ids[i]);
      }
      updateAllocationDisplay(sliders);
    },
    preConfirm: function() {
      var choices = {
        pol: document.getElementById('wiz_pol').checked,
        lido: document.getElementById('wiz_lido').checked,
        stable: document.getElementById('wiz_stable').checked,
        bay: document.getElementById('wiz_bay').checked,
        bayr: document.getElementById('wiz_bayr').checked,
        allocLido: parseInt(document.getElementById('wizSlider_lido').value) || 0,
        allocStable: parseInt(document.getElementById('wizSlider_stable').value) || 0,
        allocBay: parseInt(document.getElementById('wizSlider_bay').value) || 0,
        allocBayr: parseInt(document.getElementById('wizSlider_bayr').value) || 0,
        lidoDays: parseInt(document.getElementById('wizLidoDays').value) || 180
      };
      if (!choices.pol && !choices.lido && !choices.stable && !choices.bay && !choices.bayr) {
        Swal.close();
        Swal.fire(translateThis('Nothing Selected'), translateThis('No options were selected. The wizard has been closed.'), 'info');
        return false;
      }
      return choices;
    }
  });

  if (!wizResult.isConfirmed || !wizResult.value) return;
  var choices = wizResult.value;

  if(wizardState.polBalance == 0 && !choices.pol && (choices.bay || choices.bayr || choices.stable)) {
    await Swal.fire({
      title:translateThis("Polygon gas required"),
      text:translateThis("In order to automate transactions it is required to allocate some funds to handle any gas/network costs. Please try again.")
    });
    return;
  }

  var disclaimers = [];
  disclaimers.push('<li>' + translateThis('This website is not an exchange and does not take custody of user funds or charge any fees. It is designed to maximize your security by keeping all actions client-side. Although Uniswap/Curve/etc are generally considered safe, we recommend reviewing the source code of any DEX and understanding the associated risks. This website is open source and has been audited, but for maximum security we encourage users to download the code from GitHub and run it locally.') + '</li>');

  if (choices.pol) {
    disclaimers.push('<li><strong>' + translateThis('Polygon Gas') + ':</strong> ' + translateThis('A portion of your ETH will be used to acquire POL for gas. The final amount may vary ±5% due to slippage.') + '</li>');
  }
  if (choices.lido) {
    disclaimers.push('<li><strong>' + translateThis('Lido HODL') + ':</strong> ' + translateThis('By proceeding, you acknowledge that the desired ETH will be traded into Lido Staked ETH through the decentralized exchange Curve. 100% of staking yields go to BAY stakers. Your principal is locked until unlock date. Lido is well-audited although you should be aware of third party contract risks.') + '</li>');
  }
  if (choices.stable) {
    disclaimers.push('<li><strong>' + translateThis('StableVault') + ':</strong> ' + translateThis('Stablecoin pairs are very low risk but you should always audit the source code. BitBay is a community-driven project and not responsible for bugs, errors, or omissions. The stablecoin position is managed by stakers within very tight ranges for security and to get the best yield. Impermanent loss is very unlikely due to these hard coded protections. DAI and USDC are bridged tokens so you should understand their risks. UniSwap V4 risks also apply so please do your due diligence.') + '</li>');
  }
  if (choices.bay || choices.bayr) {
    disclaimers.push('<li><strong>' + translateThis('BAY/BAYR Purchase') + ':</strong> ' + translateThis('The exact amount of tokens you receive may vary due to fees and price fluctuations. Trades are designed to stay within ±10% of the spot price. Any unallocated funds will be returned as change.') + '</li>');
  }

  var disclaimerResult = await Swal.fire({
    title: translateThis('Important Disclaimers'),
    html: '<div style="max-height:50vh;overflow-y:auto;text-align:left;padding-right:4px;">' +
      '<ul style="padding-left:18px;">' + disclaimers.join('') + '</ul>' +
      '</div>',
    icon: 'warning',
    width: '520px',
    showCancelButton: true,
    confirmButtonText: translateThis('I Understand & Continue'),
    cancelButtonText: translateThis('Cancel')
  });
  if (!disclaimerResult.isConfirmed) return;

  var ethResult = await Swal.fire({
    title: translateThis('ETH Deposit Amount'),
    html: '<div style="text-align:left;">' +
      '<p>' + translateThis('How much ETH on the Ethereum network do you intend to deposit?') + '</p>' +
      '<p style="color:#777;">' + translateThis('Current ETH price') + ': ' + ethPriceDisplay + '</p>' +
      '<input type="number" id="wizEthAmount" class="swal2-input" placeholder="0.0" step="0.001" style="width:100%;">' +
      '</div>',
    showCancelButton: true,
    confirmButtonText: translateThis('Continue'),
    cancelButtonText: translateThis('Cancel'),
    preConfirm: function() {
      var val = parseFloat(document.getElementById('wizEthAmount').value);
      if (!val || val <= 0) {
        Swal.showValidationMessage(translateThis('Please enter a valid ETH amount'));
        return false;
      }
      return val;
    }
  });
  if (!ethResult.isConfirmed) return;
  var ethAmount = ethResult.value;

  var ethGasPrice = await estimateEthGasPrice();
  if(!ethGasPrice) {
    await Swal.fire(translateThis("Error fetching gas price."));
    return;
  }
  var lidoGasCostETH = 0;
  var bridgeSendCostETH = 0;
  var swapCostETH = 0;
  if (choices.lido) {
    lidoGasCostETH = parseFloat(ethGasPrice.times(ETH_GAS_LIDO).dividedBy('1e18').toFixed(8));
  }
  var needsBridge = choices.stable || choices.bay || choices.bayr || choices.pol;
  if (needsBridge) {
    bridgeSendCostETH = parseFloat(ethGasPrice.times(ETH_GAS_SEND).dividedBy('1e18').toFixed(8));
  }
  if (choices.pol) {
    swapCostETH = parseFloat(ethGasPrice.times(ETH_GAS_SWAP).dividedBy('1e18').toFixed(8));
  }
  var totalGasCostETH = lidoGasCostETH + bridgeSendCostETH + swapCostETH;

  var ethUSD = ethAmount * wizardState.ethPrice;
  var polCostETH = 0;
  var polCostUSD = 0;
  if (choices.pol && wizardState.polPrice > 0) {
    var polTargetUSD = 10 * wizardState.polPrice;
    if (polTargetUSD < 5) polTargetUSD = 5;
    if (polTargetUSD > 10) polTargetUSD = 10;
    polCostUSD = polTargetUSD * 1.05;
    polCostETH = polCostUSD / wizardState.ethPrice;
  }

  var remainingETH = ethAmount - polCostETH - totalGasCostETH;
  if (remainingETH < 0) {
    await Swal.fire({
      title: translateThis('Insufficient ETH'),
      html: '<p>' + translateThis('The ETH amount specified is not enough to cover the gas and transaction costs.') + '</p>' +
        (polCostETH > 0 ? '<p>' + translateThis('POL cost') + ': ~' + polCostETH.toFixed(6) + ' ETH ($' + polCostUSD.toFixed(2) + ')</p>' : '') +
        '<p>' + translateThis('Estimated ETH gas') + ': ~' + totalGasCostETH.toFixed(6) + ' ETH</p>' +
        '<p>' + translateThis('You specified') + ': ' + ethAmount.toFixed(6) + ' ETH ($' + ethUSD.toFixed(2) + ')</p>',
      icon: 'error'
    });
    return;
  }

  var totalAlloc = (choices.lido ? choices.allocLido : 0) +
                   (choices.stable ? choices.allocStable : 0) +
                   (choices.bay ? choices.allocBay : 0) +
                   (choices.bayr ? choices.allocBayr : 0);
  if (totalAlloc === 0) totalAlloc = 1;

  var lidoETH = choices.lido ? remainingETH * (choices.allocLido / 100) : 0;
  var stableETH = choices.stable ? remainingETH * (choices.allocStable / 100) : 0;
  var bayETH = choices.bay ? remainingETH * (choices.allocBay / 100) : 0;
  var bayrETH = choices.bayr ? remainingETH * (choices.allocBayr / 100) : 0;

  var tooSmall = [];
  if (choices.lido && lidoETH * wizardState.ethPrice < MIN_ALLOC_USD) tooSmall.push('Lido HODL');
  if (choices.stable && stableETH * wizardState.ethPrice < MIN_ALLOC_USD) tooSmall.push('StableVault');
  if (choices.bay && bayETH * wizardState.ethPrice < MIN_ALLOC_USD) tooSmall.push('Buy BAY');
  if (choices.bayr && bayrETH * wizardState.ethPrice < MIN_ALLOC_USD) tooSmall.push('Buy BAYR');
  if (tooSmall.length > 0) {
    await Swal.fire({
      title: translateThis('Insufficient ETH'),
      html: '<p>' + translateThis('We recommend at least $0.50 per selected allocation to cover transaction costs. The following allocations are too small:') + '</p>' +
        '<p><strong>' + tooSmall.join(', ') + '</strong></p>' +
        '<p>' + translateThis('Please increase the total ETH amount or reduce the number of selected tasks.') + '</p>',
      icon: 'warning'
    });
    return;
  }

  var lidoUSD = lidoETH * wizardState.ethPrice;
  var stableUSD = stableETH * wizardState.ethPrice;
  var bayUSD = bayETH * wizardState.ethPrice;
  var bayrUSD = bayrETH * wizardState.ethPrice;
  var gasCostUSD = totalGasCostETH * wizardState.ethPrice;

  var summaryHTML = '<div style="text-align:left;font-size:0.9em;max-height:50vh;overflow-y:auto;padding-right:4px;">';
  summaryHTML += '<table style="width:100%;border-collapse:collapse;">';
  summaryHTML += '<tr style="border-bottom:1px solid #eee;"><th style="text-align:left;padding:4px;">' + translateThis('Task') + '</th><th style="text-align:right;padding:4px;">ETH</th><th style="text-align:right;padding:4px;">~USD</th></tr>';

  if (totalGasCostETH > 0) {
    var gasLabel = '⛏️ ' + translateThis('Est. ETH gas');
    if (choices.lido && needsBridge) gasLabel += ' (Lido + bridge)';
    else if (choices.lido) gasLabel += ' (Lido)';
    else gasLabel += ' (bridge send)';
    summaryHTML += '<tr style="border-bottom:1px solid #eee;color:#777;"><td style="padding:4px;">' + gasLabel + '</td><td style="text-align:right;padding:4px;">' + totalGasCostETH.toFixed(6) + '</td><td style="text-align:right;padding:4px;">$' + gasCostUSD.toFixed(2) + '</td></tr>';
  }
  if (choices.pol) {
    summaryHTML += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px;">⛽ ' + translateThis('Get POL') + ' (±5%)</td><td style="text-align:right;padding:4px;">' + polCostETH.toFixed(6) + '</td><td style="text-align:right;padding:4px;">$' + polCostUSD.toFixed(2) + '</td></tr>';
  }
  if (choices.lido) {
    summaryHTML += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px;">🏦 ' + translateThis('Lido HODL') + ' (' + choices.lidoDays + ' ' + translateThis('days') + ')</td><td style="text-align:right;padding:4px;">' + lidoETH.toFixed(6) + '</td><td style="text-align:right;padding:4px;">$' + lidoUSD.toFixed(2) + '</td></tr>';
  }
  if (choices.stable) {
    summaryHTML += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px;">💱 ' + translateThis('StableVault') + ' (±' + stableSlippageLabel + '%)</td><td style="text-align:right;padding:4px;">' + stableETH.toFixed(6) + '</td><td style="text-align:right;padding:4px;">$' + stableUSD.toFixed(2) + '</td></tr>';
  }
  if (choices.bay) {
    summaryHTML += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px;">🪙 ' + translateThis('Buy BAY') + ' (±10%)</td><td style="text-align:right;padding:4px;">' + bayETH.toFixed(6) + '</td><td style="text-align:right;padding:4px;">$' + bayUSD.toFixed(2) + '</td></tr>';
  }
  if (choices.bayr) {
    summaryHTML += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px;">🏛️ ' + translateThis('Buy BAYR') + ' (±10%)</td><td style="text-align:right;padding:4px;">' + bayrETH.toFixed(6) + '</td><td style="text-align:right;padding:4px;">$' + bayrUSD.toFixed(2) + '</td></tr>';
  }
  if(totalAlloc < 100) {
    var mychange = (remainingETH.toFixed(6) - bayrETH.toFixed(6) - bayETH.toFixed(6) - stableETH.toFixed(6) - lidoETH.toFixed(6)).toFixed(6);
    var mychange1 = (mychange * wizardState.ethPrice).toFixed(2);
    summaryHTML += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px;">💰 ' + translateThis('Change') + ' ~</td><td style="text-align:right;padding:4px;">' + mychange + '</td><td style="text-align:right;padding:4px;">$' + mychange1 + '</td></tr>';
  }

  summaryHTML += '<tr style="font-weight:bold;border-top:2px solid #333;"><td style="padding:4px;">' + translateThis('Total') + '</td><td style="text-align:right;padding:4px;">' + ethAmount.toFixed(6) + '</td><td style="text-align:right;padding:4px;">$' + ethUSD.toFixed(2) + '</td></tr>';
  summaryHTML += '</table>';
  summaryHTML += '<p style="margin-top:10px;color:#777;font-size:0.85em;">' + translateThis('Please check these rates to make sure they are accurate. The price of ETH may vary during the transaction and purchases will be made based on the percentage specified. Final amounts may vary slightly based on slippage.') + '</p>';
  summaryHTML += '</div>';

  var confirmResult = await Swal.fire({
    title: translateThis('Confirm Automation'),
    html: summaryHTML,
    width: '520px',
    showCancelButton: true,
    confirmButtonText: translateThis('Approve & Start'),
    cancelButtonText: translateThis('Cancel')
  });
  if (!confirmResult.isConfirmed) return;

  var depositAddress = myaccounts;
  var currentEthBalanceWei = "0";
  try {
    var ethWeb3ForSave = (typeof earnState !== 'undefined' && earnState.ethWeb3) ? earnState.ethWeb3 : null;
    if (ethWeb3ForSave) {
      currentEthBalanceWei = validation(DOMPurify.sanitize(await ethWeb3ForSave.eth.getBalance(myaccounts)));
    }
  } catch(e) {
    currentEthBalanceWei = "0";
  }
  var savedData = {
    account: myaccounts,
    timestamp: Date.now(),
    ethAmount: ethAmount,
    choices: choices,
    prices: {
      pol: wizardState.polPrice,
      eth: wizardState.ethPrice,
      bay: wizardState.bayPrice,
      bayr: wizardState.bayrPrice
    },
    breakdown: {
      gasCostETH: totalGasCostETH,
      polETH: polCostETH,
      lidoETH: lidoETH,
      stableETH: stableETH,
      bayETH: bayETH,
      bayrETH: bayrETH
    },
    status: WIZARD_STATUSES.pending,
    startEthBalanceWei: currentEthBalanceWei,
    amountsWei: null,
    tracked: {
      polReceivedWei: "0",
      stableDaiReceivedWei: "0"
    },
    failureReason: ''
  };
  setWizardData(savedData);
  showAutomationBanner();

  await Swal.fire({
    title: translateThis('Send ETH to Begin'),
    html: '<div style="text-align:left;">' +
      '<p>' + translateThis('Please send exactly') + ' <strong>' + ethAmount.toFixed(6) + ' ETH</strong> ' + translateThis('to your main address on the Ethereum network') + ':</p>' +
      '<div style="word-break:break-all;font-family:monospace;background:#f5f5f5;padding:10px;border-radius:5px;margin:10px 0;display:flex;align-items:center;gap:8px;">' +
        '<span id="wizDepositAddr"></span>' +
        '<span id="wizCopyBtn" class="no-invert" style="cursor:pointer;font-size:1.2em;">📋</span>' +
      '</div>' +
      '<p style="color:#777;font-size:0.9em;">' + translateThis('Network') + ': Ethereum Mainnet</p>' +
      '<p style="margin-top:8px;"><strong>' + translateThis('Automation tasks have been set.') + '</strong> ' + translateThis('Please keep this tab open and in focus for it to complete. It will commence when the correct amount of ETH is detected.') + '</p>' +
      '</div>',
    icon: 'success',
    confirmButtonText: translateThis('OK'),
    width: '500px',
    didOpen: function() {
      document.getElementById('wizDepositAddr').textContent = depositAddress;
      document.getElementById('wizCopyBtn').addEventListener('click', function() {
        copyAddress(depositAddress);
      });
    }
  });
};

function isTerminalStatus(status) {
  return status === WIZARD_STATUSES.completed || status === WIZARD_STATUSES.failed;
}

function getCurrentTaskLabel(status) {
  if (status === WIZARD_STATUSES.pending) return translateThis('Waiting for ETH deposit');
  if (status === WIZARD_STATUSES.ethReceived) return translateThis('ETH deposit received');
  if (status === WIZARD_STATUSES.taskPolSwap) return translateThis('Buying POL on Ethereum');
  if (status === WIZARD_STATUSES.taskPolBridge) return translateThis('Bridging POL to Polygon');
  if (status === WIZARD_STATUSES.taskLido) return translateThis('Depositing to Lido HODL');
  if (status === WIZARD_STATUSES.taskEthBridge) return translateThis('Bridging ETH to Polygon');
  if (status === WIZARD_STATUSES.taskWaitPolygonFunds) return translateThis('Waiting for Polygon arrivals');
  if (status === WIZARD_STATUSES.taskStable) return translateThis('StableVault sequence');
  if (status === WIZARD_STATUSES.taskBay) return translateThis('Buying BAY');
  if (status === WIZARD_STATUSES.taskBayr) return translateThis('Buying BAYR');
  if (status === WIZARD_STATUSES.completed) return translateThis('Completed');
  if (status === WIZARD_STATUSES.failed) return translateThis('Failed');
  return translateThis('Pending');
}

function setWizardStatus(status, extra) {
  var data = getWizardData();
  if (!data) return null;
  data.status = status;
  if (extra) {
    for (var key in extra) {
      data[key] = extra[key];
    }
  }
  setWizardData(data);
  showAutomationBanner();
  return data;
}

function getEthWeb3ForWizard() {
  if (typeof earnState !== 'undefined' && earnState.ethWeb3) return earnState.ethWeb3;
  return null;
}

function getPolWeb3ForWizard() {
  if (typeof earnState !== 'undefined' && earnState.polWeb3) return earnState.polWeb3;
  return null;
}

function ensureWizardAmounts(data) {
  if (!data || data.amountsWei) return data;
  var BN = BigNumber;
  data.amountsWei = {
    polETH: new BN(data.breakdown && data.breakdown.polETH ? data.breakdown.polETH : 0).times('1e18').toFixed(0, BN.ROUND_DOWN),
    lidoETH: new BN(data.breakdown && data.breakdown.lidoETH ? data.breakdown.lidoETH : 0).times('1e18').toFixed(0, BN.ROUND_DOWN),
    stableETH: new BN(data.breakdown && data.breakdown.stableETH ? data.breakdown.stableETH : 0).times('1e18').toFixed(0, BN.ROUND_DOWN),
    bayETH: new BN(data.breakdown && data.breakdown.bayETH ? data.breakdown.bayETH : 0).times('1e18').toFixed(0, BN.ROUND_DOWN),
    bayrETH: new BN(data.breakdown && data.breakdown.bayrETH ? data.breakdown.bayrETH : 0).times('1e18').toFixed(0, BN.ROUND_DOWN)
  };
  if (!data.tracked) data.tracked = {};
  if (!data.tracked.polReceivedWei) data.tracked.polReceivedWei = "0";
  if (!data.tracked.stableDaiReceivedWei) data.tracked.stableDaiReceivedWei = "0";
  setWizardData(data);
  return data;
}

function isNetworkIssueError(error) {
  if (error && typeof error.code !== 'undefined') {
    var code = error.code;
    if (code === -32603 || code === -32000 || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
      return true;
    }
  }
  var msg = '';
  try {
    msg = (error && error.message ? error.message : String(error || '')).toLowerCase();
  } catch(e) {
    msg = '';
  }
  return msg.indexOf('network error') !== -1 ||
    msg.indexOf('timeout') !== -1 ||
    msg.indexOf('failed to fetch') !== -1 ||
    msg.indexOf('gateway') !== -1 ||
    msg.indexOf('rate limit') !== -1 ||
    msg.indexOf('reconnect') !== -1 ||
    msg.indexOf('invalid json rpc response') !== -1 ||
    msg.indexOf('header not found') !== -1;
}

async function ensureTokenAllowance(web3Instance, tokenAddress, spender, requiredWei, switchNetworks) {
  var BN = BigNumber;
  var tokenContract = new web3Instance.eth.Contract(ERC20ABI, tokenAddress);
  var allowance = validation(DOMPurify.sanitize(await tokenContract.methods.allowance(myaccounts, spender).call()));
  if (new BN(allowance).gte(new BN(requiredWei))) return;
  await sendTx(tokenContract, "approve", [spender, requiredWei], 150000, "0", true, switchNetworks, false);
}

async function executePolSwapEth(data) {
  var BN = BigNumber;
  var ethWeb3 = getEthWeb3ForWizard();
  if (!ethWeb3) throw new Error('Ethereum RPC unavailable');
  var amountInWei = data.amountsWei.polETH;
  if (!amountInWei || new BN(amountInWei).lte(0)) return "0";

  var polContract = new ethWeb3.eth.Contract(ERC20ABI, WIZARD_POL_ETH);
  var preBal = validation(DOMPurify.sanitize(await polContract.methods.balanceOf(myaccounts).call()));
  var quotedOutWei = new BN(data.breakdown.polETH).times(data.prices.eth).dividedBy(data.prices.pol).times('1e18');
  var minOutWei = quotedOutWei.times(WIZARD_SLIPPAGE_POL).toFixed(0, BN.ROUND_DOWN);

  var deadline = Math.floor(Date.now() / 1000) + 300;
  // 0x0001f4 encodes fee tier 500 (0.05%) for Uniswap v3 path bytes
  var pathBytes = WIZARD_WETH_ETH.toLowerCase().replace('0x', '') + WIZARD_UNISWAP_V3_FEE_TIER + WIZARD_POL_ETH.toLowerCase().replace('0x', '');
  var wrapInput = ethWeb3.eth.abi.encodeParameters(['address','uint256'], [myaccounts, amountInWei]);
  var v3SwapInput = ethWeb3.eth.abi.encodeParameters(
    ['address','uint256','uint256','bytes','bool'],
    [myaccounts, amountInWei, minOutWei, '0x' + pathBytes, false]
  );
  var sweepInput = ethWeb3.eth.abi.encodeParameters(['address','address','uint256'], [WIZARD_POL_ETH, myaccounts, minOutWei]);
  await sendTx(
    new ethWeb3.eth.Contract(wizardUniversalRouterAbi, WIZARD_UNISWAP_UNIVERSAL_ROUTER),
    'execute',
    ['0x0b0004', [wrapInput, v3SwapInput, sweepInput], deadline],
    ETH_GAS_SWAP,
    amountInWei,
    true,
    true,
    true
  );

  var postBal = validation(DOMPurify.sanitize(await polContract.methods.balanceOf(myaccounts).call()));
  var received = new BN(postBal).minus(new BN(preBal));
  if (received.lte(0)) {
    throw new Error('POL swap failed - no tokens received');
  }
  if (received.lt(new BN(minOutWei))) {
    throw new Error('POL swap slippage exceeded tolerance');
  }
  return received.toFixed(0, BN.ROUND_DOWN);
}

async function executeBridgePolEth(data) {
  var BN = BigNumber;
  var ethWeb3 = getEthWeb3ForWizard();
  if (!ethWeb3) throw new Error('Ethereum RPC unavailable');
  var amountWei = data.tracked && data.tracked.polReceivedWei ? data.tracked.polReceivedWei : "0";
  if (new BN(amountWei).lte(0)) throw new Error('No POL amount to bridge');

  await ensureTokenAllowance(ethWeb3, WIZARD_POL_ETH, WIZARD_AUTOBRIDGE_V0, amountWei, true);
  var autobridge = new ethWeb3.eth.Contract(autoBridgev0ABI, WIZARD_AUTOBRIDGE_V0);
  await sendTx(autobridge, "bridgeERC20", [WIZARD_POL_ETH, myaccounts, amountWei], 450000, "0", true, true, false);
}

async function executeLidoDeposit(data) {
  var BN = BigNumber;
  var amountWei = data.amountsWei.lidoETH;
  if (!amountWei || new BN(amountWei).lte(0)) return;
  var ethWeb3 = getEthWeb3ForWizard();
  if (!ethWeb3) throw new Error('Ethereum RPC unavailable');
  var lidoContract = new ethWeb3.eth.Contract(lidoVaultABI, TREASURY_ADDRESSES.LIDO_VAULT);
  // keep same slippage used in earn.js staking flow (100 bps = 1%)
  await sendTx(lidoContract, "tradeAndLockStETH", [WIZARD_LIDO_SLIPPAGE_BPS, data.choices.lidoDays, false], ETH_GAS_LIDO, amountWei, true, true);
}

async function executeBridgeEth(data) {
  var BN = BigNumber;
  var ethWeb3 = getEthWeb3ForWizard();
  if (!ethWeb3) throw new Error('Ethereum RPC unavailable');
  var amountWei = new BN(data.amountsWei.stableETH).plus(new BN(data.amountsWei.bayETH)).plus(new BN(data.amountsWei.bayrETH));
  if (amountWei.lte(0)) return;
  var autobridge = new ethWeb3.eth.Contract(autoBridgev0ABI, WIZARD_AUTOBRIDGE_V0);
  await sendTx(autobridge, "bridgeETH", [myaccounts], 300000, amountWei.toFixed(0, BN.ROUND_DOWN), true, true, false);
}

async function swapWethToTokenOnPolygon(amountInWei, tokenOut, minOutWei) {
  var polWeb3 = getPolWeb3ForWizard();
  if (!polWeb3) throw new Error('Polygon RPC unavailable');
  var router = new polWeb3.eth.Contract(RouterABI, WIZARD_ROUTER_POLYGON);
  await ensureTokenAllowance(polWeb3, TREASURY_ADDRESSES.WETH, WIZARD_ROUTER_POLYGON, amountInWei, false);
  var deadline = Math.floor(Date.now() / 1000) + 300;
  var path = [TREASURY_ADDRESSES.WETH, tokenOut];
  await sendTx(router, "swapExactTokensForTokens", [amountInWei, minOutWei, path, myaccounts, deadline, WIZARD_EXCHANGE_POLYGON], 5000000, "0", true, false, true);
}

async function executeStableVaultPath(data) {
  var BN = BigNumber;
  var amountInWei = data.amountsWei.stableETH;
  if (!amountInWei || new BN(amountInWei).lte(0)) return;
  var polWeb3 = getPolWeb3ForWizard();
  if (!polWeb3) throw new Error('Polygon RPC unavailable');
  var daiContract = new polWeb3.eth.Contract(ERC20ABI, TREASURY_ADDRESSES.DAI);
  var preDai = validation(DOMPurify.sanitize(await daiContract.methods.balanceOf(myaccounts).call()));

  var quotedDaiOut = new BN(data.breakdown.stableETH).times(data.prices.eth).times('1e18');
  var minDaiOut = quotedDaiOut.times(WIZARD_SLIPPAGE_STABLE).toFixed(0, BN.ROUND_DOWN);
  await swapWethToTokenOnPolygon(amountInWei, TREASURY_ADDRESSES.DAI, minDaiOut);

  var postDai = validation(DOMPurify.sanitize(await daiContract.methods.balanceOf(myaccounts).call()));
  var received = new BN(postDai).minus(new BN(preDai));
  if (received.lt(new BN(minDaiOut))) {
    throw new Error('StableVault swap slippage exceeded tolerance');
  }

  data.tracked.stableDaiReceivedWei = received.toFixed(0, BN.ROUND_DOWN);
  setWizardData(data);
  var stableContract = new polWeb3.eth.Contract(stableVaultABI, TREASURY_ADDRESSES.STABLE_POOL);
  await ensureTokenAllowance(polWeb3, TREASURY_ADDRESSES.DAI, TREASURY_ADDRESSES.STABLE_POOL, data.tracked.stableDaiReceivedWei, false);
  var deadline = Math.floor(Date.now() / 1000) + 300;
  await sendTx(stableContract, "deposit", [data.tracked.stableDaiReceivedWei, deadline], 2000000, "0", true, false, false);
}

async function executeBaySwapPath(data, isBayr) {
  var BN = BigNumber;
  var amountEthKey = isBayr ? 'bayrETH' : 'bayETH';
  var amountInWei = data.amountsWei[isBayr ? 'bayrETH' : 'bayETH'];
  if (!amountInWei || new BN(amountInWei).lte(0)) return;
  var tokenOut = isBayr ? BAYRaddy : BAYLaddy;
  if (!tokenOut) throw new Error('BAY token address unavailable');

  var polWeb3 = getPolWeb3ForWizard();
  if (!polWeb3) throw new Error('Polygon RPC unavailable');
  var tokenContract = new polWeb3.eth.Contract(ERC20ABI, tokenOut);
  var preBal = validation(DOMPurify.sanitize(await tokenContract.methods.balanceOf(myaccounts).call()));
  var quotePrice = isBayr ? data.prices.bayr : data.prices.bay;
  var expectedOut = new BN(data.breakdown[amountEthKey]).times(data.prices.eth).dividedBy(quotePrice).times('1e8');
  var minOut = expectedOut.times(WIZARD_SLIPPAGE_BAY).toFixed(0, BN.ROUND_DOWN);
  await swapWethToTokenOnPolygon(amountInWei, tokenOut, minOut);
  var postBal = validation(DOMPurify.sanitize(await tokenContract.methods.balanceOf(myaccounts).call()));
  var received = new BN(postBal).minus(new BN(preBal));
  if (received.lt(new BN(minOut))) {
    throw new Error('BAY swap slippage exceeded tolerance');
  }
}

async function hasExpectedEthDeposit(data) {
  var BN = BigNumber;
  var ethWeb3 = getEthWeb3ForWizard();
  if (!ethWeb3) return false;
  var current = validation(DOMPurify.sanitize(await ethWeb3.eth.getBalance(myaccounts)));
  var startBal = data.startEthBalanceWei || "0";
  var target = new BN(data.ethAmount).times('1e18').toFixed(0, BN.ROUND_DOWN);
  return new BN(current).minus(new BN(startBal)).gte(new BN(target));
}

async function waitForPolygonFunding(data) {
  var BN = BigNumber;
  var polWeb3 = getPolWeb3ForWizard();
  if (!polWeb3) return false;
  var expectedWeth = new BN(data.amountsWei.stableETH).plus(new BN(data.amountsWei.bayETH)).plus(new BN(data.amountsWei.bayrETH));
  var wethContract = new polWeb3.eth.Contract(ERC20ABI, TREASURY_ADDRESSES.WETH);
  var currentWeth = new BN(validation(DOMPurify.sanitize(await wethContract.methods.balanceOf(myaccounts).call())));
  if (currentWeth.lt(expectedWeth)) return false;
  if (data.choices.pol) {
    var polBalance = new BN(validation(DOMPurify.sanitize(await polWeb3.eth.getBalance(myaccounts))));
    if (polBalance.lt(new BN(WIZARD_MIN_POL_GAS_WEI))) return false;
  }
  return true;
}

async function executeWizardAutomationTick() {
  if (wizardExecutorBusy) return;
  wizardExecutorBusy = true;
  try {
    var data = getWizardData();
    if (!data || !data.status || isTerminalStatus(data.status)) return;
    if (!myaccounts || data.account.toLowerCase() !== myaccounts.toLowerCase()) return;
    if (loginType !== 2) return;
    data = ensureWizardAmounts(data);
    if (!data || !data.status) return;

    if (data.status === WIZARD_STATUSES.pending) {
      if (await hasExpectedEthDeposit(data)) {
        setWizardStatus(WIZARD_STATUSES.ethReceived);
      }
      return;
    }

    if (data.status === WIZARD_STATUSES.ethReceived) {
      if (data.choices.pol) setWizardStatus(WIZARD_STATUSES.taskPolSwap);
      else if (data.choices.lido) setWizardStatus(WIZARD_STATUSES.taskLido);
      else if (data.choices.stable || data.choices.bay || data.choices.bayr) setWizardStatus(WIZARD_STATUSES.taskEthBridge);
      else setWizardStatus(WIZARD_STATUSES.completed);
      return;
    }

    if (data.status === WIZARD_STATUSES.taskPolSwap) {
      var polReceived = await executePolSwapEth(data);
      data = setWizardStatus(WIZARD_STATUSES.taskPolBridge);
      data.tracked.polReceivedWei = polReceived;
      setWizardData(data);
      return;
    }

    if (data.status === WIZARD_STATUSES.taskPolBridge) {
      await executeBridgePolEth(data);
      if (data.choices.lido) setWizardStatus(WIZARD_STATUSES.taskLido);
      else if (data.choices.stable || data.choices.bay || data.choices.bayr) setWizardStatus(WIZARD_STATUSES.taskEthBridge);
      else setWizardStatus(WIZARD_STATUSES.completed);
      return;
    }

    if (data.status === WIZARD_STATUSES.taskLido) {
      await executeLidoDeposit(data);
      if (data.choices.stable || data.choices.bay || data.choices.bayr) setWizardStatus(WIZARD_STATUSES.taskEthBridge);
      else setWizardStatus(WIZARD_STATUSES.completed);
      return;
    }

    if (data.status === WIZARD_STATUSES.taskEthBridge) {
      await executeBridgeEth(data);
      setWizardStatus(WIZARD_STATUSES.taskWaitPolygonFunds);
      return;
    }

    if (data.status === WIZARD_STATUSES.taskWaitPolygonFunds) {
      var ready = await waitForPolygonFunding(data);
      if (!ready) return;
      if (data.choices.stable) setWizardStatus(WIZARD_STATUSES.taskStable);
      else if (data.choices.bay) setWizardStatus(WIZARD_STATUSES.taskBay);
      else if (data.choices.bayr) setWizardStatus(WIZARD_STATUSES.taskBayr);
      else setWizardStatus(WIZARD_STATUSES.completed);
      return;
    }

    if (data.status === WIZARD_STATUSES.taskStable) {
      await executeStableVaultPath(data);
      if (data.choices.bay) setWizardStatus(WIZARD_STATUSES.taskBay);
      else if (data.choices.bayr) setWizardStatus(WIZARD_STATUSES.taskBayr);
      else setWizardStatus(WIZARD_STATUSES.completed);
      return;
    }

    if (data.status === WIZARD_STATUSES.taskBay) {
      await executeBaySwapPath(data, false);
      if (data.choices.bayr) setWizardStatus(WIZARD_STATUSES.taskBayr);
      else setWizardStatus(WIZARD_STATUSES.completed);
      return;
    }

    if (data.status === WIZARD_STATUSES.taskBayr) {
      await executeBaySwapPath(data, true);
      setWizardStatus(WIZARD_STATUSES.completed);
      return;
    }
  } catch(e) {
    console.log('Wizard automation executor error:', e);
    if (!isNetworkIssueError(e)) {
      setWizardStatus(WIZARD_STATUSES.failed, { failureReason: String(e && e.message ? e.message : e) });
    }
  } finally {
    wizardExecutorBusy = false;
  }
}

function startWizardExecutor() {
  if (wizardExecutorInterval) clearInterval(wizardExecutorInterval);
  wizardExecutorInterval = setInterval(function() {
    executeWizardAutomationTick().catch(function(err) {
      console.log('Wizard executor interval error:', err);
    });
  }, WIZARD_EXECUTOR_POLL_INTERVAL_MS);
  executeWizardAutomationTick().catch(function(err) {
    console.log('Wizard executor startup error:', err);
  });
}

function showAutomationBanner() {
  var existing = document.getElementById('wizardAutomationBanner');
  if (existing) existing.remove();
  var data = getWizardData();
  if (!data) return;

  var banner = document.createElement('div');
  banner.id = 'wizardAutomationBanner';
  banner.style.cssText = 'background:#1a3a5c;color:#fff;padding:10px 16px;margin:10px 0;border-radius:6px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;';
  var isTerminal = isTerminalStatus(data.status);
  var icon = data.status === WIZARD_STATUSES.completed ? '✅' : (data.status === WIZARD_STATUSES.failed ? '❌' : '⏳');
  var taskText = getCurrentTaskLabel(data.status);
  banner.innerHTML = '<span>' + icon + ' ' + taskText + '</span>' +
    '<button id="wizardShowBtn" style="background:#fff;color:#1a3a5c;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.9em;">' + (isTerminal ? translateThis('Details') : translateThis('Show')) + '</button>';

  var target = document.getElementById('buyBitbaySwapField');
  if (target) {
    target.parentNode.insertBefore(banner, target.nextSibling);
  }

  document.getElementById('wizardShowBtn').addEventListener('click', async function(e) {
    e.stopPropagation();
    var d = getWizardData();
    if (!d) return;
    var terminal = isTerminalStatus(d.status);
    var info = '<div style="text-align:left;font-size:0.9em;">';
    info += '<p><strong>' + translateThis('Status') + ':</strong> ' + getCurrentTaskLabel(d.status) + '</p>';
    info += '<p><strong>' + translateThis('Amount') + ':</strong> ' + d.ethAmount.toFixed(6) + ' ETH (~$' + (d.ethAmount * d.prices.eth).toFixed(2) + ')</p>';
    info += '<p><strong>' + translateThis('Address') + ':</strong> <span id="wizStatusAddr" style="font-family:monospace;font-size:0.85em;word-break:break-all;"></span></p>';
    var tasks = [];
    if (d.choices.pol) tasks.push('⛽ ' + translateThis('Get POL'));
    if (d.choices.lido) tasks.push('🏦 ' + translateThis('Lido HODL'));
    if (d.choices.stable) tasks.push('💱 ' + translateThis('StableVault'));
    if (d.choices.bay) tasks.push('🪙 ' + translateThis('Buy BAY'));
    if (d.choices.bayr) tasks.push('🏛️ ' + translateThis('Buy BAYR'));
    info += '<p><strong>' + translateThis('Tasks') + ':</strong> ' + tasks.join(', ') + '</p>';
    if (d.tracked && d.tracked.polReceivedWei && d.tracked.polReceivedWei !== "0") {
      info += '<p><strong>' + translateThis('POL received (wei)') + ':</strong> ' + d.tracked.polReceivedWei + '</p>';
    }
    if (d.failureReason) {
      info += '<p><strong>' + translateThis('Failure reason') + ':</strong> ' + DOMPurify.sanitize(d.failureReason) + '</p>';
    }
    info += '</div>';

    var r = await Swal.fire({
      title: translateThis('Automation Status'),
      html: info,
      showCancelButton: true,
      confirmButtonText: translateThis('OK'),
      cancelButtonText: terminal ? translateThis('Clear') : translateThis('Cancel Automation'),
      cancelButtonColor: '#d33',
      didOpen: function() {
        var addrEl = document.getElementById('wizStatusAddr');
        if (addrEl) addrEl.textContent = d.account;
      }
    });
    if (r.dismiss === Swal.DismissReason.cancel) {
      if (terminal) {
        clearWizardData();
        var bannerEl = document.getElementById('wizardAutomationBanner');
        if (bannerEl) bannerEl.remove();
        return;
      }
      var confirmCancel = await Swal.fire({
        title: translateThis('Cancel Automation?'),
        text: translateThis('Your ETH will simply remain in your account if you cancel.'),
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: translateThis('Yes, Cancel'),
        cancelButtonText: translateThis('Keep Active')
      });
      if (confirmCancel.isConfirmed) {
        clearWizardData();
        var bannerEl2 = document.getElementById('wizardAutomationBanner');
        if (bannerEl2) bannerEl2.remove();
      }
    }
  });
}

window.checkAutomationOnLogin = async function() {
  if (!myaccounts || loginType === 0) return;

  var data = getWizardData();
  if (data) {
    showAutomationBanner();
    if (!isTerminalStatus(data.status)) startWizardExecutor();
    if (loginType === 1) {
      await Swal.fire({
        title: translateThis('Automation Tasks Pending'),
        html: '<div style="text-align:left;max-height:400px;overflow-y:auto;">' +
          '<p>' + translateThis('You have pending automation tasks. To complete them, the tab must remain open and the wallet must be unlocked.') + '</p><br>' +
          '<p>' + translateThis('Since you are logged in via Metamask, you will need to unlock your wallet with your private key for the automation to proceed.') + '</p><br>' +
          '<p><strong>' + translateThis('Security Notice') + ':</strong> ' + translateThis('We only recommend this option if you trust the source code of this site. You may also wish to run the code locally. You are responsible for risks of direct key handling.') + '</p>' +
          '</div>',
        icon: 'info',
        confirmButtonText: translateThis('OK'),
        width: 550
      });
    }
    return;
  }

  var declined = localStorage.getItem(getNewUserKey());
  if (declined === 'true') return;

  try {
    var polBal = validation(DOMPurify.sanitize(await web3.eth.getBalance(myaccounts)));
    if (new BigNumber(polBal).gt(0)) return;
    if (typeof BAYLaddy !== 'undefined' && BAYLaddy && typeof baylcontract !== 'undefined') {
      var bayBal = validation(DOMPurify.sanitize(await baylcontract.methods.balanceOf(myaccounts).call()));
      if (new BigNumber(bayBal).gt(0)) return;
    }
    if (typeof BAYRaddy !== 'undefined' && BAYRaddy && typeof bayrcontract !== 'undefined') {
      var bayrBal = validation(DOMPurify.sanitize(await bayrcontract.methods.balanceOf(myaccounts).call()));
      if (new BigNumber(bayrBal).gt(0)) return;
    }

    var welcomeResult = await Swal.fire({
      title: '👋 ' + translateThis('Welcome to BitBay!'),
      text: translateThis('Would you like to get started using the automation wizard?'),
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: translateThis('Launch Wizard'),
      cancelButtonText: translateThis('No Thanks')
    });

    if (welcomeResult.isConfirmed) {
      await launchAutomationWizard();
    } else {
      localStorage.setItem(getNewUserKey(), 'true');
    }
  } catch(e) {
    console.log('New user check error:', e);
  }
};

window.addEventListener('load', function() {
  setTimeout(function() {
    if (myaccounts && loginType !== 0) {
      var data = getWizardData();
      if (data) {
        showAutomationBanner();
        if (!isTerminalStatus(data.status)) startWizardExecutor();
      }
    }
  }, 5000);
});

})();
