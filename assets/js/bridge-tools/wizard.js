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
    var ethRpc = typeof getEthereumRpc === 'function' ? getEthereumRpc() : 'https://eth.drpc.org/';
    var ethWeb3 = new Web3(ethRpc);
    var ethBal = validation(DOMPurify.sanitize(await ethWeb3.eth.getBalance(myaccounts)));
    wizardState.ethBalance = parseFloat(new BigNumber(ethBal).dividedBy('1e18').toFixed(8));
  } catch(e) {
    wizardState.ethBalance = 0;
  }
}

async function estimateEthGasPrice() {
  try {
    var ethRpc = typeof getEthereumRpc === 'function' ? getEthereumRpc() : 'https://eth.drpc.org/';
    var ethWeb3 = new Web3(ethRpc);
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
      translateThis('Earn a decentralized and reliable profit from stablecoin pair trading fees where the position is automatically managed to maximize profits while supporting the ecosystem. Includes ±5% slippage for the trade to get DAI.'),
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
    summaryHTML += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px;">💱 ' + translateThis('StableVault') + ' (±5%)</td><td style="text-align:right;padding:4px;">' + stableETH.toFixed(6) + '</td><td style="text-align:right;padding:4px;">$' + stableUSD.toFixed(2) + '</td></tr>';
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
    status: 'pending'
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

function showAutomationBanner() {
  var existing = document.getElementById('wizardAutomationBanner');
  if (existing) existing.remove();
  var data = getWizardData();
  if (!data || data.status !== 'pending') return;

  var banner = document.createElement('div');
  banner.id = 'wizardAutomationBanner';
  banner.style.cssText = 'background:#1a3a5c;color:#fff;padding:10px 16px;margin:10px 0;border-radius:6px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;';
  banner.innerHTML = '<span>⏳ ' + translateThis('Ethereum automation in process...') + '</span>' +
    '<button id="wizardShowBtn" style="background:#fff;color:#1a3a5c;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.9em;">' + translateThis('Show') + '</button>';

  var target = document.getElementById('buyBitbaySwapField');
  if (target) {
    target.parentNode.insertBefore(banner, target.nextSibling);
  }

  document.getElementById('wizardShowBtn').addEventListener('click', async function(e) {
    e.stopPropagation();
    var d = getWizardData();
    if (!d) return;
    var info = '<div style="text-align:left;font-size:0.9em;">';
    info += '<p><strong>' + translateThis('Status') + ':</strong> ' + translateThis('Waiting for ETH deposit') + '</p>';
    info += '<p><strong>' + translateThis('Amount') + ':</strong> ' + d.ethAmount.toFixed(6) + ' ETH (~$' + (d.ethAmount * d.prices.eth).toFixed(2) + ')</p>';
    info += '<p><strong>' + translateThis('Address') + ':</strong> <span id="wizStatusAddr" style="font-family:monospace;font-size:0.85em;word-break:break-all;"></span></p>';
    var tasks = [];
    if (d.choices.pol) tasks.push('⛽ ' + translateThis('Get POL'));
    if (d.choices.lido) tasks.push('🏦 ' + translateThis('Lido HODL'));
    if (d.choices.stable) tasks.push('💱 ' + translateThis('StableVault'));
    if (d.choices.bay) tasks.push('🪙 ' + translateThis('Buy BAY'));
    if (d.choices.bayr) tasks.push('🏛️ ' + translateThis('Buy BAYR'));
    info += '<p><strong>' + translateThis('Tasks') + ':</strong> ' + tasks.join(', ') + '</p>';
    info += '</div>';

    var r = await Swal.fire({
      title: translateThis('Automation Status'),
      html: info,
      showCancelButton: true,
      confirmButtonText: translateThis('OK'),
      cancelButtonText: translateThis('Cancel Automation'),
      cancelButtonColor: '#d33',
      didOpen: function() {
        var addrEl = document.getElementById('wizStatusAddr');
        if (addrEl) addrEl.textContent = d.account;
      }
    });
    if (r.dismiss === Swal.DismissReason.cancel) {
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
        var bannerEl = document.getElementById('wizardAutomationBanner');
        if (bannerEl) bannerEl.remove();
      }
    }
  });
}

window.checkAutomationOnLogin = async function() {
  if (!myaccounts || loginType === 0) return;

  var data = getWizardData();
  if (data && data.status === 'pending') {
    showAutomationBanner();
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
      if (data && data.status === 'pending') {
        showAutomationBanner();
      }
    }
  }, 5000);
});

})();