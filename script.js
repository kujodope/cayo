// Data Definitions
const LOOT_DATA = {
    gold: { name: 'Gold', value: 332184, space: 0.6667, class: 'item-gold' },
    cocaine: { name: 'Cocaine', value: 220095, space: 0.5, class: 'item-cocaine' },
    weed: { name: 'Weed', value: 147870, space: 0.3333, class: 'item-weed' },
    artwork: { name: 'Artwork', value: 189500, space: 0.5, class: 'item-artwork' },
    cash: { name: 'Cash', value: 88500, space: 0.25, class: 'item-cash' }
};

// State
let state = {
    primaryTarget: '1300000_1430000',
    difficulty: 'hard',
    players: 2,
    cuts: [50, 50],
    loot: {
        gold: 3,
        cocaine: 2,
        weed: 2,
        artwork: 1,
        cash: 4
    }
};

// UI Elements
const els = {
    primaryTarget: document.getElementById('primaryTarget'),
    difficulty: document.getElementById('difficulty'),
    playerCount: document.getElementById('playerCount'),
    crewCutsContainer: document.getElementById('crewCutsContainer'),
    crewCutsInputs: document.getElementById('crewCutsInputs'),
    dynamicPlayerPayouts: document.getElementById('dynamicPlayerPayouts'),
    grossTake: document.getElementById('grossTake'),
    fencingFee: document.getElementById('fencingFee'),
    pavelCut: document.getElementById('pavelCut'),
    netTake: document.getElementById('netTake'),
    playerBags: document.getElementById('playerBags')
};

// Format currency
const formatMoney = (amount) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
    }).format(amount);
};

// Update counter visually & state
window.updateLoot = (type, change) => {
    const input = document.getElementById(`loot-${type}`);
    let val = parseInt(input.value) + change;
    if (val < 0) val = 0;
    input.value = val;
    state.loot[type] = val;
    calculate();
};

// Listeners for standard inputs
const inputs = ['primaryTarget', 'difficulty'];
inputs.forEach(id => {
    els[id].addEventListener('change', (e) => {
        state[id] = e.target.value;
        calculate();
    });
});

els.playerCount.addEventListener('change', (e) => {
    state.players = parseInt(e.target.value);
    
    // Reset cuts equally (GTA style)
    if (state.players === 1) state.cuts = [100];
    if (state.players === 2) state.cuts = [50, 50];
    if (state.players === 3) state.cuts = [34, 33, 33];
    if (state.players === 4) state.cuts = [25, 25, 25, 25];

    buildCutSliders();
    calculate();
});

function buildCutSliders() {
    if (state.players === 1) {
        els.crewCutsContainer.style.display = 'none';
        els.crewCutsInputs.innerHTML = '';
        return;
    }
    
    els.crewCutsContainer.style.display = 'block';
    els.crewCutsInputs.innerHTML = '';

    state.cuts.forEach((cut, i) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '1rem';
        
        row.innerHTML = `
            <label style="margin:0; width: 60px;">P${i+1}</label>
            <input type="range" class="cut-slider" data-pid="${i}" min="15" max="100" step="5" value="${cut}" style="flex:1;">
            <span id="cut-label-${i}" style="width: 40px; text-align:right;">${cut}%</span>
        `;
        els.crewCutsInputs.appendChild(row);
    });

    document.querySelectorAll('.cut-slider').forEach(slider => {
        slider.addEventListener('input', handleCutChange);
    });
}

// Balance cuts when a slider moves
function handleCutChange(e) {
    const pIdx = parseInt(e.target.dataset.pid);
    const newValue = parseInt(e.target.value);
    const oldValue = state.cuts[pIdx];
    let diff = newValue - oldValue;

    state.cuts[pIdx] = newValue;
    
    // We need to absorb the diff across OTHER players.
    // In GTA, cuts are in 5% increments, minimum 15%.
    let others = state.cuts.map((c, i) => ({index: i, cut: c})).filter(x => x.index !== pIdx);
    
    // Try to subtract/add from others iteratively
    while (diff !== 0) {
        let applied = false;
        for (let other of others) {
            if (diff > 0 && other.cut > 15) { // Needs to decrease someone
                other.cut -= 5;
                diff -= 5;
                applied = true;
            } else if (diff < 0 && other.cut < 100) { // Needs to increase someone
                other.cut += 5;
                diff += 5;
                applied = true;
            }
            if (diff === 0) break;
        }
        // If we can't distribute anymore (e.g. everyone else at 15%), revert the slider to maintain 100% total
        if (!applied) {
            state.cuts[pIdx] -= diff;
            e.target.value = state.cuts[pIdx];
            break;
        }
    }

    // Write back
    others.forEach(o => state.cuts[o.index] = o.cut);
    
    // Update labels and sliders
    state.cuts.forEach((c, i) => {
        if (i !== pIdx) {
            document.querySelector(`.cut-slider[data-pid="${i}"]`).value = c;
        }
        document.getElementById(`cut-label-${i}`).innerText = c + '%';
    });

    calculate();
}

Object.keys(state.loot).forEach(type => {
    const el = document.getElementById(`loot-${type}`);
    el.addEventListener('change', (e) => {
        let val = parseInt(e.target.value);
        if (isNaN(val) || val < 0) val = 0;
        state.loot[type] = val;
        calculate();
    });
});

// Main Calculation
function calculate() {
    // 1. Primary Target Value
    const primaryVals = state.primaryTarget.split('_').map(Number);
    const primaryVal = state.difficulty === 'hard' ? primaryVals[1] : primaryVals[0];

    // 2. Secondary Loot Assignment Algorithm
    const playerBags = Array.from({ length: parseInt(state.players) }, () => ({
        spaceRemaining: 1.0,
        items: []
    }));

    // Build priority list of items based on value per space
    let lootPriority = Object.keys(LOOT_DATA).map(key => {
        return {
            id: key,
            ...LOOT_DATA[key],
            density: LOOT_DATA[key].value / LOOT_DATA[key].space,
            count: state.loot[key]
        };
    }).sort((a, b) => b.density - a.density);

    let secondaryTake = 0;

    // Optimization: Greedily assign highest density loot.
    // Artwork must take exactly 0.5 space, others are fluid in GTA up to decimal accuracy.
    lootPriority.forEach(item => {
        if (item.id === 'artwork') {
            while (item.count > 0) {
                // Find someone with at least 0.5 space
                let eligiblePlayer = playerBags.find(p => p.spaceRemaining >= 0.49); // 0.49 for float tolerance
                if (eligiblePlayer) {
                    eligiblePlayer.items.push({ name: item.name, amount: 1, val: item.value, class: item.class });
                    eligiblePlayer.spaceRemaining -= item.space;
                    secondaryTake += item.value;
                    item.count--;
                } else {
                    break; // No one can fit artwork
                }
            }
        } else {
            // Divisible items
            while (item.count > 0) {
                // Find player with most space to distribute evenly, or just first available
                let eligiblePlayer = playerBags.find(p => p.spaceRemaining > 0.01);
                if (eligiblePlayer) {
                    let amountToTake = Math.min(item.count, eligiblePlayer.spaceRemaining / item.space);
                    let valForAmount = amountToTake * item.value;
                    
                    eligiblePlayer.items.push({ 
                        name: item.name, 
                        amount: amountToTake, 
                        val: valForAmount,
                        class: item.class
                    });
                    
                    eligiblePlayer.spaceRemaining -= (amountToTake * item.space);
                    secondaryTake += valForAmount;
                    item.count -= amountToTake;
                } else {
                    break;
                }
            }
        }
    });

    // 3. Totals Compilation
    const grossTotal = primaryVal + secondaryTake;
    const fencing = grossTotal * 0.12;
    const pavel = grossTotal * 0.02;
    const netTotal = grossTotal - fencing - pavel;

    // Render Math
    els.grossTake.innerText = formatMoney(grossTotal);
    els.fencingFee.innerText = `-${formatMoney(fencing)}`;
    els.pavelCut.innerText = `-${formatMoney(pavel)}`;
    els.netTake.innerText = formatMoney(netTotal);

    // Render Per Player Payouts based on dynamic cuts
    els.dynamicPlayerPayouts.innerHTML = '';
    if (state.players > 1) {
        state.cuts.forEach((cut, i) => {
            const playerPayout = netTotal * (cut / 100);
            els.dynamicPlayerPayouts.innerHTML += `
                <div class="breakdown-item" style="padding: 0.2rem 0;">
                    <span style="color: var(--text-main);">Player ${i + 1} (${cut}%)</span>
                    <span style="color: var(--primary); font-weight: 600;">${formatMoney(playerPayout)}</span>
                </div>
            `;
        });
    }

    // Render Bags
    renderBags(playerBags);
}

function renderBags(bags) {
    els.playerBags.innerHTML = '';
    
    bags.forEach((bag, idx) => {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.innerHTML = `<h3>Player ${idx + 1}</h3>`;
        
        if (bag.items.length === 0) {
            card.innerHTML += `<p style="color:var(--text-muted); font-size: 0.9rem;">Bag Empty</p>`;
        } else {
            // Group identical items if they got split across iterations
            let grouped = {};
            let bagTotalVal = 0;
            bag.items.forEach(i => {
                if(!grouped[i.name]) grouped[i.name] = { amount: 0, val: 0, class: i.class };
                grouped[i.name].amount += i.amount;
                grouped[i.name].val += i.val;
                bagTotalVal += i.val;
            });

            for (const key in grouped) {
                const i = grouped[key];
                // Format amount beautifully (e.g. 1.5 stacks)
                let amountStr = Number(i.amount).toFixed(2);
                if (amountStr.endsWith('.00')) amountStr = Number(i.amount).toFixed(0); 
                else if (amountStr.endsWith('0')) amountStr = Number(i.amount).toFixed(1);

                card.innerHTML += `
                    <div class="bag-item">
                        <span class="${i.class}">${amountStr}x ${key}</span>
                        <span>${formatMoney(i.val)}</span>
                    </div>
                `;
            }
            
            // Add space and bag value indicator
            let spaceUsed = ((1.0 - bag.spaceRemaining) * 100).toFixed(0);
            card.innerHTML += `
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted);">
                    <span>${spaceUsed}% Full</span>
                    <span>Total: <strong style="color:#fff;">${formatMoney(bagTotalVal)}</strong></span>
                </div>
            `;
        }
        
        els.playerBags.appendChild(card);
    });
}

// Initial calculation on load
buildCutSliders();
calculate();
